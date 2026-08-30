import { ipcMain } from 'electron'
import { z } from 'zod'
import { ipcChannels } from '../../shared/ipc'
import {
  customizationCancelResultSchema,
  customizationRecipeStatusListSchema,
  customizationInstallResultSchema,
  customizationRecognitionInputSchema,
  customizationRecognitionSchema,
  customizationTaskInputSchema,
  customizationTaskSchema,
  customizationRestoreResultSchema,
  customizationSmokeResultSchema,
  customizationUiCheckInputSchema,
  customizationUiInstallInputSchema,
  customizationUiRestoreInputSchema,
  customizationUiSmokeInputSchema,
  customizationUiUninstallInputSchema,
  customizationUninstallResultSchema,
} from '../../shared/customization'
import type { CustomizationService } from '../customization/customization-service'
import type { StudioProjectService } from '../projects/studio-project-service'
import { createValidatedHandler } from './validated-handler'

const emptyInputSchema = z.object({}).strict()

export function registerCustomizationIpc(options: {
  customization: CustomizationService
  projects: StudioProjectService
}): () => void {
  const currentProjectPath = async (): Promise<string> => {
    const current = await options.projects.current()
    if (!current.projectPath) throw new Error('请先打开 Agent Stack 项目。')
    return current.projectPath
  }
  ipcMain.handle(
    ipcChannels.customizationRecognize,
    createValidatedHandler({
      input: customizationRecognitionInputSchema,
      output: customizationRecognitionSchema,
      handle: (input) => options.customization.recognize(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.customizationTask,
    createValidatedHandler({
      input: customizationTaskInputSchema.omit({ projectPath: true }),
      output: customizationTaskSchema,
      handle: async (input) =>
        options.customization.task({ ...input, projectPath: await currentProjectPath() }),
    }),
  )
  ipcMain.handle(
    ipcChannels.customizationInstall,
    createValidatedHandler({
      input: customizationUiInstallInputSchema,
      output: customizationInstallResultSchema,
      handle: async (input) =>
        options.customization.install({
          ...input,
          operation: 'install',
          projectPath: await currentProjectPath(),
        }),
    }),
  )
  ipcMain.handle(
    ipcChannels.customizationUpdate,
    createValidatedHandler({
      input: customizationUiInstallInputSchema,
      output: customizationInstallResultSchema,
      handle: async (input) =>
        options.customization.install({
          ...input,
          operation: 'update',
          projectPath: await currentProjectPath(),
        }),
    }),
  )
  ipcMain.handle(
    ipcChannels.customizationCheck,
    createValidatedHandler({
      input: customizationUiCheckInputSchema,
      output: customizationRecipeStatusListSchema,
      handle: async (input) =>
        options.customization.check({ ...input, projectPath: await currentProjectPath() }),
    }),
  )
  ipcMain.handle(
    ipcChannels.customizationSmoke,
    createValidatedHandler({
      input: customizationUiSmokeInputSchema,
      output: customizationSmokeResultSchema,
      handle: async (input) =>
        options.customization.smoke({ ...input, projectPath: await currentProjectPath() }),
    }),
  )
  ipcMain.handle(
    ipcChannels.customizationUninstall,
    createValidatedHandler({
      input: customizationUiUninstallInputSchema,
      output: customizationUninstallResultSchema,
      handle: async (input) =>
        options.customization.uninstall({ ...input, projectPath: await currentProjectPath() }),
    }),
  )
  ipcMain.handle(
    ipcChannels.customizationRestore,
    createValidatedHandler({
      input: customizationUiRestoreInputSchema,
      output: customizationRestoreResultSchema,
      handle: async (input) =>
        options.customization.restore({ ...input, projectPath: await currentProjectPath() }),
    }),
  )
  ipcMain.handle(
    ipcChannels.customizationCancel,
    createValidatedHandler({
      input: emptyInputSchema,
      output: customizationCancelResultSchema,
      handle: () => ({ cancelled: options.customization.cancel() }),
    }),
  )
  const channels = [
    ipcChannels.customizationRecognize,
    ipcChannels.customizationTask,
    ipcChannels.customizationInstall,
    ipcChannels.customizationUpdate,
    ipcChannels.customizationCheck,
    ipcChannels.customizationSmoke,
    ipcChannels.customizationUninstall,
    ipcChannels.customizationRestore,
    ipcChannels.customizationCancel,
  ]
  return () => {
    options.customization.cancel()
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
