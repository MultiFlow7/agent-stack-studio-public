import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import {
  agentListSchema,
  agentListInputSchema,
  agentLifecycleResultSchema,
  agentSchema,
  createAgentInputSchema,
  deleteAgentResultSchema,
  duplicateAgentInputSchema,
  updateAgentInputSchema,
} from '../../shared/agent'
import { agentDetailSchema, agentVersionSchema } from '../../shared/agent-detail'
import { agentStatusListSchema, agentStatusProjectionSchema } from '../../shared/agent-status'
import { confirmImportInputSchema, importScanResultSchema } from '../../shared/import'
import { ipcChannels } from '../../shared/ipc'
import type { AgentService } from '../agents/agent-service'
import type { AgentStatusService } from '../agents/agent-status-service'
import type { ImportService } from '../import/import-service'
import { createValidatedHandler } from './validated-handler'

const agentIdInputSchema = z.object({ id: z.uuid() }).strict()

export function registerAgentIpc(options: {
  agents: AgentService
  agentStatus: AgentStatusService
  imports: ImportService
  getWindow: () => BrowserWindow | undefined
}): () => void {
  const { agents, agentStatus, imports, getWindow } = options

  ipcMain.handle(
    ipcChannels.agentsList,
    createValidatedHandler({
      input: agentListInputSchema,
      output: agentListSchema,
      handle: (input) => agents.list(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentsCreate,
    createValidatedHandler({
      input: createAgentInputSchema,
      output: agentSchema,
      handle: (input) => agents.create(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentStatusList,
    createValidatedHandler({
      input: agentListInputSchema,
      output: agentStatusListSchema,
      handle: (input) => agentStatus.list(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentStatusGet,
    createValidatedHandler({
      input: agentIdInputSchema,
      output: agentStatusProjectionSchema,
      handle: ({ id }) => agentStatus.get(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentsGet,
    createValidatedHandler({
      input: agentIdInputSchema,
      output: agentDetailSchema,
      handle: ({ id }) => agents.get(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentsUpdate,
    createValidatedHandler({
      input: updateAgentInputSchema,
      output: agentDetailSchema,
      handle: (input) => agents.update(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentsDuplicate,
    createValidatedHandler({
      input: duplicateAgentInputSchema,
      output: agentDetailSchema,
      handle: (input) => agents.duplicate(input),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentsArchive,
    createValidatedHandler({
      input: agentIdInputSchema,
      output: agentLifecycleResultSchema,
      handle: ({ id }) => agents.archive(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentsRestore,
    createValidatedHandler({
      input: agentIdInputSchema,
      output: agentLifecycleResultSchema,
      handle: ({ id }) => agents.restore(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentsDelete,
    createValidatedHandler({
      input: agentIdInputSchema,
      output: deleteAgentResultSchema,
      handle: ({ id }) => agents.delete(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.agentVersionsCreate,
    createValidatedHandler({
      input: agentIdInputSchema,
      output: agentVersionSchema,
      handle: ({ id }) => agents.createVersion(id),
    }),
  )
  ipcMain.handle(
    ipcChannels.importsSelectAndScan,
    createValidatedHandler({
      input: z.undefined(),
      output: importScanResultSchema,
      handle: async () => {
        const window = getWindow()
        const selection = window
          ? await dialog.showOpenDialog(window, {
              title: '导入本地 Agent 项目',
              buttonLabel: '检查文件夹',
              properties: ['openDirectory'],
            })
          : await dialog.showOpenDialog({
              title: '导入本地 Agent 项目',
              buttonLabel: '检查文件夹',
              properties: ['openDirectory'],
            })
        if (selection.canceled || !selection.filePaths[0]) return { status: 'cancelled' as const }
        return { status: 'scanned' as const, scan: await imports.scan(selection.filePaths[0]) }
      },
    }),
  )
  ipcMain.handle(
    ipcChannels.importsConfirm,
    createValidatedHandler({
      input: confirmImportInputSchema,
      output: agentDetailSchema,
      handle: ({ scanId }) => agents.import(imports.consume(scanId)),
    }),
  )

  return () => {
    for (const channel of [
      ipcChannels.agentsList,
      ipcChannels.agentStatusList,
      ipcChannels.agentStatusGet,
      ipcChannels.agentsCreate,
      ipcChannels.agentsGet,
      ipcChannels.agentsUpdate,
      ipcChannels.agentsDuplicate,
      ipcChannels.agentsArchive,
      ipcChannels.agentsRestore,
      ipcChannels.agentsDelete,
      ipcChannels.agentVersionsCreate,
      ipcChannels.importsSelectAndScan,
      ipcChannels.importsConfirm,
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}
