import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { HarnessHostDriver, HostDriverExecuteInput } from '../adapters/harness/host-driver'
import { HostDriverRegistry } from '../adapters/harness/host-driver-registry'
import { harnessProbeSchema } from '../shared/native-agent'
import { NativeAgentCore } from './native-agent-core'
import { StudioCore } from './studio-core'

function driver(execute: HarnessHostDriver['execute']): HarnessHostDriver {
  return {
    id: 'pi',
    probe: () =>
      Promise.resolve(
        harnessProbeSchema.parse({
          id: 'pi',
          label: 'Pi',
          executable: '/test/pi',
          status: 'ready',
          version: '0.84.2',
          requiredVersion: '0.84.2',
          capabilities: {
            prompt: 'native',
            skills: 'native',
            memory: 'adapted',
            mcp: 'unavailable',
            sessions: 'native',
          },
          detail: '测试边界中的受控 Driver。',
        }),
      ),
    execute,
  }
}

describe('NativeAgentCore', () => {
  it('uses the selected real-driver contract, preserves project facts, and retries idempotently', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio-native-core-'))
    const studio = new StudioCore()
    const initialized = await studio.initProject(root, { name: 'Native Agent' })
    await studio.selectKnownHarness(root, 'pi', {
      expectedRevision: initialized.project.revision,
    })
    const execute = vi.fn((input: HostDriverExecuteInput) =>
      Promise.resolve({
        harnessVersion: '0.84.2',
        responseMarkdown: `真实 Driver 契约收到：${input.message}`,
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
        modelLayer: { kind: 'harness-provider' as const, provider: 'fake-provider', model: null },
        degradedFeatures: ['MCP 未执行。'],
      }),
    )
    const native = new NativeAgentCore(new HostDriverRegistry([driver(execute)]))
    const input = {
      projectPath: root,
      kind: 'run' as const,
      message: '检查项目',
      timeoutMs: 5_000,
      idempotencyKey: 'run-1',
    }
    const first = await native.execute(input)
    const retried = await native.execute(input)

    expect(first).toMatchObject({
      status: 'succeeded',
      harness: 'pi',
      harnessVersion: '0.84.2',
      projectRevision: 1,
      responseMarkdown: '真实 Driver 契约收到：检查项目',
    })
    expect(retried).toEqual(first)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(await native.list(root, 'run')).toEqual([first])
    expect((await studio.inspectProject(root)).project.revision).toBe(1)
  })

  it('forwards cancellation and persists a cancelled result without chat/log data in project facts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio-native-cancel-'))
    const studio = new StudioCore()
    const initialized = await studio.initProject(root, { name: 'Cancel Agent' })
    await studio.selectKnownHarness(root, 'pi', {
      expectedRevision: initialized.project.revision,
    })
    const execute = (input: HostDriverExecuteInput) =>
      new Promise<never>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(new Error('Harness 运行已取消。')), {
          once: true,
        })
      })
    const native = new NativeAgentCore(new HostDriverRegistry([driver(execute)]))
    const requestId = crypto.randomUUID()
    const pending = native.execute({
      projectPath: root,
      kind: 'chat',
      message: '不会进入项目事实的消息',
      requestId,
      timeoutMs: 5_000,
    })
    await vi.waitFor(() => expect(native.cancel(requestId)).toBe(true))
    const result = await pending

    expect(result.status).toBe('cancelled')
    const inspected = await studio.inspectProject(root)
    expect(JSON.stringify(inspected.project)).not.toContain('不会进入项目事实的消息')
  })
})
