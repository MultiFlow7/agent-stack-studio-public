import { fork, type ChildProcess } from 'node:child_process'
import {
  runtimeChildMessageSchema,
  type RunManifest,
  type RuntimeRunEvent,
  type RuntimeRunResult,
} from '../../shared/run'
import type { AppLogger } from '../logging/logger'

export type RuntimeExecutionOutcome =
  | { status: 'succeeded'; result: RuntimeRunResult }
  | { status: 'cancelled' }
  | { status: 'timed-out' }

export interface RuntimeExecutionGateway {
  execute(
    manifest: RunManifest,
    onEvent: (event: RuntimeRunEvent) => void,
  ): Promise<RuntimeExecutionOutcome>
  cancel(runId: string): boolean
  stopAll(): Promise<void>
}

interface ActiveProcess {
  child: ChildProcess
  timedOut: boolean
  cancelRequested: boolean
}

export class RuntimeController implements RuntimeExecutionGateway {
  readonly #entryPath: string
  readonly #logger: AppLogger
  readonly #active = new Map<string, ActiveProcess>()

  constructor(entryPath: string, logger: AppLogger) {
    this.#entryPath = entryPath
    this.#logger = logger
  }

  execute(
    manifest: RunManifest,
    onEvent: (event: RuntimeRunEvent) => void,
  ): Promise<RuntimeExecutionOutcome> {
    if (this.#active.has(manifest.runId)) {
      return Promise.reject(new Error('该 Run 已有 Runtime 子进程。'))
    }

    const child = fork(this.#entryPath, [], {
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    const active: ActiveProcess = { child, timedOut: false, cancelRequested: false }
    this.#active.set(manifest.runId, active)

    child.stdout?.on('data', (chunk: Buffer) => {
      void this.#logger.write('info', 'run.runtime.stdout', {
        runId: manifest.runId,
        message: chunk.toString().trim(),
      })
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      void this.#logger.write('error', 'run.runtime.stderr', {
        runId: manifest.runId,
        message: chunk.toString().trim(),
      })
    })

    return new Promise<RuntimeExecutionOutcome>((resolve, reject) => {
      let settled = false
      let cancelGrace: NodeJS.Timeout | undefined
      const timeout = setTimeout(() => {
        active.timedOut = true
        active.cancelRequested = true
        child.send({ type: 'cancel', runId: manifest.runId })
        cancelGrace = setTimeout(() => child.kill(), 1_000)
      }, manifest.reproducibility.timeoutMs)

      const finish = (outcome: RuntimeExecutionOutcome | Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (cancelGrace) clearTimeout(cancelGrace)
        this.#active.delete(manifest.runId)
        if (child.connected) child.disconnect()
        if (outcome instanceof Error) reject(outcome)
        else resolve(outcome)
      }

      child.once('error', (error) => finish(error))
      child.once('exit', (code, signal) => {
        if (!settled) {
          if (active.timedOut) {
            finish({ status: 'timed-out' })
            return
          }
          finish(
            new Error(`Runtime 子进程异常退出（code=${String(code)}, signal=${String(signal)}）。`),
          )
        }
      })
      child.on('message', (rawMessage: unknown) => {
        const parsed = runtimeChildMessageSchema.safeParse(rawMessage)
        if (!parsed.success) {
          finish(new Error('Runtime 返回了无效消息。'))
          child.kill()
          return
        }
        const message = parsed.data
        if (message.type === 'runtime-ready') {
          onEvent({
            type: 'runtime-ready',
            message: 'Cordis Runtime 已冷启动。',
            details: {},
          })
          child.send({ type: 'execute', manifest })
          if (active.cancelRequested) child.send({ type: 'cancel', runId: manifest.runId })
        } else if (message.type === 'run-event') {
          onEvent(message.event)
        } else if (message.type === 'run-completed') {
          finish({ status: 'succeeded', result: message.result })
        } else if (message.type === 'run-cancelled') {
          finish({ status: active.timedOut ? 'timed-out' : 'cancelled' })
        } else if (message.type === 'runtime-error') {
          finish(new Error(message.message))
        }
      })
    })
  }

  cancel(runId: string): boolean {
    const active = this.#active.get(runId)
    if (!active?.child.connected) return false
    active.cancelRequested = true
    active.child.send({ type: 'cancel', runId })
    return true
  }

  async stopAll(): Promise<void> {
    const processes = [...this.#active.values()]
    this.#active.clear()
    await Promise.all(
      processes.map(
        ({ child }) =>
          new Promise<void>((resolve) => {
            if (!child.connected) {
              resolve()
              return
            }
            const timeout = setTimeout(() => {
              child.kill()
              resolve()
            }, 1_000)
            child.once('exit', () => {
              clearTimeout(timeout)
              resolve()
            })
            child.send({ type: 'shutdown' })
          }),
      ),
    )
  }
}
