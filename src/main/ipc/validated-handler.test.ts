import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { createValidatedHandler } from './validated-handler'

const trustedEvent = {
  senderFrame: { url: 'file:///Applications/Agent%20Stack%20Studio.app/renderer/index.html' },
  sender: { getURL: () => '' },
} as never

describe('createValidatedHandler', () => {
  it('rejects input that is outside the allowlisted schema', async () => {
    const handle = vi.fn()
    const handler = createValidatedHandler({
      input: z.object({ name: z.string().min(1) }).strict(),
      output: z.object({ ok: z.boolean() }),
      handle,
    })

    await expect(handler(trustedEvent, { name: '', shell: 'rm' })).rejects.toThrow(
      '提交的 Agent 数据无效',
    )
    expect(handle).not.toHaveBeenCalled()
  })

  it('validates output before returning it to the Renderer', async () => {
    const handler = createValidatedHandler({
      input: z.undefined(),
      output: z.object({ count: z.number().int() }),
      handle: () => ({ count: 1 }),
    })

    await expect(handler(trustedEvent, undefined)).resolves.toEqual({ count: 1 })
  })

  it('rejects an IPC invocation from non-application web content', async () => {
    const handle = vi.fn()
    const handler = createValidatedHandler({
      input: z.undefined(),
      output: z.object({ ok: z.boolean() }),
      handle,
    })

    await expect(
      handler(
        {
          senderFrame: { url: 'https://attacker.example/' },
          sender: { getURL: () => 'https://attacker.example/' },
        } as never,
        undefined,
      ),
    ).rejects.toThrow('请求来源不受信任')
    expect(handle).not.toHaveBeenCalled()
  })
})
