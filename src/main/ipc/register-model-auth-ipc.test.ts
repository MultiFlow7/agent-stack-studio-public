import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAgentModelReadiness, harnessModelCapability } from '../../shared/model-auth'
import type { ModelAuthView } from '../../shared/model-auth-ipc'
import { ipcChannels } from '../../shared/ipc'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  handle: vi.fn(),
  removeHandler: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: electron.handle.mockImplementation(
      (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
        electron.handlers.set(channel, handler)
      },
    ),
    removeHandler: electron.removeHandler,
  },
}))

import { registerModelAuthIpc, type ModelAuthIpcService } from './register-model-auth-ipc'

const trustedFrame = {
  url: 'file:///Applications/Agent%20Stack%20Studio.app/Contents/Resources/app.asar/dist/renderer/index.html',
}
const trustedEvent = {
  senderFrame: trustedFrame,
  sender: { mainFrame: trustedFrame, getURL: () => trustedFrame.url },
}

function view(): ModelAuthView {
  const capability = harnessModelCapability('pi')
  const selection = {
    providerId: 'openai',
    modelId: 'gpt-5.1',
    credentialRequirement: { method: 'api-key' as const, credentialKind: 'api-key' as const },
  }
  return {
    harness: { id: 'pi', label: 'Pi' },
    capability,
    probe: {
      id: 'pi',
      label: 'Pi',
      executable: '/trusted/pi',
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
      detail: '受控 Pi 测试。',
    },
    selection,
    readiness: buildAgentModelReadiness({
      stackCompatible: true,
      harnessStatus: 'ready',
      configurationState: 'configured',
      configuration: selection,
      authentication: null,
      verification: {
        state: 'not-run',
        configurationHash: null,
        checkedAt: null,
        failure: null,
      },
    }),
  }
}

describe('model authentication IPC boundary', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('keeps API Key plaintext inside Main secure input and rejects Renderer secret fields', async () => {
    const canary = 'opaque-provider-canary-43d20'
    const configureApiKey = vi.fn().mockResolvedValue(view())
    const service = {
      view: vi.fn().mockResolvedValue(view()),
      configureApiKey,
    } as unknown as ModelAuthIpcService
    registerModelAuthIpc({
      modelAuth: service,
      prompt: { request: vi.fn().mockResolvedValue(canary) },
    })

    const handler = electron.handlers.get(ipcChannels.modelAuthConfigureApiKey)
    const result = await handler?.(trustedEvent, {})
    expect(configureApiKey).toHaveBeenCalledWith(canary)
    expect(JSON.stringify(result)).not.toContain(canary)
    await expect(handler?.(trustedEvent, { apiKey: canary })).rejects.toThrow(
      '提交的 Agent 数据无效',
    )
  })

  it('requires cost acknowledgement, supports cancellation, and never accepts executable or argv', async () => {
    let release: (() => void) | undefined
    const verify = vi.fn(
      (_input: unknown, options?: { signal?: AbortSignal }) =>
        new Promise<ModelAuthView>((resolve) => {
          options?.signal?.addEventListener('abort', () => resolve(view()), { once: true })
          release = () => resolve(view())
        }),
    )
    registerModelAuthIpc({
      modelAuth: { view: vi.fn(), verify } as unknown as ModelAuthIpcService,
      prompt: { request: vi.fn() },
    })
    const verifyHandler = electron.handlers.get(ipcChannels.modelAuthVerify)
    const cancelHandler = electron.handlers.get(ipcChannels.modelAuthCancel)
    const requestId = randomUUID()

    await expect(verifyHandler?.(trustedEvent, { requestId, timeoutMs: 5_000 })).rejects.toThrow(
      '提交的 Agent 数据无效',
    )
    await expect(
      verifyHandler?.(trustedEvent, {
        requestId,
        costAcknowledged: true,
        timeoutMs: 5_000,
        executable: '/tmp/untrusted',
        argv: ['--api-key', 'secret'],
      }),
    ).rejects.toThrow('提交的 Agent 数据无效')

    const pending = verifyHandler?.(trustedEvent, {
      requestId,
      costAcknowledged: true,
      timeoutMs: 5_000,
    })
    await vi.waitFor(() => expect(verify).toHaveBeenCalled())
    await expect(cancelHandler?.(trustedEvent, { requestId })).resolves.toEqual({
      cancelled: true,
    })
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' })
    release?.()
  })
})
