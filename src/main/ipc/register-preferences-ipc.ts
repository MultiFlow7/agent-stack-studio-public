import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  rendererPreferencesSchema,
  updateRendererPreferencesInputSchema,
} from '../../shared/preferences'
import { ipcChannels } from '../../shared/ipc'
import type { ApplicationPreferencesService } from '../preferences/application-preferences-service'
import { createValidatedHandler } from './validated-handler'

export function registerPreferencesIpc(preferences: ApplicationPreferencesService): () => void {
  ipcMain.handle(
    ipcChannels.preferencesGet,
    createValidatedHandler({
      input: z.object({}).strict(),
      output: rendererPreferencesSchema,
      handle: () => preferences.renderer(),
    }),
  )
  ipcMain.handle(
    ipcChannels.preferencesUpdate,
    createValidatedHandler({
      input: updateRendererPreferencesInputSchema,
      output: rendererPreferencesSchema,
      handle: (input) => preferences.updateRenderer(input),
    }),
  )

  return () => {
    ipcMain.removeHandler(ipcChannels.preferencesGet)
    ipcMain.removeHandler(ipcChannels.preferencesUpdate)
  }
}
