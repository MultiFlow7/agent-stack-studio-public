import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { createValidatedHandler } from './validated-handler'

const trustedFrame = {
  url: 'file:///Applications/Agent%20Stack%20Studio.app/Contents/Resources/app.asar/dist/renderer/index.html',
}
const trustedEvent = {
  senderFrame: trustedFrame,
  sender: { mainFrame: trustedFrame, getURL: () => trustedFrame.url },
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

    const frame = { url: 'https://attacker.example/' }
    await expect(
      handler(
        {
          senderFrame: frame,
          sender: { mainFrame: frame, getURL: () => frame.url },
        } as never,
        undefined,
      ),
    ).rejects.toThrow('请求来源不受信任')
    expect(handle).not.toHaveBeenCalled()
  })

  it('rejects arbitrary local files and child frames even when they use file URLs', async () => {
    const handle = vi.fn()
    const handler = createValidatedHandler({
      input: z.undefined(),
      output: z.object({ ok: z.boolean() }),
      handle,
    })
    const arbitraryFrame = { url: 'file:///tmp/attacker.html' }
    await expect(
      handler(
        {
          senderFrame: arbitraryFrame,
          sender: { mainFrame: arbitraryFrame, getURL: () => arbitraryFrame.url },
        } as never,
        undefined,
      ),
    ).rejects.toThrow('请求来源不受信任')

    const childFrame = { url: trustedFrame.url }
    await expect(
      handler(
        {
          senderFrame: childFrame,
          sender: { mainFrame: trustedFrame, getURL: () => trustedFrame.url },
        } as never,
        undefined,
      ),
    ).rejects.toThrow('请求来源不受信任')
    expect(handle).not.toHaveBeenCalled()
  })
})
