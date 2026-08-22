import { contextBridge, ipcRenderer } from 'electron'
import {
  agentListSchema,
  agentListInputSchema,
  agentLifecycleResultSchema,
  agentSchema,
  createAgentInputSchema,
  deleteAgentResultSchema,
  duplicateAgentInputSchema,
  updateAgentInputSchema,
} from '../shared/agent'
import { agentDetailSchema, agentVersionSchema } from '../shared/agent-detail'
import { agentStatusListSchema, agentStatusProjectionSchema } from '../shared/agent-status'
import { importScanResultSchema } from '../shared/import'
import {
  createExperimentInputSchema,
  experimentDetailSchema,
  experimentListSchema,
  exportExperimentResultSchema,
} from '../shared/experiment'
import { ipcChannels, type StudioApi } from '../shared/ipc'
import {
  addStackComponentInputSchema,
  componentListSchema,
  removeStackComponentInputSchema,
  selectCapabilityOwnerInputSchema,
} from '../shared/component'
import { componentCatalogItemSchema, componentCatalogSchema } from '../shared/component-catalog'
import { stackStateSchema } from '../shared/runtime-plan'
import {
  runHistoryDetailSchema,
  runListSchema,
  runRecordSchema,
  startRunInputSchema,
} from '../shared/run'
import {
  publishExecuteInputSchema,
  publishHistorySchema,
  publishPreviewInputSchema,
  publishPreviewSchema,
  publishResultSchema,
  publishTargetsSchema,
} from '../shared/publish'
import {
  applyRestoreInputSchema,
  applyRestoreResultSchema,
  createBackupResultSchema,
  maintenanceStatusSchema,
  revealDataLocationInputSchema,
  revealDataLocationResultSchema,
  selectRestoreResultSchema,
} from '../shared/maintenance'
import {
  projectComponentInputSchema,
  projectComponentValidationInputSchema,
  projectComponentCancelInputSchema,
  projectComponentCancelResultSchema,
  projectDescriptorInputSchema,
  projectMutationInputSchema,
  projectOwnerInputSchema,
  projectWorkflowCreateInputSchema,
  projectWorkflowEdgeAddInputSchema,
  projectWorkflowEdgeRemoveInputSchema,
  projectWorkflowFreezeInputSchema,
  projectWorkflowNodeAddInputSchema,
  projectWorkflowNodeRemoveInputSchema,
  studioProjectStateSchema,
} from '../shared/studio-project'
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
} from '../shared/source-discovery'
import {
  configureAgentSecretInputSchema,
  configureAgentSecretResultSchema,
  deleteAgentSecretInputSchema,
  deleteAgentSecretResultSchema,
  secretReferenceStatusListSchema,
} from '../shared/secret-reference'
import {
  rendererPreferencesSchema,
  updateRendererPreferencesInputSchema,
} from '../shared/preferences'
import { projectExportResultSchema } from '../shared/agent-stack-package'
import {
  commandCenterSearchInputSchema,
  commandCenterSearchResultSchema,
  commandCenterSnapshotSchema,
} from '../shared/command-center'

const readRequests = new Map<string, Promise<unknown>>()

function invokeCoalesced(channel: string, input: unknown): Promise<unknown> {
  const key = `${channel}\0${JSON.stringify(input)}`
  const existing = readRequests.get(key)
  if (existing) return existing
  const request = ipcRenderer.invoke(channel, input).finally(() => {
    if (readRequests.get(key) === request) readRequests.delete(key)
  })
  readRequests.set(key, request)
  return request
}

async function invokeMutation(channel: string, input?: unknown): Promise<unknown> {
  readRequests.clear()
  try {
    return await ipcRenderer.invoke(channel, input)
  } finally {
    readRequests.clear()
  }
}

