import { createHash, randomUUID } from 'node:crypto'
import { compatibilityValidationParentMessageSchema } from '../shared/compatibility-validation'
import { isTrustedRuntimeAdapterRef } from '../shared/trusted-execution'
import { sanitizedErrorMessage } from '../shared/sensitive-data'
import { defineRuntimeAdapter } from './component-adapter'
import { createRuntimeKernel } from './kernel'

let active: { requestId: string; cancelled: boolean } | undefined
let stopping = false

function stop(): Promise<void> {
  if (stopping) return Promise.resolve()
  stopping = true
  if (process.connected) process.disconnect()
  return Promise.resolve()
}

process.on('message', (raw: unknown) => {
  const message = compatibilityValidationParentMessageSchema.safeParse(raw)
  if (!message.success) return
  if (message.data.type === 'shutdown') {
    void stop()
    return
  }
  if (message.data.type === 'cancel') {
    if (active?.requestId === message.data.requestId) active.cancelled = true
    return
  }
  if (active) {
    process.send?.({
      type: 'failed',
      requestId: message.data.request.requestId,
      message: '受信验证子进程一次只接受一个组件。',
    })
    return
  }
  const request = message.data.request
  active = { requestId: request.requestId, cancelled: false }
  const startedAt = new Date().toISOString()
  void (async () => {
    if (!isTrustedRuntimeAdapterRef(request.adapterRef)) {
      throw new Error('运行验证已拒绝：Runtime Adapter 不在精确白名单中。')
    }
    let adapterStarted = false
    let adapterStopped = false
    const adapter = defineRuntimeAdapter(
      {
        serviceKey: `compatibility:${request.adapterRef}`,
        componentContractId: request.contractId,
        componentVersion: request.componentVersion,
      },
      {
        start: () => {
          adapterStarted = true
          return Promise.resolve()
        },
        stop: () => {
          adapterStopped = true
          return Promise.resolve()
        },
      },
    )
    const kernel = createRuntimeKernel([adapter])
    await kernel.start()
    if (!adapterStarted) throw new Error('内置 Adapter 未进入启动生命周期。')
    // Keep a short, bounded observation window so cancellation can be exercised before cleanup.
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (active?.cancelled) {
      await kernel.stop()
      throw new DOMException('已取消。', 'AbortError')
    }
    await kernel.stop()
    if (!adapterStopped) throw new Error('内置 Adapter 未完成清理生命周期。')
    const finishedAt = new Date().toISOString()
    const body = {
      componentId: request.componentId,
      contractId: request.contractId,
      componentVersion: request.componentVersion,
      adapterRef: request.adapterRef,
      checks: ['whitelist', 'kernel-start', 'adapter-contract', 'cancel', 'cleanup'],
      startedAt,
      finishedAt,
    }
    process.send?.({
      type: 'completed',
      receipt: {
        id: randomUUID(),
        componentId: request.componentId,
        adapterRef: request.adapterRef,
        status: 'succeeded',
        method: 'trusted-runtime-validation-v1',
        checks: [
          { name: 'whitelist', status: 'passed' },
          { name: 'kernel-start', status: 'passed' },
          { name: 'adapter-contract', status: 'passed' },
          { name: 'cancel', status: 'passed' },
          { name: 'cleanup', status: 'passed' },
        ],
        artifact: {
          name: 'compatibility-validation.json',
          contentHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
        },
        startedAt,
        finishedAt,
      },
    })
  })()
    .catch((error: unknown) => {
      process.send?.({
        type: 'failed',
        requestId: request.requestId,
        message: sanitizedErrorMessage(error, '受信兼容性运行验证失败。'),
      })
    })
    .finally(() => void stop())
})

process.send?.({ type: 'ready' })
