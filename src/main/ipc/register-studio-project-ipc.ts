import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { componentListSchema } from '../../shared/component'
import { ipcChannels } from '../../shared/ipc'
import {
  emptyProjectInputSchema,
  projectComponentInputSchema,
  projectDescriptorInputSchema,
  projectMutationInputSchema,
  projectOwnerInputSchema,
  projectWorkflowCreateInputSchema,
  projectWorkflowEdgeAddInputSchema,
  projectWorkflowEdgeRemoveInputSchema,
  projectWorkflowFreezeInputSchema,
  projectWorkflowNodeAddInputSchema,
  projectWorkflowNodeRemoveInputSchema,
  studioProjectStateSchema,
} from '../../shared/studio-project'
import type { StudioProjectService } from '../projects/studio-project-service'
import { createValidatedHandler } from './validated-handler'
import { projectExportResultSchema } from '../../shared/agent-stack-package'

export function registerStudioProjectIpc(options: {
  projects: StudioProjectService
  getWindow: () => BrowserWindow | undefined
  selectExportDestination?: (defaultFileName: string) => Promise<string | null>
}): () => void {
  const showDirectory = async (title: string, buttonLabel: string) => {
    const dialogOptions: Electron.OpenDialogOptions = {
      title,
      buttonLabel,
      properties: ['openDirectory', 'createDirectory'],
    }
    const window = options.getWindow()
    return window
      ? dialog.showOpenDialog(window, dialogOptions)
      : dialog.showOpenDialog(dialogOptions)
  }

  ipcMain.handle(
    ipcChannels.studioProjectCurrent,
    createValidatedHandler({
      input: emptyProjectInputSchema,
      output: studioProjectStateSchema,
      handle: () => options.projects.current(),
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectOpen,
    createValidatedHandler({
      input: emptyProjectInputSchema,
      output: studioProjectStateSchema,
      handle: async () => {
        const selection = await showDirectory('打开 Studio 项目', '打开项目')
        const root = selection.filePaths[0]
        if (selection.canceled || !root) return options.projects.current()
        return options.projects.open(root)
      },
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectInit,
    createValidatedHandler({
      input: emptyProjectInputSchema,
      output: studioProjectStateSchema,
      handle: async () => {
        const selection = await showDirectory('创建 Studio 项目', '在此创建')
        const root = selection.filePaths[0]
        if (selection.canceled || !root) return options.projects.current()
        return options.projects.init(root)
      },
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectImport,
    createValidatedHandler({
      input: projectMutationInputSchema,
      output: studioProjectStateSchema,
      handle: async ({ expectedRevision }) => {
        const selection = await showDirectory('导入本地组件仓库', '静态检查并导入')
        const source = selection.filePaths[0]
        if (selection.canceled || !source) return options.projects.current()
        return options.projects.importComponent(source, expectedRevision)
      },
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectDescriptorUpdate,
    createValidatedHandler({
      input: projectDescriptorInputSchema,
      output: studioProjectStateSchema,
      handle: (input) =>
        options.projects.updateDescriptor(
          input.componentId,
          input.descriptor,
          input.expectedRevision,
        ),
    }),
  )
  for (const [channel, handle] of [
    [
      ipcChannels.studioProjectComponentArchive,
      (input: typeof projectComponentInputSchema._output) =>
        options.projects.archive(input.componentId, input.expectedRevision),
    ],
    [
      ipcChannels.studioProjectComponentDelete,
      (input: typeof projectComponentInputSchema._output) =>
        options.projects.delete(input.componentId, input.expectedRevision),
    ],
    [
      ipcChannels.studioProjectStackAdd,
      (input: typeof projectComponentInputSchema._output) =>
        options.projects.stackAdd(input.componentId, input.expectedRevision),
    ],
    [
      ipcChannels.studioProjectStackRemove,
      (input: typeof projectComponentInputSchema._output) =>
        options.projects.stackRemove(input.componentId, input.expectedRevision),
    ],
  ] as const) {
    ipcMain.handle(
      channel,
      createValidatedHandler({
        input: projectComponentInputSchema,
        output: studioProjectStateSchema,
        handle,
      }),
    )
  }
  ipcMain.handle(
    ipcChannels.studioProjectOwnerSet,
    createValidatedHandler({
      input: projectOwnerInputSchema,
      output: studioProjectStateSchema,
      handle: (input) =>
        options.projects.ownerSet(input.capability, input.componentId, input.expectedRevision),
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectWorkflowCreate,
    createValidatedHandler({
      input: projectWorkflowCreateInputSchema,
      output: studioProjectStateSchema,
      handle: ({ name, description, expectedRevision }) =>
        options.projects.workflowCreate(name, description, expectedRevision),
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectWorkflowNodeAdd,
    createValidatedHandler({
      input: projectWorkflowNodeAddInputSchema,
      output: studioProjectStateSchema,
      handle: ({ workflowId, node, expectedRevision }) =>
        options.projects.workflowNodeAdd(workflowId, node, expectedRevision),
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectWorkflowNodeRemove,
    createValidatedHandler({
      input: projectWorkflowNodeRemoveInputSchema,
      output: studioProjectStateSchema,
      handle: ({ workflowId, nodeId, expectedRevision }) =>
        options.projects.workflowNodeRemove(workflowId, nodeId, expectedRevision),
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectWorkflowEdgeAdd,
    createValidatedHandler({
      input: projectWorkflowEdgeAddInputSchema,
      output: studioProjectStateSchema,
      handle: ({ workflowId, from, to, expectedRevision }) =>
        options.projects.workflowEdgeAdd(workflowId, from, to, expectedRevision),
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectWorkflowEdgeRemove,
    createValidatedHandler({
      input: projectWorkflowEdgeRemoveInputSchema,
      output: studioProjectStateSchema,
      handle: ({ workflowId, edgeId, expectedRevision }) =>
        options.projects.workflowEdgeRemove(workflowId, edgeId, expectedRevision),
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectWorkflowFreeze,
    createValidatedHandler({
      input: projectWorkflowFreezeInputSchema,
      output: studioProjectStateSchema,
      handle: ({ workflowId, expectedRevision }) =>
        options.projects.workflowFreeze(workflowId, expectedRevision),
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectFreeze,
    createValidatedHandler({
      input: projectMutationInputSchema,
      output: studioProjectStateSchema,
      handle: ({ expectedRevision }) => options.projects.freeze(expectedRevision),
    }),
  )
  ipcMain.handle(
    ipcChannels.studioProjectExport,
    createValidatedHandler({
      input: emptyProjectInputSchema,
      output: projectExportResultSchema,
      handle: async () => {
        const current = await options.projects.current()
        if (!current.project) throw new Error('请先打开或创建 Studio 项目。')
        const safeName = current.project.name
          .normalize('NFKC')
          .replaceAll(/[^\p{Letter}\p{Number}._-]+/gu, '-')
          .replaceAll(/^-+|-+$/g, '')
        const defaultFileName = `${safeName || 'agent-stack'}.agent-stack-package.json`
        const dialogOptions: Electron.SaveDialogOptions = {
          title: '导出可移植 Agent Stack Package',
          buttonLabel: '导出包',
          defaultPath: defaultFileName,
          filters: [{ name: 'Agent Stack Package', extensions: ['json'] }],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        }
        if (options.selectExportDestination) {
          const destination = await options.selectExportDestination(defaultFileName)
          return destination
            ? options.projects.exportTo(destination)
            : { status: 'cancelled' as const }
        }
        const window = options.getWindow()
        const selection = window
          ? await dialog.showSaveDialog(window, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions)
        if (selection.canceled || !selection.filePath) return { status: 'cancelled' as const }
        return options.projects.exportTo(selection.filePath)
      },
    }),
  )
  ipcMain.handle(
    ipcChannels.demoDataLoad,
    createValidatedHandler({
      input: emptyProjectInputSchema,
      output: componentListSchema,
      handle: () => options.projects.loadDemoData(),
    }),
  )

  const removeChanged = options.projects.onChanged(() =>
    options.getWindow()?.webContents.send(ipcChannels.studioProjectExternalChanged),
  )
  const channels = [
    ipcChannels.studioProjectCurrent,
    ipcChannels.studioProjectOpen,
    ipcChannels.studioProjectInit,
    ipcChannels.studioProjectImport,
    ipcChannels.studioProjectDescriptorUpdate,
    ipcChannels.studioProjectComponentArchive,
    ipcChannels.studioProjectComponentDelete,
    ipcChannels.studioProjectStackAdd,
    ipcChannels.studioProjectStackRemove,
    ipcChannels.studioProjectOwnerSet,
    ipcChannels.studioProjectWorkflowCreate,
    ipcChannels.studioProjectWorkflowNodeAdd,
    ipcChannels.studioProjectWorkflowNodeRemove,
    ipcChannels.studioProjectWorkflowEdgeAdd,
    ipcChannels.studioProjectWorkflowEdgeRemove,
    ipcChannels.studioProjectWorkflowFreeze,
    ipcChannels.studioProjectFreeze,
    ipcChannels.studioProjectExport,
    ipcChannels.demoDataLoad,
  ]
  return () => {
    removeChanged()
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
