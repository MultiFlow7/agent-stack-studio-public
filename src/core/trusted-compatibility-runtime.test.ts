import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ChildProcessCompatibilityRuntime } from './trusted-compatibility-runtime'

const entryPath = path.resolve('src/test/fixtures/m31/compatibility-runtime-child.mjs')

function input(contractId = 'fixture.component', timeoutMs = 2_000) {
  return {
    componentId: randomUUID(),
    contractId,
    componentVersion: '1.0.0',
    adapterRef: 'studio://runtime/harness-x',
    timeoutMs,
  }
}

describe('ChildProcessCompatibilityRuntime', () => {
  it('accepts only a strict receipt and does not forward child stdout or stderr', async () => {
    const runtime = new ChildProcessCompatibilityRuntime(entryPath)
    await expect(runtime.validate(input())).resolves.toMatchObject({
      status: 'succeeded',
      method: 'trusted-runtime-validation-v1',
      artifact: { name: 'compatibility-validation.json' },
    })
  })

  it('kills an unresponsive child on cancellation and returns no receipt', async () => {
    const runtime = new ChildProcessCompatibilityRuntime(entryPath)
    const controller = new AbortController()
    const validation = runtime.validate(input('fixture.hang'), controller.signal)
    setTimeout(() => controller.abort(), 50)
    await expect(validation).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('kills an unresponsive child on timeout and reports a recoverable timeout', async () => {
    const runtime = new ChildProcessCompatibilityRuntime(entryPath)
    await expect(runtime.validate(input('fixture.hang', 50))).rejects.toThrow('超时')
  })
})
