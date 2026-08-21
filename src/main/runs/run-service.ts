import { randomUUID } from 'node:crypto'
import type { AgentService } from '../agents/agent-service'
import type { ComponentService } from '../components/component-service'
import { buildRunManifest } from '../domain/run-manifest'
import type { RunRepository } from '../persistence/run-repository'
import type { RuntimeExecutionGateway } from '../runtime/runtime-controller'
import { AppError } from '../../shared/errors'
import type { RunDetail, RunRecord, StartRunInput } from '../../shared/run'
import type { ArtifactService } from './artifact-service'

const terminalStatuses = new Set<RunRecord['status']>([
  'succeeded',
  'failed',
  'cancelled',
  'timed-out',
])

export class RunService {
  readonly #agents: AgentService
  readonly #components: ComponentService
  readonly #repository: RunRepository
  readonly #runtime: RuntimeExecutionGateway
  readonly #artifacts: ArtifactService
  readonly #electronVersion: string
  readonly #architecture: string

  constructor(options: {
    agents: AgentService
    components: ComponentService
    repository: RunRepository
    runtime: RuntimeExecutionGateway
    artifacts: ArtifactService
    electronVersion: string
    architecture: string
  }) {
    this.#agents = options.agents
    this.#components = options.components
    this.#repository = options.repository
    this.#runtime = options.runtime
    this.#artifacts = options.artifacts
    this.#electronVersion = options.electronVersion
    this.#architecture = options.architecture
  }

  start(input: StartRunInput): RunRecord {
    const detail = this.#agents.getActive(input.agentId)
    const version = detail.versions[0]
    if (!version) {
      throw new AppError('VALIDATION_FAILED', '请先为当前 Agent 创建不可变版本。')
    }

    const stack = this.#components.getStack(input.agentId)
    if (stack.compilation.status !== 'ready') {
      throw new AppError('VALIDATION_FAILED', 'Stack 预检未通过，不能启动 Run。')
    }
    if (version.snapshot.stack.revision !== stack.revision) {
      throw new AppError(
        'VALIDATION_FAILED',
        '当前 Stack 草稿在最新版本之后已变更，请先创建新版本。',
      )
    }

    const versionComponents = new Map(
      version.snapshot.stack.components.map((component) => [component.componentId, component]),
    )
    if (
      versionComponents.size !== stack.components.length ||
      stack.components.some((component) => {
        const snapshot = versionComponents.get(component.id)
        return (
          !snapshot ||
          snapshot.contractId !== component.descriptor.id ||
          snapshot.version !== component.descriptor.version
        )
      })
    ) {
      throw new AppError('VALIDATION_FAILED', '版本中的组件快照与当前 Stack 不一致。')
    }

    const createdAt = new Date().toISOString()
    const manifest = buildRunManifest({
      runId: randomUUID(),
      version,
      plan: stack.compilation.plan,
      components: stack.components,
      prompt: input.prompt,
      timeoutMs: input.timeoutMs,
      randomSeed: input.randomSeed,
      electronVersion: this.#electronVersion,
      architecture: this.#architecture,
      createdAt,
    })
    const run = this.#repository.create(manifest)
    this.#repository.addEvent(run.id, {
      type: 'queued',
      message: 'Run 已加入本地执行队列。',
      details: { manifestHash: manifest.contentHash },
    })
    void this.#execute(run.id, manifest)
    return run
  }

  list(agentId: string | null): RunRecord[] {
    return this.#repository.list(agentId)
  }

  get(runId: string): RunDetail {
    return this.#repository.getDetail(runId)
  }

  cancel(runId: string): RunDetail {
    const run = this.#repository.get(runId)
    if (terminalStatuses.has(run.status)) return this.#repository.getDetail(runId)
    if (run.status === 'cancelling') return this.#repository.getDetail(runId)
    this.#repository.updateStatus(runId, 'cancelling')
    this.#repository.addEvent(runId, {
      type: 'cancel-requested',
      message: '已请求取消 Run，正在等待 Runtime 清理。',
      details: {},
    })
    if (!this.#runtime.cancel(runId)) {
      const current = this.#repository.get(runId)
      if (!terminalStatuses.has(current.status)) {
        this.#repository.updateStatus(runId, 'cancelled', {
          finishedAt: new Date().toISOString(),
          failure: { code: 'CANCELLED', message: 'Run 在 Runtime 启动前已取消。' },
        })
        this.#repository.addEvent(runId, {
          type: 'cancelled',
          message: 'Run 已在启动前取消。',
          details: {},
        })
      }
    }
    return this.#repository.getDetail(runId)
  }

  async #execute(runId: string, manifest: RunRecord['manifest']): Promise<void> {
    try {
      this.#repository.updateStatus(runId, 'starting', { startedAt: new Date().toISOString() })
      this.#repository.addEvent(runId, {
        type: 'process-started',
        message: '已为该 Run 启动全新 Runtime 子进程。',
        details: { coldStart: true },
      })
      const outcome = await this.#runtime.execute(manifest, (event) => {
        const current = this.#repository.get(runId)
        if (event.type === 'runtime-ready' && current.status !== 'cancelling') {
          this.#repository.updateStatus(runId, 'running')
        }
        this.#repository.addEvent(runId, event)
      })

      if (outcome.status === 'succeeded') {
        const artifact = await this.#artifacts.writeResult(runId, outcome.result)
        this.#repository.addArtifact(artifact)
        this.#repository.addEvent(runId, {
          type: 'artifact-written',
          message: '运行结果已写入本地 Artifact。',
          details: { path: artifact.relativePath, hash: artifact.contentHash },
        })
        this.#repository.updateStatus(runId, 'succeeded', {
          finishedAt: new Date().toISOString(),
        })
        this.#repository.addEvent(runId, {
          type: 'completed',
          message: 'Run 已成功完成。',
          details: { durationMs: outcome.result.durationMs },
        })
      } else if (outcome.status === 'timed-out') {
        this.#repository.updateStatus(runId, 'timed-out', {
          finishedAt: new Date().toISOString(),
          failure: { code: 'TIMEOUT', message: 'Run 超过预设时间并已终止。' },
        })
        this.#repository.addEvent(runId, {
          type: 'timed-out',
          message: 'Run 已超时，Runtime 子进程已清理。',
          details: { timeoutMs: manifest.reproducibility.timeoutMs },
        })
      } else {
        this.#repository.updateStatus(runId, 'cancelled', {
          finishedAt: new Date().toISOString(),
          failure: { code: 'CANCELLED', message: 'Run 由用户取消。' },
        })
        this.#repository.addEvent(runId, {
          type: 'cancelled',
          message: 'Run 已取消，Runtime 子进程已清理。',
          details: {},
        })
      }
    } catch {
      const current = this.#repository.get(runId)
      if (terminalStatuses.has(current.status)) return
      const message = 'Runtime 执行失败，未保存内部错误细节。'
      this.#repository.updateStatus(runId, 'failed', {
        finishedAt: new Date().toISOString(),
        failure: { code: 'RUNTIME_FAILED', message },
      })
      this.#repository.addEvent(runId, {
        type: 'failed',
        message,
        details: {},
      })
    }
  }
}
