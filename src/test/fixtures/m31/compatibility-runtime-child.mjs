import { createHash, randomUUID } from 'node:crypto'

let hanging

process.on('message', (message) => {
  if (message?.type === 'validate') {
    if (message.request.contractId === 'fixture.hang') {
      process.stdout.write('api_key=SHOULD_NOT_CROSS_RUNTIME_BOUNDARY\n')
      process.stderr.write('authorization=SHOULD_NOT_CROSS_RUNTIME_BOUNDARY\n')
      hanging = setInterval(() => undefined, 1_000)
      return
    }
    const startedAt = new Date().toISOString()
    const finishedAt = new Date().toISOString()
    process.send?.({
      type: 'completed',
      receipt: {
        id: randomUUID(),
        componentId: message.request.componentId,
        adapterRef: message.request.adapterRef,
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
          contentHash: createHash('sha256').update('fixture').digest('hex'),
        },
        startedAt,
        finishedAt,
      },
    })
    clearInterval(hanging)
    process.disconnect()
  }
})

process.send?.({ type: 'ready' })
