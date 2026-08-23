import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, open, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { HostDriverRegistry } from '../adapters/harness/host-driver-registry'
import { harnessIdFromAdapter } from './known-harnesses'
import { ProjectStore } from './project-store'
import { stableHash } from './project-model'
import {
  nativeAgentExecuteInputSchema,
  nativeAgentResultListSchema,
  nativeAgentResultSchema,
  type HarnessProbe,
  type NativeAgentExecuteInput,
  type NativeAgentResult,
} from '../shared/native-agent'

interface StoredResult {
  idempotencyKey: string | null
  result: NativeAgentResult
}

const LOCAL_STATE_DIRECTORY = '.agent-stack-local'
const HISTORY_FILE = 'native-history.jsonl'

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class NativeAgentCore {
  readonly #projects: ProjectStore
  readonly #drivers: HostDriverRegistry
  readonly #active = new Map<string, AbortController>()

  constructor(drivers: HostDriverRegistry, projects = new ProjectStore()) {
    this.#drivers = drivers
    this.#projects = projects
  }

  probes(): Promise<HarnessProbe[]> {
    return this.#drivers.probes()
  }

  async execute(
    rawInput: NativeAgentExecuteInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<NativeAgentResult> {
    const input = nativeAgentExecuteInputSchema.parse(rawInput)
    const requestId = input.requestId ?? randomUUID()
    if (this.#active.has(requestId)) throw new Error('该 Native Harness 请求已在执行。')
    const inspected = await this.#projects.read(input.projectPath, { recover: true })
    const projectRoot = path.dirname(inspected.path)
    const stateRoot = path.join(projectRoot, LOCAL_STATE_DIRECTORY)
    await mkdir(stateRoot, { recursive: true, mode: 0o700 })
    if (input.idempotencyKey) {
      const existing = (await this.#readStored(stateRoot)).find(
        ({ idempotencyKey }) => idempotencyKey === input.idempotencyKey,
      )
      if (existing) return existing.result
    }
    const components = new Map(
      inspected.project.components.map((component) => [component.id, component]),
    )
    const controllerOwner = inspected.project.stack.capabilityOwners.find(
      ({ capability }) => capability === 'execution-controller',
    )
    const controller = controllerOwner ? components.get(controllerOwner.componentId) : undefined
    const harnessId = harnessIdFromAdapter(controller?.descriptor.runtimeAdapter ?? null)
    if (
      !controller ||
      !harnessId ||
      !inspected.project.stack.componentIds.includes(controller.id)
    ) {
      throw new Error('当前 Agent 未选择 Pi 或 OpenClaw Harness。')
    }
    const driver = this.#drivers.get(harnessId)
    const controllerAbort = new AbortController()
    const cancelFromCaller = () => controllerAbort.abort()
    options.signal?.addEventListener('abort', cancelFromCaller, { once: true })
    if (options.signal?.aborted) controllerAbort.abort()
    this.#active.set(requestId, controllerAbort)
    const startedAt = new Date().toISOString()
    const sessionId = input.sessionId ?? randomUUID()
    let result: NativeAgentResult
    try {
      const outcome = await driver.execute({
        kind: input.kind,
        message: input.message,
        sessionId,
        projectRoot,
        stateRoot,
        profile: inspected.project.profile,
        timeoutMs: input.timeoutMs,
        signal: controllerAbort.signal,
      })
      result = nativeAgentResultSchema.parse({
        id: requestId,
        kind: input.kind,
        projectId: inspected.project.id,
        projectRevision: inspected.project.revision,
        projectHash: stableHash(inspected.project),
        harness: harnessId,
        harnessVersion: outcome.harnessVersion,
        sessionId,
        status: 'succeeded',
        responseMarkdown: outcome.responseMarkdown,
        usage: outcome.usage,
        modelLayer: outcome.modelLayer,
        degradedFeatures: outcome.degradedFeatures,
        failure: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Harness 执行失败。'
      const cancelled = controllerAbort.signal.aborted || message.includes('已取消')
      const timedOut = message.includes('超时')
      result = nativeAgentResultSchema.parse({
        id: requestId,
        kind: input.kind,
        projectId: inspected.project.id,
        projectRevision: inspected.project.revision,
        projectHash: stableHash(inspected.project),
        harness: harnessId,
        harnessVersion: controller.descriptor.version,
        sessionId,
        status: cancelled ? 'cancelled' : timedOut ? 'timed-out' : 'failed',
        responseMarkdown: '',
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        modelLayer: {
          kind: 'harness-provider',
          provider: `${harnessId}-configured-provider`,
          model: null,
        },
        degradedFeatures: [],
        failure: {
          code: cancelled ? 'CANCELLED' : timedOut ? 'TIMEOUT' : 'HARNESS_FAILED',
          message,
        },
        startedAt,
        finishedAt: new Date().toISOString(),
      })
    } finally {
      this.#active.delete(requestId)
      options.signal?.removeEventListener('abort', cancelFromCaller)
    }
    await this.#appendStored(stateRoot, { idempotencyKey: input.idempotencyKey ?? null, result })
    return result
  }

  cancel(requestId: string): boolean {
    const controller = this.#active.get(requestId)
    if (!controller || controller.signal.aborted) return false
    controller.abort()
    return true
  }

  async list(projectPath: string, kind: 'chat' | 'run' | null): Promise<NativeAgentResult[]> {
    const inspected = await this.#projects.read(projectPath, { recover: true })
    const stateRoot = path.join(path.dirname(inspected.path), LOCAL_STATE_DIRECTORY)
    const results = (await this.#readStored(stateRoot)).map(({ result }) => result)
    return nativeAgentResultListSchema.parse(
      results
        .filter((result) => kind === null || result.kind === kind)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt)),
    )
  }

  async #readStored(stateRoot: string): Promise<StoredResult[]> {
    let contents: string
    try {
      contents = await readFile(path.join(stateRoot, HISTORY_FILE), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return contents
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const stored = JSON.parse(line) as StoredResult
          return [
            {
              idempotencyKey:
                typeof stored.idempotencyKey === 'string' ? stored.idempotencyKey : null,
              result: nativeAgentResultSchema.parse(stored.result),
            },
          ]
        } catch {
          return []
        }
      })
  }

  async #appendStored(stateRoot: string, stored: StoredResult): Promise<void> {
    const lockPath = path.join(stateRoot, '.history.lock')
    let lock: Awaited<ReturnType<typeof open>> | undefined
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try {
        lock = await open(lockPath, 'wx', 0o600)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt === 79) throw error
        await delay(25)
      }
    }
    if (!lock) throw new Error('无法锁定 Native Harness 本地历史。')
    try {
      await appendFile(path.join(stateRoot, HISTORY_FILE), `${JSON.stringify(stored)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
    } finally {
      await lock.close()
      await rm(lockPath, { force: true })
    }
  }
}
