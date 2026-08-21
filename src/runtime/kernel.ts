import { Context } from 'cordis'
import cordisPackage from 'cordis/package.json' with { type: 'json' }
import type { RuntimeComponentAdapter } from './component-adapter'

export interface RuntimeKernel {
  readonly cordisVersion: string
  start(): Promise<void>
  stop(): Promise<void>
}

export function createRuntimeKernel(adapters: RuntimeComponentAdapter[] = []): RuntimeKernel {
  const context = new Context()
  let started = false

  return {
    cordisVersion: cordisPackage.version,
    async start() {
      if (started) return
      const activeAdapters: RuntimeComponentAdapter[] = []
      try {
        for (const adapter of adapters) {
          await adapter.start()
          activeAdapters.push(adapter)
        }
        const fiber = context.plugin((ctx) => {
          ctx.effect(() => () => undefined, 'studio-runtime-lifecycle')
          for (const adapter of activeAdapters) {
            ctx.effect(() => () => adapter.stop(), `component-adapter:${adapter.serviceKey}`)
          }
        })
        await fiber
        started = true
      } catch (error) {
        await Promise.allSettled(activeAdapters.reverse().map((adapter) => adapter.stop()))
        throw error
      }
    },
    async stop() {
      if (!started) return
      await context.fiber.dispose()
      started = false
    },
  }
}
