import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  commandCenterSearchInputSchema,
  commandCenterSearchResultSchema,
  commandCenterSnapshotSchema,
} from '../../shared/command-center'
import { ipcChannels } from '../../shared/ipc'
import type { CommandCenterService } from '../command-center/command-center-service'
import { createValidatedHandler } from './validated-handler'

export function registerCommandCenterIpc(commandCenter: CommandCenterService): () => void {
  ipcMain.handle(
    ipcChannels.commandCenterSnapshot,
    createValidatedHandler({
      input: z.object({}).strict(),
      output: commandCenterSnapshotSchema,
      handle: () => commandCenter.snapshot(),
    }),
  )
  ipcMain.handle(
    ipcChannels.commandCenterSearch,
    createValidatedHandler({
      input: commandCenterSearchInputSchema,
      output: commandCenterSearchResultSchema,
      handle: ({ query }) => commandCenter.search(query),
    }),
  )

  return () => {
    ipcMain.removeHandler(ipcChannels.commandCenterSnapshot)
    ipcMain.removeHandler(ipcChannels.commandCenterSearch)
  }
}
