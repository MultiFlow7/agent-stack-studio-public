import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  compatibilityValidationChildMessageSchema,
  trustedCompatibilityValidationRequestSchema,
  type TrustedCompatibilityValidationReceipt,
} from '../shared/compatibility-validation'

export interface TrustedCompatibilityRuntimeGateway {
  validate(
    input: {
      componentId: string
      contractId: string
      componentVersion: string
      adapterRef: string
      timeoutMs: number
    },
    signal?: AbortSignal,
  ): Promise<TrustedCompatibilityValidationReceipt>
}

function running(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

export class ChildProcessCompatibilityRuntime implements TrustedCompatibilityRuntimeGateway {
  readonly #entryPath: string

  constructor(entryPath: string) {
    this.#entryPath = entryPath
  }

  validate(
    input: {
      componentId: string
      contractId: string
      componentVersion: string
      adapterRef: string
      timeoutMs: number
    },
    signal?: AbortSignal,
  ): Promise<TrustedCompatibilityValidationReceipt> {
    const request = trustedCompatibilityValidationRequestSchema.parse({
      requestId: randomUUID(),
      componentId: input.componentId,
      contractId: input.contractId,
      componentVersion: input.componentVersion,
      adapterRef: input.adapterRef,
    })
    const child = fork(this.#entryPath, [], {
      env: { ELECTRON_RUN_AS_NODE: '1', LANG: process.env.LANG ?? 'en_US.UTF-8' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    // Runtime output is intentionally discarded. Validation evidence crosses IPC only as a
    // strict receipt, so third-party text and credentials cannot enter logs or project state.
    child.stdout?.resume()
    child.stderr?.resume()

    return new Promise((resolve, reject) => {
      let settled = false
      let grace: NodeJS.Timeout | undefined
      let terminationError: Error | undefined
      const finish = (result: TrustedCompatibilityValidationReceipt | Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (grace) clearTimeout(grace)
        signal?.removeEventListener('abort', cancel)
        if (child.connected) child.disconnect()
        if (result instanceof Error || result instanceof DOMException) reject(result)
        else resolve(result)
      }
      const requestTermination = (error: Error) => {
        if (terminationError) return
        terminationError = error
        if (child.connected && running(child))
          child.send({ type: 'cancel', requestId: request.requestId })
        grace = setTimeout(() => {
          if (running(child)) child.kill('SIGKILL')
          finish(error)
        }, 500)
      }
      const cancel = () =>
        requestTermination(new DOMException('兼容性运行验证已取消。', 'AbortError'))
      const timeout = setTimeout(() => {
        requestTermination(new Error('兼容性运行验证超时。'))
      }, input.timeoutMs)
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
      child.once('error', (error) => finish(error))
      child.once('exit', (code, childSignal) => {
        if (!settled)
          finish(
            terminationError ??
              new Error(
                `兼容性 Runtime 异常退出（code=${String(code)}, signal=${String(childSignal)}）。`,
              ),
          )
      })
      child.on('message', (raw: unknown) => {
        const message = compatibilityValidationChildMessageSchema.safeParse(raw)
        if (!message.success) {
          if (running(child)) child.kill('SIGKILL')
          finish(new Error('兼容性 Runtime 返回了无效消息。'))
          return
        }
        if (message.data.type === 'ready') {
          if (!terminationError) child.send({ type: 'validate', request })
        } else if (message.data.type === 'completed') {
          finish(terminationError ?? message.data.receipt)
        } else {
          finish(terminationError ?? new Error(message.data.message))
        }
      })
    })
  }
}
