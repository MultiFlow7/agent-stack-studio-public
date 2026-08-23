import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcChannels } from '../../shared/ipc'
import type { RendererPreferences } from '../../shared/preferences'
import type { ApplicationPreferencesService } from '../preferences/application-preferences-service'

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

import { registerPreferencesIpc } from './register-preferences-ipc'

const trustedFrame = {
  url: 'file:///Applications/Agent%20Stack%20Studio.app/Contents/Resources/app.asar/dist/renderer/index.html',
}
const trustedEvent = {
  senderFrame: trustedFrame,
  sender: { mainFrame: trustedFrame, getURL: () => trustedFrame.url },
}

describe('preferences IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('returns and updates only the shared Renderer preference contract', async () => {
    const renderer = vi.fn(() => ({ sidebarCollapsed: false, lastView: 'agents' as const }))
    const updateRenderer = vi.fn((input: RendererPreferences) => input)
    const unregister = registerPreferencesIpc({
      renderer,
      updateRenderer,
    } as unknown as ApplicationPreferencesService)

    await expect(
      electron.handlers.get(ipcChannels.preferencesGet)?.(trustedEvent, {}),
    ).resolves.toEqual({ sidebarCollapsed: false, lastView: 'agents' })
    await expect(
      electron.handlers.get(ipcChannels.preferencesUpdate)?.(trustedEvent, {
        sidebarCollapsed: true,
        lastView: 'settings',
      }),
    ).resolves.toEqual({ sidebarCollapsed: true, lastView: 'settings' })
    expect(updateRenderer).toHaveBeenCalledWith({ sidebarCollapsed: true, lastView: 'settings' })

    unregister()
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.preferencesGet)
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.preferencesUpdate)
  })

  it('rejects unknown views and extra fields before persistence', async () => {
    const updateRenderer = vi.fn()
    registerPreferencesIpc({
      renderer: vi.fn(),
      updateRenderer,
    } as unknown as ApplicationPreferencesService)
    const handler = electron.handlers.get(ipcChannels.preferencesUpdate)

    await expect(
      handler?.(trustedEvent, { sidebarCollapsed: false, lastView: '../outside' }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    await expect(
      handler?.(trustedEvent, { sidebarCollapsed: false, lastView: 'agents', rawPath: '/tmp' }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    expect(updateRenderer).not.toHaveBeenCalled()
  })
})
