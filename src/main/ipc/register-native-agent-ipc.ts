import { ipcMain } from 'electron'
import { ipcChannels } from '../../shared/ipc'
import {
  harnessProbeListSchema,
  nativeAgentCancelInputSchema,
  nativeAgentCancelResultSchema,
  nativeAgentResultListSchema,
  nativeAgentResultSchema,
  nativeAgentUiExecuteInputSchema,
  nativeAgentUiListInputSchema,
} from '../../shared/native-agent'
import { emptyProjectInputSchema } from '../../shared/studio-project'
import type { NativeAgentService } from '../native/native-agent-service'
import { createValidatedHandler } from './validated-handler'

export function registerNativeAgentIpc(service: NativeAgentService): () => void {
  ipcMain.handle(
    ipcChannels.nativeAgentProbes,
    createValidatedHandler({
      input: emptyProjectInputSchema,
      output: harnessProbeListSchema,
      handle: () => service.probes(),
    }),
  )
  ipcMain.handle(
    ipcChannels.nativeAgentExecute,
    createValidatedHandler({
      input: nativeAgentUiExecuteInputSchema,
      output: nativeAgentResultSchema,
      handle: (input) => service.execute(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.nativeAgentList,
    createValidatedHandler({
      input: nativeAgentUiListInputSchema,
      output: nativeAgentResultListSchema,
      handle: (input) => service.list(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.nativeAgentCancel,
    createValidatedHandler({
      input: nativeAgentCancelInputSchema,
      output: nativeAgentCancelResultSchema,
      handle: ({ requestId }) => ({ cancelled: service.cancel(requestId) }),
    }),
  )
  const channels = [
    ipcChannels.nativeAgentProbes,
    ipcChannels.nativeAgentExecute,
    ipcChannels.nativeAgentList,
    ipcChannels.nativeAgentCancel,
  ]
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