async function invokeWithSanitizedError(
  channel: string,
  input: unknown,
  fallback: string,
  coalesce = false,
  invalidateReads = false,
): Promise<unknown> {
  if (invalidateReads) readRequests.clear()
  try {
    return await (coalesce ? invokeCoalesced(channel, input) : ipcRenderer.invoke(channel, input))
  } catch (error) {
    const message = error instanceof Error ? error.message : fallback
    throw new Error(message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
  } finally {
    if (invalidateReads) readRequests.clear()
  }
}

function invokeLifecycle(channel: string, input: unknown): Promise<unknown> {
  return invokeWithSanitizedError(channel, input, 'Agent 生命周期操作失败。', false, true)
}

const api: StudioApi = {
  agents: {
    async create(input) {
      const parsedInput = createAgentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.agentsCreate, parsedInput)
      return agentSchema.parse(response)
    },
    async list(input) {
      const parsedInput = agentListInputSchema.parse(input)
      const response = await invokeCoalesced(ipcChannels.agentsList, parsedInput)
      return agentListSchema.parse(response)
    },
    async get(id) {
      const response = await invokeCoalesced(ipcChannels.agentsGet, { id })
      return agentDetailSchema.parse(response)
    },
    async statusList(input) {
      const parsedInput = agentListInputSchema.parse(input)
      const response = await invokeCoalesced(ipcChannels.agentStatusList, parsedInput)
      return agentStatusListSchema.parse(response)
    },
    async status(agentId) {
      const response = await invokeCoalesced(ipcChannels.agentStatusGet, {
        id: agentId,
      })
      return agentStatusProjectionSchema.parse(response)
    },
    async update(input) {
      const parsedInput = updateAgentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.agentsUpdate, parsedInput)
      return agentDetailSchema.parse(response)
    },
    async duplicate(input) {
      const parsedInput = duplicateAgentInputSchema.parse(input)
      const response: unknown = await invokeLifecycle(ipcChannels.agentsDuplicate, parsedInput)
      return agentDetailSchema.parse(response)
    },
    async archive(agentId) {
      const response: unknown = await invokeLifecycle(ipcChannels.agentsArchive, {
        id: agentId,
      })
      return agentLifecycleResultSchema.parse(response)
    },
    async restore(agentId) {
      const response: unknown = await invokeLifecycle(ipcChannels.agentsRestore, {
        id: agentId,
      })
      return agentLifecycleResultSchema.parse(response)
    },
    async delete(agentId) {
      const response: unknown = await invokeLifecycle(ipcChannels.agentsDelete, { id: agentId })
      return deleteAgentResultSchema.parse(response)
    },
    async createVersion(agentId) {
      const response = await invokeMutation(ipcChannels.agentVersionsCreate, {
        id: agentId,
      })
      return agentVersionSchema.parse(response)
    },
  },
  secrets: {
    async list(agentId) {
      const response = await invokeCoalesced(ipcChannels.secretsList, { agentId })
      return secretReferenceStatusListSchema.parse(response)
    },
    async configure(input) {
      const parsedInput = configureAgentSecretInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.secretsConfigure, parsedInput)
      return configureAgentSecretResultSchema.parse(response)
    },
    async delete(input) {
      const parsedInput = deleteAgentSecretInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.secretsDelete, parsedInput)
      return deleteAgentSecretResultSchema.parse(response)
    },
  },
  imports: {
    async selectAndScan() {
      const response = await invokeMutation(ipcChannels.importsSelectAndScan)
      return importScanResultSchema.parse(response)
    },
    async confirm(scanId) {
      const response = await invokeMutation(ipcChannels.importsConfirm, { scanId })
      return agentDetailSchema.parse(response)
    },
  },
  components: {
    async list() {
      const response = await invokeCoalesced(ipcChannels.componentsList, undefined)
      return componentListSchema.parse(response)
    },
    async catalog() {
      const response = await invokeCoalesced(ipcChannels.componentsCatalog, undefined)
      return componentCatalogSchema.parse(response)
    },
    async get(componentId) {
      const response = await invokeCoalesced(ipcChannels.componentsGet, {
        id: componentId,
      })
      return componentCatalogItemSchema.parse(response)
    },
    async getStack(agentId) {
      const response = await invokeCoalesced(ipcChannels.stackComponentsGet, {
        id: agentId,
      })
      return stackStateSchema.parse(response)
    },
    async addToStack(input) {
      const parsedInput = addStackComponentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.stackComponentsAdd, parsedInput)
      return stackStateSchema.parse(response)
    },
    async removeFromStack(input) {
      const parsedInput = removeStackComponentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.stackComponentsRemove, parsedInput)
      return stackStateSchema.parse(response)
    },
    async selectOwner(input) {
      const parsedInput = selectCapabilityOwnerInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.stackOwnersSelect, parsedInput)
      return stackStateSchema.parse(response)
    },
  },
  runs: {
    async start(input) {
      const parsedInput = startRunInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.runsStart, parsedInput)
      return runRecordSchema.parse(response)
    },
    async list(agentId) {
      const response = await invokeCoalesced(ipcChannels.runsList, { agentId })
      return runListSchema.parse(response)
    },
    async get(runId) {
      const response = await invokeCoalesced(ipcChannels.runsGet, { id: runId })
      return runHistoryDetailSchema.parse(response)
    },
    async cancel(runId) {
      const response = await invokeMutation(ipcChannels.runsCancel, { id: runId })
      return runHistoryDetailSchema.parse(response)
    },
  },
  experiments: {
    async create(input) {
      const parsedInput = createExperimentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.experimentsCreate, parsedInput)
      return experimentDetailSchema.parse(response)
    },
    async list(agentId) {
      const response = await invokeCoalesced(ipcChannels.experimentsList, { agentId })
      return experimentListSchema.parse(response)
    },
    async get(experimentId) {
      const response = await invokeCoalesced(ipcChannels.experimentsGet, {
        id: experimentId,
      })
      return experimentDetailSchema.parse(response)
    },
    async refreshDrift(experimentId) {
      const response = await invokeMutation(ipcChannels.experimentsDrift, {
        id: experimentId,
      })
      return experimentDetailSchema.parse(response)
    },
    async start(experimentId) {
      const response = await invokeMutation(ipcChannels.experimentsStart, {
        id: experimentId,
      })
      return experimentDetailSchema.parse(response)
    },
    async cancel(experimentId) {
      const response = await invokeMutation(ipcChannels.experimentsCancel, {
        id: experimentId,
      })
      return experimentDetailSchema.parse(response)
    },
    async export(experimentId, format) {
      const response = await invokeMutation(ipcChannels.experimentsExport, {
        id: experimentId,
        format,
      })
      return exportExperimentResultSchema.parse(response)
    },
  },
  publishing: {
    async targets() {
      const response = await invokeCoalesced(ipcChannels.publishTargetsList, undefined)
      return publishTargetsSchema.parse(response)
    },
    async preview(input) {
      const parsedInput = publishPreviewInputSchema.parse(input)
      const response = await invokeCoalesced(ipcChannels.publishPreview, parsedInput)
      return publishPreviewSchema.parse(response)
    },
    async publish(input) {
      const parsedInput = publishExecuteInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.publishExecute, parsedInput)
      return publishResultSchema.parse(response)
    },
    async history(targetId, agentId) {
      const response = await invokeCoalesced(ipcChannels.publishHistory, {
        targetId,
        agentId,
      })
      return publishHistorySchema.parse(response)
    },
  },
  maintenance: {
    async status() {
      const response = await invokeCoalesced(ipcChannels.maintenanceStatus, {})
      return maintenanceStatusSchema.parse(response)
    },
    async createBackup() {
      const response = await invokeMutation(ipcChannels.maintenanceCreateBackup, {})
      return createBackupResultSchema.parse(response)
    },
    async selectRestore() {
      const response = await invokeMutation(ipcChannels.maintenanceSelectRestore, {})
      return selectRestoreResultSchema.parse(response)
    },
    async applyRestore(input) {
      const parsedInput = applyRestoreInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.maintenanceApplyRestore, parsedInput)
      return applyRestoreResultSchema.parse(response)
    },
    async revealDataLocation(input) {
      const parsedInput = revealDataLocationInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.maintenanceRevealDataLocation, parsedInput)
      return revealDataLocationResultSchema.parse(response)
    },
  },
  preferences: {
    async get() {
      const response = await invokeCoalesced(ipcChannels.preferencesGet, {})
      return rendererPreferencesSchema.parse(response)
    },
    async update(input) {
      const parsedInput = updateRendererPreferencesInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.preferencesUpdate, parsedInput)
      return rendererPreferencesSchema.parse(response)
    },
  },
  commandCenter: {
    async snapshot() {
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.commandCenterSnapshot,
        {},
        '无法读取工作空间状态。',
        true,
      )
      return commandCenterSnapshotSchema.parse(response)
    },
    async search(input) {
      const parsed = commandCenterSearchInputSchema.parse(input)
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.commandCenterSearch,
        parsed,
        '无法搜索本地工作空间。',
        true,
      )
      return commandCenterSearchResultSchema.parse(response)
    },
  },
  studioProject: {
    async current() {
      const response = await invokeCoalesced(ipcChannels.studioProjectCurrent, {})
      return studioProjectStateSchema.parse(response)
    },
    async open() {
      const response = await invokeMutation(ipcChannels.studioProjectOpen, {})
      return studioProjectStateSchema.parse(response)
    },
    async init() {
      const response = await invokeMutation(ipcChannels.studioProjectInit, {})
      return studioProjectStateSchema.parse(response)
    },
    async importComponent(expectedRevision) {
      const input = projectMutationInputSchema.parse({ expectedRevision })
      const response = await invokeMutation(ipcChannels.studioProjectImport, input)
      return studioProjectStateSchema.parse(response)
    },
    async updateDescriptor(input) {
      const parsed = projectDescriptorInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.studioProjectDescriptorUpdate, parsed)
      return studioProjectStateSchema.parse(response)
    },
    async archiveComponent(input) {
      const parsed = projectComponentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.studioProjectComponentArchive, parsed)
      return studioProjectStateSchema.parse(response)
    },
    async restoreComponent(input) {
      const parsed = projectComponentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.studioProjectComponentRestore, parsed)
      return studioProjectStateSchema.parse(response)
    },
    async recheckComponent(input) {
      const parsed = projectComponentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.studioProjectComponentRecheck, parsed)
      return studioProjectStateSchema.parse(response)
    },
    async runComponentContractTest(input) {
      const parsed = projectComponentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.studioProjectComponentContractTest, parsed)
      return studioProjectStateSchema.parse(response)
    },
    async runComponentRuntimeValidation(input) {
      const parsed = projectComponentValidationInputSchema.parse(input)
      const response = await invokeMutation(
        ipcChannels.studioProjectComponentRuntimeValidate,
        parsed,
      )
      return studioProjectStateSchema.parse(response)
    },
    async cancelComponentRuntimeValidation(input) {
      const parsed = projectComponentCancelInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.studioProjectComponentRuntimeCancel, parsed)
      return projectComponentCancelResultSchema.parse(response)
    },
    async deleteComponent(input) {
      const parsed = projectComponentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.studioProjectComponentDelete, parsed)
      return studioProjectStateSchema.parse(response)
    },
    async addToStack(input) {
      const parsed = projectComponentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.studioProjectStackAdd, parsed)
      return studioProjectStateSchema.parse(response)
    },
    async removeFromStack(input) {
      const parsed = projectComponentInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.studioProjectStackRemove, parsed)
      return studioProjectStateSchema.parse(response)
    },
    async setOwner(input) {
      const parsed = projectOwnerInputSchema.parse(input)
      const response = await invokeMutation(ipcChannels.studioProjectOwnerSet, parsed)
      return studioProjectStateSchema.parse(response)
    },
    async createWorkflow(input) {
      const parsed = projectWorkflowCreateInputSchema.parse(input)
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.studioProjectWorkflowCreate,
        parsed,
        '无法创建 Workflow。',
        false,
        true,
      )
      return studioProjectStateSchema.parse(response)
    },
    async addWorkflowNode(input) {
      const parsed = projectWorkflowNodeAddInputSchema.parse(input)
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.studioProjectWorkflowNodeAdd,
        parsed,
        '无法保存 Workflow 节点。',
        false,
        true,
      )
      return studioProjectStateSchema.parse(response)
    },
    async removeWorkflowNode(input) {
      const parsed = projectWorkflowNodeRemoveInputSchema.parse(input)
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.studioProjectWorkflowNodeRemove,
        parsed,
        '无法删除 Workflow 节点。',
        false,
        true,
      )
      return studioProjectStateSchema.parse(response)
    },
    async addWorkflowEdge(input) {
      const parsed = projectWorkflowEdgeAddInputSchema.parse(input)
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.studioProjectWorkflowEdgeAdd,
        parsed,
        '无法保存 Workflow 连线。',
        false,
        true,
      )
      return studioProjectStateSchema.parse(response)
    },
    async removeWorkflowEdge(input) {
      const parsed = projectWorkflowEdgeRemoveInputSchema.parse(input)
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.studioProjectWorkflowEdgeRemove,
        parsed,
        '无法删除 Workflow 连线。',
        false,
        true,
      )
      return studioProjectStateSchema.parse(response)
    },
    async freezeWorkflow(input) {
      const parsed = projectWorkflowFreezeInputSchema.parse(input)
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.studioProjectWorkflowFreeze,
        parsed,
        '无法冻结 Workflow Version。',
        false,
        true,
      )
      return studioProjectStateSchema.parse(response)
    },
    async freeze(expectedRevision) {
      const input = projectMutationInputSchema.parse({ expectedRevision })
      const response = await invokeMutation(ipcChannels.studioProjectFreeze, input)
      return studioProjectStateSchema.parse(response)
    },
    async export() {
      const response = await invokeMutation(ipcChannels.studioProjectExport, {})
      return projectExportResultSchema.parse(response)
    },
    async loadDemoData() {
      const response = await invokeMutation(ipcChannels.demoDataLoad, {})
      return componentListSchema.parse(response)
    },
    onExternalChanged(callback) {
      const listener = () => callback()
      ipcRenderer.on(ipcChannels.studioProjectExternalChanged, listener)
      return () => ipcRenderer.removeListener(ipcChannels.studioProjectExternalChanged, listener)
    },
  },
  discovery: {
    async search(input) {
      const parsed = sourceSearchInputSchema.parse(input)
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.sourceSearch,
        parsed,
        '无法搜索 GitHub。',
      )
      return sourceSearchResultSchema.parse(response)
    },
    async inspect(input) {
      const parsed = sourceLocatorInputSchema.parse(input)
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.sourceInspect,
        parsed,
        '无法检查 GitHub 仓库。',
      )
      return discoveredRepositorySchema.parse(response)
    },
    async handoff(input) {
      const parsed = sourceHandoffInputSchema.parse(input)
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.sourceHandoff,
        parsed,
        '无法生成下载交接计划。',
      )
      return sourceHandoffSchema.parse(response)
    },
    async cancel() {
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.sourceCancel,
        {},
        '无法取消来源发现。',
      )
      return sourceCancelResultSchema.parse(response)
    },
    async copy(text) {
      const input = sourceClipboardInputSchema.parse({ text })
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.sourceClipboardWrite,
        input,
        '无法复制交接内容。',
      )
      sourceActionResultSchema.parse(response)
    },
    async open(url) {
      const input = sourceOpenUrlInputSchema.parse({ url })
      const response: unknown = await invokeWithSanitizedError(
        ipcChannels.sourceOpenUrl,
        input,
        '无法打开 GitHub 仓库。',
      )
      sourceActionResultSchema.parse(response)
    },
  },
  menu: {
    onCreateAgent(callback) {
      const listener = () => callback()
      ipcRenderer.on(ipcChannels.menuCreateAgent, listener)
      return () => ipcRenderer.removeListener(ipcChannels.menuCreateAgent, listener)
    },
    onOpenSettings(callback) {
      const listener = () => callback()
      ipcRenderer.on(ipcChannels.menuOpenSettings, listener)
      return () => ipcRenderer.removeListener(ipcChannels.menuOpenSettings, listener)
    },
  },
}

contextBridge.exposeInMainWorld('studio', api)
