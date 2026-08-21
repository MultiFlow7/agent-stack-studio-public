import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusProjection } from '../../shared/agent-status'
import { ipcChannels } from '../../shared/ipc'
import type { AgentService } from '../agents/agent-service'
import type { AgentStatusService } from '../agents/agent-status-service'
import type { ImportService } from '../import/import-service'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  handle: vi.fn(),
  removeHandler: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: electron.handle.mockImplementation(
      (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
        electron.handlers.set(channel, handler)
      },
    ),
    removeHandler: electron.removeHandler,
  },
}))

import { registerAgentIpc } from './register-agent-ipc'

const trustedEvent = {
  senderFrame: { url: 'file:///Applications/Agent%20Stack%20Studio.app/renderer/index.html' },
  sender: { getURL: () => '' },
}

const projection: AgentStatusProjection = {
  agent: {
    id: '92d74aaf-b86c-4e84-978b-b35d227e0c79',
    name: 'IPC Agent',
    description: '',
    executionMode: 'workflow',
    archivedAt: null,
    createdAt: '2026-08-20T01:00:00.000Z',
    updatedAt: '2026-08-20T01:00:00.000Z',
  },
  draftRevision: 3,
  currentVersion: null,
  stack: { status: 'blocked', componentCount: 0, ownerCount: 0, issueCount: 1 },
  latestRun: null,
  latestExperiment: null,
  latestPublish: null,
}

describe('agent status IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('validates list/get inputs and the shared status projection output', async () => {
    const list = vi.fn(() => [projection])
    const get = vi.fn(() => projection)
    const unregister = registerAgentIpc({
      agents: {} as AgentService,
      agentStatus: { list, get } as unknown as AgentStatusService,
      imports: {} as ImportService,
      getWindow: () => undefined,
    })

    await expect(
      electron.handlers.get(ipcChannels.agentStatusList)?.(trustedEvent, { scope: 'active' }),
    ).resolves.toEqual([projection])
    await expect(
      electron.handlers.get(ipcChannels.agentStatusGet)?.(trustedEvent, {
        id: projection.agent.id,
      }),
    ).resolves.toEqual(projection)
    expect(list).toHaveBeenCalledWith({ scope: 'active' })
    expect(get).toHaveBeenCalledWith(projection.agent.id)

    unregister()
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.agentStatusList)
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.agentStatusGet)
  })

  it('rejects extra fields before reading any local facts', async () => {
    const list = vi.fn()
    const get = vi.fn()
    registerAgentIpc({
      agents: {} as AgentService,
      agentStatus: { list, get } as unknown as AgentStatusService,
      imports: {} as ImportService,
      getWindow: () => undefined,
    })

    await expect(
      electron.handlers.get(ipcChannels.agentStatusList)?.(trustedEvent, {
        scope: 'active',
        databasePath: '/tmp/outside.sqlite3',
      }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    await expect(
      electron.handlers.get(ipcChannels.agentStatusGet)?.(trustedEvent, {
        id: projection.agent.id,
        includeSecrets: true,
      }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    expect(list).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
})
