import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcChannels } from '../../shared/ipc'
import type { DataMaintenanceService } from '../maintenance/data-maintenance-service'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  handle: vi.fn(),
  removeHandler: vi.fn(),
  openPath: vi.fn(),
  showItemInFolder: vi.fn(),
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
  shell: {
    openPath: electron.openPath,
    showItemInFolder: electron.showItemInFolder,
  },
}))

import { registerMaintenanceIpc } from './register-maintenance-ipc'

const trustedEvent = {
  senderFrame: { url: 'file:///Applications/Agent%20Stack%20Studio.app/renderer/index.html' },
  sender: { getURL: () => '' },
}

describe('maintenance data-location IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
    electron.openPath.mockResolvedValue('')
  })

  it('maps an allowlisted directory identifier to Main-owned Finder access', async () => {
    const prepareDataLocation = vi.fn(() =>
      Promise.resolve({
        id: 'recovery' as const,
        label: 'Recovery',
        path: '/trusted/recovery',
        kind: 'directory' as const,
        purpose: '回滚备份',
        includedInBackup: false,
      }),
    )
    const maintenance = { prepareDataLocation } as unknown as DataMaintenanceService
    const unregister = registerMaintenanceIpc({
      maintenance,
      getWindow: () => undefined,
      scheduleRestart: vi.fn(),
    })
    const handler = electron.handlers.get(ipcChannels.maintenanceRevealDataLocation)

    await expect(handler?.(trustedEvent, { id: 'recovery' })).resolves.toEqual({
      status: 'revealed',
      id: 'recovery',
    })
    expect(prepareDataLocation).toHaveBeenCalledWith('recovery')
    expect(electron.openPath).toHaveBeenCalledWith('/trusted/recovery')
    expect(electron.showItemInFolder).not.toHaveBeenCalled()

    unregister()
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.maintenanceRevealDataLocation)
  })

  it('rejects raw paths and unknown identifiers before calling the service', async () => {
    const prepareDataLocation = vi.fn()
    registerMaintenanceIpc({
      maintenance: { prepareDataLocation } as unknown as DataMaintenanceService,
      getWindow: () => undefined,
      scheduleRestart: vi.fn(),
    })
    const handler = electron.handlers.get(ipcChannels.maintenanceRevealDataLocation)

    await expect(
      handler?.(trustedEvent, { id: 'recovery', path: '/tmp/untrusted' }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    await expect(handler?.(trustedEvent, { id: '../outside' })).rejects.toThrow(
      '提交的 Agent 数据无效',
    )
    expect(prepareDataLocation).not.toHaveBeenCalled()
  })

  it('reveals the SQLite file without accepting a Renderer-supplied file path', async () => {
    const prepareDataLocation = vi.fn(() =>
      Promise.resolve({
        id: 'database' as const,
        label: 'SQLite',
        path: '/trusted/studio.sqlite3',
        kind: 'file' as const,
        purpose: '本机索引',
        includedInBackup: true,
      }),
    )
    registerMaintenanceIpc({
      maintenance: { prepareDataLocation } as unknown as DataMaintenanceService,
      getWindow: () => undefined,
      scheduleRestart: vi.fn(),
    })
    const handler = electron.handlers.get(ipcChannels.maintenanceRevealDataLocation)

    await expect(handler?.(trustedEvent, { id: 'database' })).resolves.toMatchObject({
      status: 'revealed',
    })
    expect(electron.showItemInFolder).toHaveBeenCalledWith('/trusted/studio.sqlite3')
    expect(electron.openPath).not.toHaveBeenCalled()
  })
})
