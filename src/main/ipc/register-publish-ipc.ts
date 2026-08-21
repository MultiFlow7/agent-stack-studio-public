import { ipcMain } from 'electron'
import { z } from 'zod'
import { ipcChannels } from '../../shared/ipc'
import {
  publishExecuteInputSchema,
  publishHistoryInputSchema,
  publishHistorySchema,
  publishPreviewInputSchema,
  publishPreviewSchema,
  publishResultSchema,
  publishTargetsSchema,
} from '../../shared/publish'
import type { PublishService } from '../publishing/publish-service'
import { createValidatedHandler } from './validated-handler'

export function registerPublishIpc(publishing: PublishService): () => void {
  ipcMain.handle(
    ipcChannels.publishTargetsList,
    createValidatedHandler({
      input: z.undefined(),
      output: publishTargetsSchema,
      handle: () => publishing.targets(),
    }),
  )
  ipcMain.handle(
    ipcChannels.publishPreview,
    createValidatedHandler({
      input: publishPreviewInputSchema,
      output: publishPreviewSchema,
      handle: (input) => publishing.preview(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.publishExecute,
    createValidatedHandler({
      input: publishExecuteInputSchema,
      output: publishResultSchema,
      handle: (input) => publishing.publish(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.publishHistory,
    createValidatedHandler({
      input: publishHistoryInputSchema,
      output: publishHistorySchema,
      handle: ({ targetId, agentId }) => publishing.history(targetId, agentId),
    }),
  )

  return () => {
    for (const channel of [
      ipcChannels.publishTargetsList,
      ipcChannels.publishPreview,
      ipcChannels.publishExecute,
      ipcChannels.publishHistory,
    ])
      ipcMain.removeHandler(channel)
  }
}
