import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcChannels } from '../../shared/ipc'
import type { CustomizationService } from '../customization/customization-service'
import type { StudioProjectService } from '../projects/studio-project-service'

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

import { registerCustomizationIpc } from './register-customization-ipc'

const trustedFrame = {
  url: 'file:///Applications/Agent%20Stack%20Studio.app/Contents/Resources/app.asar/dist/renderer/index.html',
}
const trustedEvent = {
  senderFrame: trustedFrame,
  sender: { mainFrame: trustedFrame, getURL: () => trustedFrame.url },
}

describe('Customization IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('rejects arbitrary install paths and injects the active project path in Main', async () => {
    const install = vi.fn().mockRejectedValue(new Error('install reached'))
    const current = vi.fn().mockResolvedValue({ projectPath: '/trusted/project/.agent-stack' })
    registerCustomizationIpc({
      customization: {
        install,
        recognize: vi.fn(),
        task: vi.fn(),
        cancel: vi.fn(),
      } as unknown as CustomizationService,
      projects: { current } as unknown as StudioProjectService,
    })
    const handler = electron.handlers.get(ipcChannels.customizationInstall)
    const input = {
      recipeId: 'anthropic-algorithmic-art',
      harnessId: 'openclaw',
      expectedRevision: 4,
      confirmed: true,
    }

    await expect(
      handler?.(trustedEvent, { ...input, projectPath: '/untrusted/project' }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    expect(install).not.toHaveBeenCalled()
    await expect(handler?.(trustedEvent, input)).rejects.toThrow('无法完成此操作')
    expect(install).toHaveBeenCalledWith({
      ...input,
      operation: 'install',
      projectPath: '/trusted/project/.agent-stack',
    })
  })

  it('strictly validates recognition and removes every handler on unregister', async () => {
    const recognize = vi.fn()
    const cancel = vi.fn().mockReturnValue(true)
    const unregister = registerCustomizationIpc({
      customization: {
        install: vi.fn(),
        recognize,
        task: vi.fn(),
        cancel,
      } as unknown as CustomizationService,
      projects: { current: vi.fn() } as unknown as StudioProjectService,
    })

    await expect(
      electron.handlers.get(ipcChannels.customizationRecognize)?.(trustedEvent, {
        source: 'fixture/source',
        harnessId: 'unknown',
        executable: 'sh',
      }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    expect(recognize).not.toHaveBeenCalled()
    await expect(
      electron.handlers.get(ipcChannels.customizationCancel)?.(trustedEvent, {}),
    ).resolves.toEqual({ cancelled: true })

    unregister()
    for (const channel of [
      ipcChannels.customizationRecognize,
      ipcChannels.customizationTask,
      ipcChannels.customizationInstall,
      ipcChannels.customizationUpdate,
      ipcChannels.customizationCheck,
      ipcChannels.customizationSmoke,
      ipcChannels.customizationUninstall,
      ipcChannels.customizationRestore,
      ipcChannels.customizationCancel,
    ]) {
      expect(electron.removeHandler).toHaveBeenCalledWith(channel)
    }
  })

  it('injects the active project into lifecycle checks and accepts only opaque restore ids', async () => {
    const check = vi.fn().mockResolvedValue([])
    const restore = vi.fn().mockResolvedValue({
      status: 'restored',
      projectId: '10000000-0000-4000-8000-000000000001',
      revision: 4,
      snapshotId: '30000000-0000-4000-8000-000000000003',
    })
    registerCustomizationIpc({
      customization: {
        install: vi.fn(),
        recognize: vi.fn(),
        task: vi.fn(),
        check,
        restore,
        cancel: vi.fn(),
      } as unknown as CustomizationService,
      projects: {
        current: vi.fn().mockResolvedValue({ projectPath: '/trusted/project/.agent-stack' }),
      } as unknown as StudioProjectService,
    })

    await expect(
      electron.handlers.get(ipcChannels.customizationCheck)?.(trustedEvent, {
        harnessId: 'codex',
      }),
    ).resolves.toEqual([])
    expect(check).toHaveBeenCalledWith({
      harnessId: 'codex',
      projectPath: '/trusted/project/.agent-stack',
    })
    const restoreInput = {
      snapshotId: '30000000-0000-4000-8000-000000000003',
      expectedRevision: 5,
      confirmed: true,
    }
    await expect(
      electron.handlers.get(ipcChannels.customizationRestore)?.(trustedEvent, {
        ...restoreInput,
        snapshotPath: '/tmp/untrusted',
      }),
    ).rejects.toThrow('提交的 Agent 数据无效')
    await expect(
      electron.handlers.get(ipcChannels.customizationRestore)?.(trustedEvent, restoreInput),
    ).resolves.toMatchObject({ status: 'restored' })
    expect(restore).toHaveBeenCalledWith({
      ...restoreInput,
      projectPath: '/trusted/project/.agent-stack',
    })
  })
})
