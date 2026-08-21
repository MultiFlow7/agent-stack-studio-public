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

function childIsRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

function sendToChild(
  child: ChildProcess,
  message: object,
  onError: (error: Error) => void,
): boolean {
  if (!child.connected || !childIsRunning(child)) return false
  try {
    child.send(message, (error) => {
      if (error) onError(error)
    })
    return true
  } catch (error) {
    onError(error instanceof Error ? error : new Error('Runtime IPC 发送失败。'))
    return false
  }
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
      void this.#logger
        .write('info', 'run.runtime.stdout', {
          runId: manifest.runId,
          byteLength: chunk.byteLength,
          contentRedacted: true,
        })
        .catch(() => undefined)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      void this.#logger
        .write('error', 'run.runtime.stderr', {
          runId: manifest.runId,
          byteLength: chunk.byteLength,
          contentRedacted: true,
        })
        .catch(() => undefined)
    })

    return new Promise<RuntimeExecutionOutcome>((resolve, reject) => {
      let settled = false
      let cancelGrace: NodeJS.Timeout | undefined
      const timeout = setTimeout(() => {
        active.timedOut = true
        active.cancelRequested = true
        const sent = sendToChild(child, { type: 'cancel', runId: manifest.runId }, (error) => {
          if (!settled) finish(error)
        })
        if (!sent && childIsRunning(child)) child.kill('SIGTERM')
        cancelGrace = setTimeout(() => {
          if (childIsRunning(child)) child.kill('SIGKILL')
        }, 1_000)
      }, manifest.reproducibility.timeoutMs)

      const finish = (outcome: RuntimeExecutionOutcome | Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (cancelGrace) clearTimeout(cancelGrace)
        this.#active.delete(manifest.runId)
        if (child.connected) {
          try {
            child.disconnect()
          } catch {
            // The exit/error event may have closed IPC between the guard and disconnect.
          }
        }
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
          if (active.cancelRequested) {
            finish({ status: 'cancelled' })
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
          if (childIsRunning(child)) child.kill('SIGKILL')
          return
        }
        const message = parsed.data
        if (message.type === 'runtime-ready') {
          try {
            onEvent({
              type: 'runtime-ready',
              message: 'Cordis Runtime 已冷启动。',
              details: {},
            })
          } catch (error) {
            finish(error instanceof Error ? error : new Error('Runtime 事件处理失败。'))
            if (childIsRunning(child)) child.kill('SIGKILL')
            return
          }
          const sent = sendToChild(child, { type: 'execute', manifest }, (error) => finish(error))
          if (!sent) return
          if (active.cancelRequested) {
            sendToChild(child, { type: 'cancel', runId: manifest.runId }, (error) => finish(error))
          }
        } else if (message.type === 'run-event') {
          try {
            onEvent(message.event)
          } catch (error) {
            finish(error instanceof Error ? error : new Error('Runtime 事件处理失败。'))
            if (childIsRunning(child)) child.kill('SIGKILL')
          }
        } else if (message.type === 'run-completed') {
          finish({ status: 'succeeded', result: message.result })
        } else if (message.type === 'run-cancelled') {
          finish({ status: active.timedOut ? 'timed-out' : 'cancelled' })
        } else if (message.type === 'runtime-error') {
          finish(new Error(message.message))
          if (childIsRunning(child)) child.kill('SIGTERM')
        }
      })
    })
  }

  cancel(runId: string): boolean {
    const active = this.#active.get(runId)
    if (!active?.child.connected) return false
    if (active.cancelRequested) return true
    active.cancelRequested = true
    return sendToChild(active.child, { type: 'cancel', runId }, () => {
      if (childIsRunning(active.child)) active.child.kill('SIGTERM')
    })
  }

  async stopAll(): Promise<void> {
    const processes = [...this.#active.values()]
    this.#active.clear()
    await Promise.all(
      processes.map(
        ({ child }) =>
          new Promise<void>((resolve) => {
            if (!childIsRunning(child)) {
              resolve()
              return
            }
            let settled = false
            const finish = () => {
              if (settled) return
              settled = true
              clearTimeout(grace)
              clearTimeout(hardLimit)
              resolve()
            }
            const grace = setTimeout(() => {
              if (childIsRunning(child)) child.kill('SIGKILL')
            }, 1_000)
            const hardLimit = setTimeout(finish, 2_000)
            child.once('exit', () => {
              finish()
            })
            const sent = sendToChild(child, { type: 'shutdown' }, () => {
              if (childIsRunning(child)) child.kill('SIGTERM')
            })
            if (!sent && childIsRunning(child)) child.kill('SIGTERM')
          }),
      ),
    )
  }
}
