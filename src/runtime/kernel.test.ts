import { describe, expect, it } from 'vitest'
import { defineRuntimeAdapter } from './component-adapter'
import { createRuntimeKernel } from './kernel'

describe('Cordis runtime kernel', () => {
  it('starts and disposes the isolated lifecycle boundary', async () => {
    const kernel = createRuntimeKernel()

    expect(kernel.cordisVersion).toBe('4.0.0-rc.8')
    await expect(kernel.start()).resolves.toBeUndefined()
    await expect(kernel.stop()).resolves.toBeUndefined()
  })

  it('adapts a Studio service into the Cordis lifecycle and disposes it once', async () => {
    const events: string[] = []
    const adapter = defineRuntimeAdapter(
      {
        serviceKey: 'studio.sample.harness-x@1.0.0',
        componentContractId: 'studio.sample.harness-x',
        componentVersion: '1.0.0',
      },
      {
        start() {
          events.push('start')
          return Promise.resolve()
        },
        stop() {
          events.push('stop')
          return Promise.resolve()
        },
      },
    )
    const kernel = createRuntimeKernel([adapter])

    await kernel.start()
    await kernel.stop()
    await kernel.stop()

    expect(events).toEqual(['start', 'stop'])
  })

  it('rejects an Adapter without a stable service identity', () => {
    expect(() =>
      defineRuntimeAdapter(
        { serviceKey: '', componentContractId: 'studio.invalid', componentVersion: '1.0.0' },
        { async start() {}, async stop() {} },
      ),
    ).toThrow()
  })

  it('disposes adapters that already started when a later Adapter fails', async () => {
    const events: string[] = []
    const first = defineRuntimeAdapter(
      {
        serviceKey: 'studio.sample.first@1.0.0',
        componentContractId: 'studio.sample.first',
        componentVersion: '1.0.0',
      },
      {
        start() {
          events.push('first:start')
          return Promise.resolve()
        },
        stop() {
          events.push('first:stop')
          return Promise.resolve()
        },
      },
    )
    const failing = defineRuntimeAdapter(
      {
        serviceKey: 'studio.sample.failing@1.0.0',
        componentContractId: 'studio.sample.failing',
        componentVersion: '1.0.0',
      },
      {
        start() {
          events.push('failing:start')
          return Promise.reject(new Error('Adapter startup failed.'))
        },
        stop() {
          events.push('failing:stop')
          return Promise.resolve()
        },
      },
    )
    const kernel = createRuntimeKernel([first, failing])

    await expect(kernel.start()).rejects.toThrow('Adapter startup failed')
    expect(events).toEqual(['first:start', 'failing:start', 'first:stop'])
  })
})
