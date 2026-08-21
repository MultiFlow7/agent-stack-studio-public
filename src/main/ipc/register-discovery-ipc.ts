import { clipboard, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { ipcChannels } from '../../shared/ipc'
import {
  discoveredRepositorySchema,
  sourceActionResultSchema,
  sourceCancelResultSchema,
  sourceClipboardInputSchema,
  sourceHandoffInputSchema,
  sourceHandoffSchema,
  sourceLocatorInputSchema,
  sourceOpenUrlInputSchema,
  sourceSearchInputSchema,
  sourceSearchResultSchema,
} from '../../shared/source-discovery'
import type { DiscoveryService } from '../discovery/discovery-service'
import { createValidatedHandler } from './validated-handler'

const emptyInputSchema = z.object({}).strict()

export function registerDiscoveryIpc(discovery: DiscoveryService): () => void {
  ipcMain.handle(
    ipcChannels.sourceSearch,
    createValidatedHandler({
      input: sourceSearchInputSchema,
      output: sourceSearchResultSchema,
      handle: (input) => discovery.search(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.sourceInspect,
    createValidatedHandler({
      input: sourceLocatorInputSchema,
      output: discoveredRepositorySchema,
      handle: (input) => discovery.inspect(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.sourceHandoff,
    createValidatedHandler({
      input: sourceHandoffInputSchema,
      output: sourceHandoffSchema,
      handle: (input) => discovery.handoff(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.sourceCancel,
    createValidatedHandler({
      input: emptyInputSchema,
      output: sourceCancelResultSchema,
      handle: () => ({ cancelled: discovery.cancel() }),
    }),
  )
  ipcMain.handle(
    ipcChannels.sourceClipboardWrite,
    createValidatedHandler({
      input: sourceClipboardInputSchema,
      output: sourceActionResultSchema,
      handle: ({ text }) => {
        clipboard.writeText(text)
        return { ok: true as const }
      },
    }),
  )
  ipcMain.handle(
    ipcChannels.sourceOpenUrl,
    createValidatedHandler({
      input: sourceOpenUrlInputSchema,
      output: sourceActionResultSchema,
      handle: async ({ url }) => {
        await shell.openExternal(url)
        return { ok: true as const }
      },
    }),
  )

  const channels = [
    ipcChannels.sourceSearch,
    ipcChannels.sourceInspect,
    ipcChannels.sourceHandoff,
    ipcChannels.sourceCancel,
    ipcChannels.sourceClipboardWrite,
    ipcChannels.sourceOpenUrl,
  ]
  return () => {
    discovery.close()
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
