import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  agentSetupSessionSchema,
  buildAgentSetupReadiness,
  emptyAgentSetupProfile,
  type AgentSetupView,
} from '../../shared/agent-setup'
import { ipcChannels } from '../../shared/ipc'
import type { AgentSetupService } from '../agents/agent-setup-service'

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

import { registerAgentSetupIpc } from './register-agent-setup-ipc'

const trustedFrame = {
  url: 'file:///Applications/Agent%20Stack%20Studio.app/Contents/Resources/app.asar/dist/renderer/index.html',
}
const trustedEvent = {
  senderFrame: trustedFrame,
  sender: { mainFrame: trustedFrame, getURL: () => trustedFrame.url },
}

function view(): AgentSetupView {
  const timestamp = '2026-08-26T08:00:00.000Z'
  const session = agentSetupSessionSchema.parse({
    id: '4061fbad-2152-47bc-9db3-bd70d133f2be',
    status: 'transient',
    revision: 3,
    step: 'model',
    name: 'Secure setup',
    description: '',
    harnessId: 'pi',
    selection: {
      harnessId: 'pi',
      providerId: 'openai',
      modelId: 'gpt-5.1',
      credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
    },
    profile: emptyAgentSetupProfile,
    authentication: null,
    verification: {
      state: 'not-run',
      configurationHash: null,
      checkedAt: null,
      failure: null,
    },
    hasKeychainCredential: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  const probe = {
    id: 'pi' as const,
    label: 'Pi',
    executable: 'pi',
    status: 'ready' as const,
    version: '0.84.2',
    requiredVersion: '0.84.2',
    capabilities: {
      prompt: 'native' as const,
      skills: 'native' as const,
      memory: 'native' as const,
      mcp: 'native' as const,
      sessions: 'native' as const,
    },
    detail: 'Pi 可用。',
  }
  return {
    session,
    probes: [
      probe,
      { ...probe, id: 'openclaw', label: 'OpenClaw', executable: 'openclaw' },
      { ...probe, id: 'codex', label: 'Codex CLI', executable: 'codex' },
    ],
    capabilityCatalog: {
      items: [],
      projectComponents: { state: 'empty', message: '当前项目组件目录为空。' },
    },
    readiness: buildAgentSetupReadiness({ session, probe }),
  }
}

describe('Agent setup IPC boundary', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('keeps API Key plaintext inside native Main input and never returns it', async () => {
    const canary = 'opaque-setup-secret-canary'
    const configureApiKey = vi.fn().mockResolvedValue(view())
    const service = {
      get: vi.fn().mockResolvedValue(view()),
      configureApiKey,
      close: vi.fn(),
    } as unknown as AgentSetupService
    registerAgentSetupIpc({
      setups: service,
      prompt: { request: vi.fn().mockResolvedValue(canary) },
    })
    const handler = electron.handlers.get(ipcChannels.agentSetupConfigureApiKey)

    const result = await handler?.(trustedEvent, { id: view().session.id })
    expect(configureApiKey).toHaveBeenCalledWith(view().session.id, canary)
    expect(JSON.stringify(result)).not.toContain(canary)
    await expect(
      handler?.(trustedEvent, { id: view().session.id, apiKey: canary }),
    ).rejects.toThrow('提交的 Agent 数据无效')
  })

  it('rejects extra executable fields and validates completion identifiers', async () => {
    const complete = vi.fn().mockResolvedValue({
      agentId: '92d74aaf-b86c-4e84-978b-b35d227e0c79',
      setupId: view().session.id,
    })
    registerAgentSetupIpc({
      setups: { complete, close: vi.fn() } as unknown as AgentSetupService,
      prompt: { request: vi.fn() },
    })
    const handler = electron.handlers.get(ipcChannels.agentSetupComplete)

    await expect(
      handler?.(trustedEvent, {
        id: view().session.id,
        executable: '/tmp/untrusted',
        argv: ['--secret', 'value'],
      }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    await expect(handler?.(trustedEvent, { id: 'not-a-uuid' })).rejects.toThrow(
      '提交的 Agent 数据无效',
    )
    expect(complete).not.toHaveBeenCalled()
  })

  it('validates the MCP action envelope without accepting executable or argv fields', async () => {
    const validateMcp = vi.fn().mockResolvedValue(view())
    registerAgentSetupIpc({
      setups: { validateMcp, close: vi.fn() } as unknown as AgentSetupService,
      prompt: { request: vi.fn() },
    })
    const handler = electron.handlers.get(ipcChannels.agentSetupValidateMcp)
    const input = {
      id: view().session.id,
      serverId: 'fixture-mcp',
      requestId: '5c897569-e257-414c-9124-749dca5d25b8',
      timeoutMs: 5_000,
    }

    await expect(handler?.(trustedEvent, input)).resolves.toMatchObject({
      session: { id: input.id },
    })
    expect(validateMcp).toHaveBeenCalledWith(input)
    await expect(
      handler?.(trustedEvent, { ...input, command: '/tmp/untrusted', args: ['--unsafe'] }),
    ).rejects.toThrow('提交的 Agent 数据无效')
  })
})
