import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ipcChannels } from '../../shared/ipc'
import type { StudioProjectService } from '../projects/studio-project-service'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  handle: vi.fn(),
  removeHandler: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: electron.showOpenDialog,
    showSaveDialog: electron.showSaveDialog,
  },
  ipcMain: {
    handle: electron.handle.mockImplementation(
      (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
        electron.handlers.set(channel, handler)
      },
    ),
    removeHandler: electron.removeHandler,
  },
}))

import { registerStudioProjectIpc } from './register-studio-project-ipc'

const trustedFrame = {
  url: 'file:///Applications/Agent%20Stack%20Studio.app/Contents/Resources/app.asar/dist/renderer/index.html',
}
const trustedEvent = {
  senderFrame: trustedFrame,
  sender: { mainFrame: trustedFrame, getURL: () => trustedFrame.url },
}

const currentProject = {
  projectPath: '/trusted/project/.agent-stack',
  project: { name: '共享 Fixture' },
}

describe('Studio Project export IPC', () => {
  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('lets Main choose the destination and returns only the validated export receipt', async () => {
    electron.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/trusted/exports/shared.agent-stack-package.json',
    })
    const exportTo = vi.fn().mockResolvedValue({
      status: 'exported',
      path: '/trusted/exports/shared.agent-stack-package.json',
      packageHash: 'a'.repeat(64),
      projectRevision: 4,
      componentCount: 2,
      workflowCount: 0,
      versionCount: 1,
      excludedContent: [
        'keychain-secrets',
        'sqlite-local-index',
        'runs-and-experiments',
        'receipts-and-remote-mappings',
        'artifacts-and-logs',
        'absolute-local-paths',
      ],
    })
    const projects = {
      current: vi.fn().mockResolvedValue(currentProject),
      exportTo,
      onChanged: vi.fn().mockReturnValue(() => undefined),
    } as unknown as StudioProjectService
    const unregister = registerStudioProjectIpc({ projects, getWindow: () => undefined })
    const handler = electron.handlers.get(ipcChannels.studioProjectExport)

    await expect(handler?.(trustedEvent, {})).resolves.toMatchObject({
      status: 'exported',
      packageHash: 'a'.repeat(64),
    })
    expect(electron.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: '共享-Fixture.agent-stack-package.json',
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      }),
    )
    expect(exportTo).toHaveBeenCalledWith('/trusted/exports/shared.agent-stack-package.json')

    unregister()
    expect(electron.removeHandler).toHaveBeenCalledWith(ipcChannels.studioProjectExport)
  })

  it('returns cancellation and rejects Renderer-supplied paths before opening a dialog', async () => {
    electron.showSaveDialog.mockResolvedValue({ canceled: true })
    const exportTo = vi.fn()
    registerStudioProjectIpc({
      projects: {
        current: vi.fn().mockResolvedValue(currentProject),
        exportTo,
        onChanged: vi.fn().mockReturnValue(() => undefined),
      } as unknown as StudioProjectService,
      getWindow: () => undefined,
    })
    const handler = electron.handlers.get(ipcChannels.studioProjectExport)

    await expect(handler?.(trustedEvent, {})).resolves.toEqual({ status: 'cancelled' })
    await expect(handler?.(trustedEvent, { path: '/tmp/untrusted' })).rejects.toThrow(
      '提交的 Agent 数据无效',
    )
    expect(exportTo).not.toHaveBeenCalled()
  })

  it('strictly validates every Workflow mutation before calling Studio Core', async () => {
    const workflowCreate = vi.fn()
    const workflowNodeAdd = vi.fn()
    const workflowNodeRemove = vi.fn()
    const workflowEdgeAdd = vi.fn()
    const workflowEdgeRemove = vi.fn()
    const workflowFreeze = vi.fn()
    registerStudioProjectIpc({
      projects: {
        workflowCreate,
        workflowNodeAdd,
        workflowNodeRemove,
        workflowEdgeAdd,
        workflowEdgeRemove,
        workflowFreeze,
        onChanged: vi.fn().mockReturnValue(() => undefined),
      } as unknown as StudioProjectService,
      getWindow: () => undefined,
    })
    const workflowId = randomUUID()
    const nodeId = randomUUID()
    const cases = [
      [
        ipcChannels.studioProjectWorkflowCreate,
        { expectedRevision: 0, name: 'DAG', description: '', path: '/tmp/untrusted' },
      ],
      [
        ipcChannels.studioProjectWorkflowNodeAdd,
        {
          expectedRevision: 0,
          workflowId,
          node: { kind: 'operation', name: 'Start', operation: 'start' },
          path: '/tmp/untrusted',
        },
      ],
      [
        ipcChannels.studioProjectWorkflowNodeRemove,
        { expectedRevision: 0, workflowId, nodeId, path: '/tmp/untrusted' },
      ],
      [
        ipcChannels.studioProjectWorkflowEdgeAdd,
        { expectedRevision: 0, workflowId, from: nodeId, to: randomUUID(), path: '/tmp/untrusted' },
      ],
      [
        ipcChannels.studioProjectWorkflowEdgeRemove,
        { expectedRevision: 0, workflowId, edgeId: randomUUID(), path: '/tmp/untrusted' },
      ],
      [
        ipcChannels.studioProjectWorkflowFreeze,
        { expectedRevision: 0, workflowId, path: '/tmp/untrusted' },
      ],
    ] as const

    for (const [channel, input] of cases) {
      await expect(electron.handlers.get(channel)?.(trustedEvent, input)).rejects.toThrow(
        '提交的 Agent 数据无效',
      )
    }
    for (const handler of [
      workflowCreate,
      workflowNodeAdd,
      workflowNodeRemove,
      workflowEdgeAdd,
      workflowEdgeRemove,
      workflowFreeze,
    ]) {
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it('strictly validates compatibility lifecycle inputs and exposes cancellation only by component ID', async () => {
    const componentId = randomUUID()
    const restore = vi.fn().mockRejectedValue(new Error('restore reached'))
    const recheck = vi.fn().mockRejectedValue(new Error('recheck reached'))
    const contractTest = vi.fn().mockRejectedValue(new Error('contract reached'))
    const runtimeValidate = vi.fn().mockRejectedValue(new Error('runtime reached'))
    const cancelRuntimeValidation = vi.fn().mockReturnValue(true)
    registerStudioProjectIpc({
      projects: {
        restore,
        recheck,
        contractTest,
        runtimeValidate,
        cancelRuntimeValidation,
        onChanged: vi.fn().mockReturnValue(() => undefined),
      } as unknown as StudioProjectService,
      getWindow: () => undefined,
    })

    for (const channel of [
      ipcChannels.studioProjectComponentRestore,
      ipcChannels.studioProjectComponentRecheck,
      ipcChannels.studioProjectComponentContractTest,
      ipcChannels.studioProjectComponentRuntimeValidate,
      ipcChannels.studioProjectComponentRuntimeCancel,
    ]) {
      await expect(
        electron.handlers.get(channel)?.(trustedEvent, {
          componentId,
          expectedRevision: 4,
          path: '/tmp/untrusted',
        }),
      ).rejects.toThrow('提交的 Agent 数据无效')
    }
    expect(restore).not.toHaveBeenCalled()
    expect(recheck).not.toHaveBeenCalled()
    expect(contractTest).not.toHaveBeenCalled()
    expect(runtimeValidate).not.toHaveBeenCalled()

    await expect(
      electron.handlers.get(ipcChannels.studioProjectComponentRuntimeValidate)?.(trustedEvent, {
        componentId,
        expectedRevision: 4,
        timeoutMs: 1_500,
      }),
    ).rejects.toThrow('Agent Stack Studio 无法完成此操作')
    expect(runtimeValidate).toHaveBeenCalledWith(componentId, 4, 1_500)
    await expect(
      electron.handlers.get(ipcChannels.studioProjectComponentRuntimeCancel)?.(trustedEvent, {
        componentId,
      }),
    ).resolves.toEqual({ cancelled: true })
    expect(cancelRuntimeValidation).toHaveBeenCalledWith(componentId)
  })

  it('prompts to relink a missing component source and keeps cancellation write-free', async () => {
    const componentId = randomUUID()
    const state = {
      projectPath: null,
      localAgentId: null,
      project: null,
      validation: null,
      integrity: null,
      recovered: false,
      changedExternally: false,
      cliPath: '/trusted/studio.mjs',
    }
    const current = vi.fn().mockResolvedValue(state)
    const componentSourcePath = vi.fn().mockResolvedValue(null)
    const recheck = vi.fn().mockResolvedValue(state)
    registerStudioProjectIpc({
      projects: {
        current,
        componentSourcePath,
        recheck,
        onChanged: vi.fn().mockReturnValue(() => undefined),
      } as unknown as StudioProjectService,
      getWindow: () => undefined,
    })

    electron.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(
      electron.handlers.get(ipcChannels.studioProjectComponentRecheck)?.(trustedEvent, {
        componentId,
        expectedRevision: 11,
      }),
    ).resolves.toEqual(state)
    expect(recheck).not.toHaveBeenCalled()

    electron.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/trusted/sources/pi'],
    })
    await expect(
      electron.handlers.get(ipcChannels.studioProjectComponentRecheck)?.(trustedEvent, {
        componentId,
        expectedRevision: 11,
      }),
    ).resolves.toEqual(state)
    expect(recheck).toHaveBeenCalledWith(componentId, 11, '/trusted/sources/pi')
  })
})
