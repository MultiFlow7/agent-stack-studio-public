import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcChannels } from '../../shared/ipc'
import type { CommandCenterService } from '../command-center/command-center-service'

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

import { registerCommandCenterIpc } from './register-command-center-ipc'

const trustedEvent = {
  senderFrame: { url: 'file:///Applications/Agent%20Stack%20Studio.app/renderer/index.html' },
  sender: { getURL: () => '' },
}

describe('command center IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('validates strict empty snapshot input and bounded local search input', async () => {
    const snapshot = vi.fn(() =>
      Promise.resolve({
        workspace: { status: 'empty', name: null, revision: null, issueCount: 0 },
        activity: { status: 'idle', activeRunCount: 0, latestRun: null },
        counts: { activeAgents: 0, archivedAgents: 0, components: 0, runs: 0, experiments: 0 },
        refreshedAt: '2026-08-21T01:02:00.000Z',
      }),
    )
    const search = vi.fn(() => Promise.resolve([]))
    const unregister = registerCommandCenterIpc({
      snapshot,
      search,
    } as unknown as CommandCenterService)

    await expect(
      electron.handlers.get(ipcChannels.commandCenterSnapshot)?.(trustedEvent, {}),
    ).resolves.toMatchObject({ workspace: { status: 'empty' } })
    await expect(
      electron.handlers.get(ipcChannels.commandCenterSearch)?.(trustedEvent, { query: 'Run' }),
    ).resolves.toEqual([])
    expect(search).toHaveBeenCalledWith('Run')

    await expect(
      electron.handlers.get(ipcChannels.commandCenterSearch)?.(trustedEvent, {
        query: 'Run',
        path: '/tmp/private',
      }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    unregister()
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.commandCenterSnapshot)
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.commandCenterSearch)
  })
})
