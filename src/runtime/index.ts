import { runtimeParentMessageSchema, type RuntimeRunEvent } from '../shared/run'
import { sanitizedErrorMessage } from '../shared/sensitive-data'
import { createRuntimeKernel } from './kernel'
import { executeBuiltInRun } from './run-executor'

const kernel = createRuntimeKernel()
let activeRun: { id: string; abort: AbortController } | undefined
let shuttingDown = false

function sendEvent(event: RuntimeRunEvent): void {
  process.send?.({ type: 'run-event', event })
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  activeRun?.abort.abort()
  await kernel.stop()
  if (process.connected) process.disconnect()
}

process.on('message', (rawMessage: unknown) => {
  const parsed = runtimeParentMessageSchema.safeParse(rawMessage)
  if (!parsed.success) {
    process.send?.({ type: 'runtime-error', message: '无效的 Runtime 命令。' })
    return
  }
  const message = parsed.data
  if (message.type === 'shutdown') {
    void shutdown()
    return
  }
  if (message.type === 'cancel') {
    if (activeRun?.id === message.runId) activeRun.abort.abort()
    return
  }
  if (activeRun) {
    process.send?.({ type: 'runtime-error', message: 'Runtime 子进程一次只能执行一个 Run。' })
    return
  }

  const abort = new AbortController()
  activeRun = { id: message.manifest.runId, abort }
  void executeBuiltInRun(message.manifest, abort.signal, sendEvent)
    .then((result) => process.send?.({ type: 'run-completed', result }))
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        process.send?.({ type: 'run-cancelled', message: 'Run 已取消。' })
      } else {
        process.send?.({
          type: 'runtime-error',
          message: sanitizedErrorMessage(error, 'Runtime 执行失败。'),
        })
      }
    })
    .finally(() => shutdown())
})

void kernel
  .start()
  .then(() => process.send?.({ type: 'runtime-ready', cordisVersion: kernel.cordisVersion }))
  .catch((error: unknown) => {
    process.send?.({
      type: 'runtime-error',
      message: sanitizedErrorMessage(error, 'Runtime 启动失败。'),
    })
    process.exitCode = 1
  })
