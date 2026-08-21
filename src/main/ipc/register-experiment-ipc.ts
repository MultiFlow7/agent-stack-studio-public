import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { chmod, writeFile } from 'node:fs/promises'
import {
  createExperimentInputSchema,
  experimentDetailSchema,
  experimentIdInputSchema,
  experimentListInputSchema,
  experimentListSchema,
  exportExperimentInputSchema,
  exportExperimentResultSchema,
} from '../../shared/experiment'
import { ipcChannels } from '../../shared/ipc'
import type { ExperimentService } from '../experiments/experiment-service'
import { createValidatedHandler } from './validated-handler'

export function registerExperimentIpc(options: {
  experiments: ExperimentService
  getWindow: () => BrowserWindow | undefined
}): () => void {
  const { experiments } = options
  ipcMain.handle(
    ipcChannels.experimentsCreate,
    createValidatedHandler({
      input: createExperimentInputSchema,
      output: experimentDetailSchema,
      handle: (input) => experiments.create(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.experimentsList,
    createValidatedHandler({
      input: experimentListInputSchema,
      output: experimentListSchema,
      handle: ({ agentId }) => experiments.list(agentId),
    }),
  )
  for (const [channel, handle] of [
    [ipcChannels.experimentsGet, (id: string) => experiments.get(id)],
    [ipcChannels.experimentsDrift, (id: string) => experiments.refreshDrift(id)],
    [ipcChannels.experimentsStart, (id: string) => experiments.start(id)],
    [ipcChannels.experimentsCancel, (id: string) => experiments.cancel(id)],
  ] as const) {
    ipcMain.handle(
      channel,
      createValidatedHandler({
        input: experimentIdInputSchema,
        output: experimentDetailSchema,
        handle: ({ id }) => handle(id),
      }),
    )
  }
  ipcMain.handle(
    ipcChannels.experimentsExport,
    createValidatedHandler({
      input: exportExperimentInputSchema,
      output: exportExperimentResultSchema,
      handle: async ({ id, format }) => {
        const exported = experiments.serialize(id, format)
        const window = options.getWindow()
        const result = window
          ? await dialog.showSaveDialog(window, {
              defaultPath: exported.fileName,
              filters: [{ name: format.toUpperCase(), extensions: [format] }],
            })
          : await dialog.showSaveDialog({
              defaultPath: exported.fileName,
              filters: [{ name: format.toUpperCase(), extensions: [format] }],
            })
        if (result.canceled || !result.filePath) return { status: 'cancelled' as const }
        await writeFile(result.filePath, exported.contents, { encoding: 'utf8', mode: 0o600 })
        await chmod(result.filePath, 0o600)
        return { status: 'saved' as const, fileName: exported.fileName }
      },
    }),
  )

  return () => {
    for (const channel of [
      ipcChannels.experimentsCreate,
      ipcChannels.experimentsList,
      ipcChannels.experimentsGet,
      ipcChannels.experimentsDrift,
      ipcChannels.experimentsStart,
      ipcChannels.experimentsCancel,
      ipcChannels.experimentsExport,
    ])
      ipcMain.removeHandler(channel)
  }
}
