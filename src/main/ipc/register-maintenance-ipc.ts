import { randomUUID } from 'node:crypto'
import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import {
  applyRestoreInputSchema,
  applyRestoreResultSchema,
  createBackupResultSchema,
  emptyMaintenanceInputSchema,
  maintenanceStatusSchema,
  revealDataLocationInputSchema,
  revealDataLocationResultSchema,
  selectRestoreResultSchema,
} from '../../shared/maintenance'
import { AppError } from '../../shared/errors'
import { ipcChannels } from '../../shared/ipc'
import type { DataMaintenanceService } from '../maintenance/data-maintenance-service'
import { createValidatedHandler } from './validated-handler'

export function registerMaintenanceIpc(options: {
  maintenance: DataMaintenanceService
  getWindow: () => BrowserWindow | undefined
  scheduleRestart: () => void
}): () => void {
  const selectedBackups = new Map<string, string>()
  const inFlight = new Map<string, Promise<unknown>>()
  const singleFlight = <T>(key: string, action: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const task = action().finally(() => {
      if (inFlight.get(key) === task) inFlight.delete(key)
    })
    inFlight.set(key, task)
    return task
  }
  const showOpenDialog = (dialogOptions: Electron.OpenDialogOptions) => {
    const window = options.getWindow()
    return window
      ? dialog.showOpenDialog(window, dialogOptions)
      : dialog.showOpenDialog(dialogOptions)
  }

  ipcMain.handle(
    ipcChannels.maintenanceStatus,
    createValidatedHandler({
      input: emptyMaintenanceInputSchema,
      output: maintenanceStatusSchema,
      handle: () => options.maintenance.status(),
    }),
  )
  ipcMain.handle(
    ipcChannels.maintenanceCreateBackup,
    createValidatedHandler({
      input: emptyMaintenanceInputSchema,
      output: createBackupResultSchema,
      handle: () =>
        singleFlight('backup', async () => {
          const result = await showOpenDialog({
            title: '选择备份保存位置',
            buttonLabel: '在此创建备份',
            properties: ['openDirectory', 'createDirectory'],
          })
          const destination = result.filePaths[0]
          if (result.canceled || !destination) return { status: 'cancelled' as const }
          return options.maintenance.createBackup(destination)
        }),
    }),
  )
  ipcMain.handle(
    ipcChannels.maintenanceSelectRestore,
    createValidatedHandler({
      input: emptyMaintenanceInputSchema,
      output: selectRestoreResultSchema,
      handle: () =>
        singleFlight('select-restore', async () => {
          const result = await showOpenDialog({
            title: '选择 Agent Stack Studio 备份',
            buttonLabel: '检查备份',
            properties: ['openDirectory'],
          })
          const sourcePath = result.filePaths[0]
          if (result.canceled || !sourcePath) return { status: 'cancelled' as const }
          const inspected = await options.maintenance.inspectBackup(sourcePath)
          const selectionId = randomUUID()
          selectedBackups.clear()
          selectedBackups.set(selectionId, sourcePath)
          return { status: 'selected' as const, preview: { ...inspected.preview, selectionId } }
        }),
    }),
  )
  ipcMain.handle(
    ipcChannels.maintenanceApplyRestore,
    createValidatedHandler({
      input: applyRestoreInputSchema,
      output: applyRestoreResultSchema,
      handle: ({ selectionId }) =>
        singleFlight(`restore:${selectionId}`, async () => {
          const sourcePath = selectedBackups.get(selectionId)
          if (!sourcePath) {
            throw new AppError('NOT_FOUND', '恢复选择已失效，请重新检查备份。')
          }
          const staged = await options.maintenance.stageRestore(sourcePath)
          selectedBackups.clear()
          setTimeout(options.scheduleRestart, 300)
          return { status: 'restarting' as const, backupName: staged.preview.backupName }
        }),
    }),
  )
  ipcMain.handle(
    ipcChannels.maintenanceRevealDataLocation,
    createValidatedHandler({
      input: revealDataLocationInputSchema,
      output: revealDataLocationResultSchema,
      handle: async ({ id }) => {
        const location = await options.maintenance.prepareDataLocation(id)
        if (location.kind === 'file') shell.showItemInFolder(location.path)
        else {
          const error = await shell.openPath(location.path)
          if (error) throw new AppError('NOT_FOUND', `无法在 Finder 中打开${location.label}。`)
        }
        return { status: 'revealed' as const, id }
      },
    }),
  )

  return () => {
    selectedBackups.clear()
    inFlight.clear()
    for (const channel of [
      ipcChannels.maintenanceStatus,
      ipcChannels.maintenanceCreateBackup,
      ipcChannels.maintenanceSelectRestore,
      ipcChannels.maintenanceApplyRestore,
      ipcChannels.maintenanceRevealDataLocation,
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}
