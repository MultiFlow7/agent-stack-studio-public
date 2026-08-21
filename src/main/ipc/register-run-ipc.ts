import { ipcMain } from 'electron'
import { ipcChannels } from '../../shared/ipc'
import {
  runHistoryDetailSchema,
  runIdInputSchema,
  runListInputSchema,
  runListSchema,
  runRecordSchema,
  startRunInputSchema,
} from '../../shared/run'
import type { RunService } from '../runs/run-service'
import type { RunHistoryService } from '../runs/run-history-service'
import { createValidatedHandler } from './validated-handler'

export function registerRunIpc(options: {
  runs: RunService
  history: RunHistoryService
}): () => void {
  const { runs, history } = options
  ipcMain.handle(
    ipcChannels.runsStart,
    createValidatedHandler({
      input: startRunInputSchema,
      output: runRecordSchema,
      handle: (input) => runs.start(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.runsList,
    createValidatedHandler({
      input: runListInputSchema,
      output: runListSchema,
      handle: ({ agentId }) => runs.list(agentId),
    }),
  )
  ipcMain.handle(
    ipcChannels.runsGet,
    createValidatedHandler({
      input: runIdInputSchema,
      output: runHistoryDetailSchema,
      handle: ({ id }) => history.get(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.runsCancel,
    createValidatedHandler({
      input: runIdInputSchema,
      output: runHistoryDetailSchema,
      handle: ({ id }) => history.cancel(id),
    }),
  )

  return () => {
    for (const channel of [
      ipcChannels.runsStart,
      ipcChannels.runsList,
      ipcChannels.runsGet,
      ipcChannels.runsCancel,
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}
