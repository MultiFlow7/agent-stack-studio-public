import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentCatalogItem } from '../../shared/component-catalog'
import { ipcChannels } from '../../shared/ipc'
import { builtInComponents } from '../components/built-in-components'
import type { ComponentCatalogService } from '../components/component-catalog-service'
import type { ComponentService } from '../components/component-service'

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

import { registerComponentIpc } from './register-component-ipc'

const trustedFrame = {
  url: 'file:///Applications/Agent%20Stack%20Studio.app/Contents/Resources/app.asar/dist/renderer/index.html',
}
const trustedEvent = {
  senderFrame: trustedFrame,
  sender: { mainFrame: trustedFrame, getURL: () => trustedFrame.url },
}

const item: ComponentCatalogItem = {
  component: {
    ...builtInComponents[0],
    createdAt: '2026-08-20T01:00:00.000Z',
    updatedAt: '2026-08-20T02:00:00.000Z',
  },
  usedByAgents: [],
  affectedVersions: [],
  validationRecord: {
    status: 'runtime-verified',
    recordedAt: '2026-08-20T02:00:00.000Z',
  },
}

describe('component catalog IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('returns only the validated catalog and detail contracts', async () => {
    const list = vi.fn(() => [item])
    const get = vi.fn(() => item)
    const unregister = registerComponentIpc({
      components: {} as ComponentService,
      catalog: { list, get } as unknown as ComponentCatalogService,
    })

    await expect(
      electron.handlers.get(ipcChannels.componentsCatalog)?.(trustedEvent, undefined),
    ).resolves.toEqual([item])
    await expect(
      electron.handlers.get(ipcChannels.componentsGet)?.(trustedEvent, {
        id: item.component.id,
      }),
    ).resolves.toEqual(item)
    expect(get).toHaveBeenCalledWith(item.component.id)

    unregister()
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.componentsCatalog)
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.componentsGet)
  })

  it('rejects arbitrary input before reading component facts', async () => {
    const list = vi.fn()
    const get = vi.fn()
    registerComponentIpc({
      components: {} as ComponentService,
      catalog: { list, get } as unknown as ComponentCatalogService,
    })

    await expect(
      electron.handlers.get(ipcChannels.componentsCatalog)?.(trustedEvent, {}),
    ).rejects.toThrow('提交的 Agent 数据无效')
    await expect(
      electron.handlers.get(ipcChannels.componentsGet)?.(trustedEvent, {
        id: item.component.id,
        databasePath: '/tmp/outside.sqlite3',
      }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    expect(list).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
})
