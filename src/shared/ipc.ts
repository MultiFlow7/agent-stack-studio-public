import type {
  Agent,
  AgentLifecycleResult,
  AgentListInput,
  CreateAgentInput,
  DeleteAgentResult,
  DuplicateAgentInput,
  UpdateAgentInput,
} from './agent'
import type { AgentDetail, AgentVersion } from './agent-detail'
import type { AgentStatusProjection } from './agent-status'
import type {
  AddStackComponentInput,
  ComponentRecord,
  RemoveStackComponentInput,
  SelectCapabilityOwnerInput,
} from './component'
import type { ComponentCatalogItem } from './component-catalog'
import type { ImportScanResult } from './import'
import type {
  CreateExperimentInput,
  ExperimentDetail,
  ExperimentRecord,
  ExportExperimentResult,
} from './experiment'
import type { RunHistoryDetail, RunRecord, StartRunInput } from './run'
import type { StackState } from './runtime-plan'
import type {
  PublishExecuteInput,
  PublishHistory,
  PublishPreview,
  PublishPreviewInput,
  PublishResult,
  PublishTarget,
} from './publish'
import type {
  ApplyRestoreInput,
  ApplyRestoreResult,
  CreateBackupResult,
  MaintenanceStatus,
  RevealDataLocationInput,
  RevealDataLocationResult,
  SelectRestoreResult,
} from './maintenance'
import type {
  ProjectComponentInput,
  ProjectDescriptorInput,
  ProjectOwnerInput,
  ProjectWorkflowCreateInput,
  ProjectWorkflowEdgeAddInput,
  ProjectWorkflowEdgeRemoveInput,
  ProjectWorkflowFreezeInput,
  ProjectWorkflowNodeAddInput,
  ProjectWorkflowNodeRemoveInput,
  StudioProjectState,
} from './studio-project'
import type {
  DiscoveredRepository,
  SourceHandoff,
  SourceHandoffInput,
  SourceLocatorInput,
  SourceSearchInput,
  SourceSearchResult,
} from './source-discovery'
import type {
  ConfigureAgentSecretInput,
  ConfigureAgentSecretResult,
  DeleteAgentSecretInput,
  DeleteAgentSecretResult,
  SecretReferenceStatus,
} from './secret-reference'
import type { RendererPreferences } from './preferences'
import type { ProjectExportResult } from './agent-stack-package'

export const ipcChannels = {
  agentsCreate: 'agents:create',
  agentsGet: 'agents:get',
  agentsList: 'agents:list',
  agentStatusList: 'agent-status:list',
  agentStatusGet: 'agent-status:get',
  agentsUpdate: 'agents:update',
  agentsDuplicate: 'agents:duplicate',
  agentsArchive: 'agents:archive',
  agentsRestore: 'agents:restore',
  agentsDelete: 'agents:delete',
  agentVersionsCreate: 'agent-versions:create',
  secretsList: 'secrets:list',
  secretsConfigure: 'secrets:configure',
  secretsDelete: 'secrets:delete',
  importsConfirm: 'imports:confirm',
  importsSelectAndScan: 'imports:select-and-scan',
  componentsList: 'components:list',
  componentsCatalog: 'components:catalog',
  componentsGet: 'components:get',
  stackComponentsGet: 'stack-components:get',
  stackComponentsAdd: 'stack-components:add',
  stackComponentsRemove: 'stack-components:remove',
  stackOwnersSelect: 'stack-owners:select',
  runsStart: 'runs:start',
  runsList: 'runs:list',
  runsGet: 'runs:get',
  runsCancel: 'runs:cancel',
  experimentsCreate: 'experiments:create',
  experimentsList: 'experiments:list',
  experimentsGet: 'experiments:get',
  experimentsDrift: 'experiments:drift',
  experimentsStart: 'experiments:start',
  experimentsCancel: 'experiments:cancel',
  experimentsExport: 'experiments:export',
  publishTargetsList: 'publish-targets:list',
  publishPreview: 'publishing:preview',
  publishExecute: 'publishing:execute',
  publishHistory: 'publishing:history',
  maintenanceStatus: 'maintenance:status',
  maintenanceCreateBackup: 'maintenance:create-backup',
  maintenanceSelectRestore: 'maintenance:select-restore',
  maintenanceApplyRestore: 'maintenance:apply-restore',
  maintenanceRevealDataLocation: 'maintenance:reveal-data-location',
  preferencesGet: 'preferences:get',
  preferencesUpdate: 'preferences:update',
  studioProjectCurrent: 'studio-project:current',
  studioProjectOpen: 'studio-project:open',
  studioProjectInit: 'studio-project:init',
  studioProjectImport: 'studio-project:component-import',
  studioProjectDescriptorUpdate: 'studio-project:descriptor-update',
  studioProjectComponentArchive: 'studio-project:component-archive',
  studioProjectComponentDelete: 'studio-project:component-delete',
  studioProjectStackAdd: 'studio-project:stack-add',
  studioProjectStackRemove: 'studio-project:stack-remove',
  studioProjectOwnerSet: 'studio-project:owner-set',
  studioProjectWorkflowCreate: 'studio-project:workflow-create',
  studioProjectWorkflowNodeAdd: 'studio-project:workflow-node-add',
  studioProjectWorkflowNodeRemove: 'studio-project:workflow-node-remove',
  studioProjectWorkflowEdgeAdd: 'studio-project:workflow-edge-add',
  studioProjectWorkflowEdgeRemove: 'studio-project:workflow-edge-remove',
  studioProjectWorkflowFreeze: 'studio-project:workflow-freeze',
  studioProjectFreeze: 'studio-project:freeze',
  studioProjectExport: 'studio-project:export',
  studioProjectExternalChanged: 'studio-project:external-changed',
  demoDataLoad: 'demo-data:load',
  sourceSearch: 'source-discovery:search',
  sourceInspect: 'source-discovery:inspect',
  sourceHandoff: 'source-discovery:handoff',
  sourceCancel: 'source-discovery:cancel',
  sourceClipboardWrite: 'source-discovery:clipboard-write',
  sourceOpenUrl: 'source-discovery:open-url',
  menuCreateAgent: 'menu:create-agent',
  menuOpenSettings: 'menu:open-settings',
} as const

export interface StudioApi {
  agents: {
    create(input: CreateAgentInput): Promise<Agent>
    get(id: string): Promise<AgentDetail>
    list(input?: AgentListInput): Promise<Agent[]>
    statusList(input?: AgentListInput): Promise<AgentStatusProjection[]>
    status(agentId: string): Promise<AgentStatusProjection>
    update(input: UpdateAgentInput): Promise<AgentDetail>
    duplicate(input: DuplicateAgentInput): Promise<AgentDetail>
    archive(agentId: string): Promise<AgentLifecycleResult>
    restore(agentId: string): Promise<AgentLifecycleResult>
    delete(agentId: string): Promise<DeleteAgentResult>
    createVersion(agentId: string): Promise<AgentVersion>
  }
  secrets: {
    list(agentId: string): Promise<SecretReferenceStatus[]>
    configure(input: ConfigureAgentSecretInput): Promise<ConfigureAgentSecretResult>
    delete(input: DeleteAgentSecretInput): Promise<DeleteAgentSecretResult>
  }
  imports: {
    selectAndScan(): Promise<ImportScanResult>
    confirm(scanId: string): Promise<AgentDetail>
  }
  components: {
    list(): Promise<ComponentRecord[]>
    catalog(): Promise<ComponentCatalogItem[]>
    get(componentId: string): Promise<ComponentCatalogItem>
    getStack(agentId: string): Promise<StackState>
    addToStack(input: AddStackComponentInput): Promise<StackState>
    removeFromStack(input: RemoveStackComponentInput): Promise<StackState>
    selectOwner(input: SelectCapabilityOwnerInput): Promise<StackState>
  }
  runs: {
    start(input: StartRunInput): Promise<RunRecord>
    list(agentId: string | null): Promise<RunRecord[]>
    get(runId: string): Promise<RunHistoryDetail>
    cancel(runId: string): Promise<RunHistoryDetail>
  }
  experiments: {
    create(input: CreateExperimentInput): Promise<ExperimentDetail>
    list(agentId: string | null): Promise<ExperimentRecord[]>
    get(experimentId: string): Promise<ExperimentDetail>
    refreshDrift(experimentId: string): Promise<ExperimentDetail>
    start(experimentId: string): Promise<ExperimentDetail>
    cancel(experimentId: string): Promise<ExperimentDetail>
    export(experimentId: string, format: 'json' | 'csv'): Promise<ExportExperimentResult>
  }
  publishing: {
    targets(): Promise<PublishTarget[]>
    preview(input: PublishPreviewInput): Promise<PublishPreview>
    publish(input: PublishExecuteInput): Promise<PublishResult>
    history(targetId: PublishTarget['id'], agentId: string): Promise<PublishHistory>
  }
  maintenance: {
    status(): Promise<MaintenanceStatus>
    createBackup(): Promise<CreateBackupResult>
    selectRestore(): Promise<SelectRestoreResult>
    applyRestore(input: ApplyRestoreInput): Promise<ApplyRestoreResult>
    revealDataLocation(input: RevealDataLocationInput): Promise<RevealDataLocationResult>
  }
  preferences: {
    get(): Promise<RendererPreferences>
    update(input: RendererPreferences): Promise<RendererPreferences>
  }
  studioProject?: {
    current(): Promise<StudioProjectState>
    open(): Promise<StudioProjectState>
    init(): Promise<StudioProjectState>
    importComponent(expectedRevision: number): Promise<StudioProjectState>
    updateDescriptor(input: ProjectDescriptorInput): Promise<StudioProjectState>
    archiveComponent(input: ProjectComponentInput): Promise<StudioProjectState>
    deleteComponent(input: ProjectComponentInput): Promise<StudioProjectState>
    addToStack(input: ProjectComponentInput): Promise<StudioProjectState>
    removeFromStack(input: ProjectComponentInput): Promise<StudioProjectState>
    setOwner(input: ProjectOwnerInput): Promise<StudioProjectState>
    createWorkflow(input: ProjectWorkflowCreateInput): Promise<StudioProjectState>
    addWorkflowNode(input: ProjectWorkflowNodeAddInput): Promise<StudioProjectState>
    removeWorkflowNode(input: ProjectWorkflowNodeRemoveInput): Promise<StudioProjectState>
    addWorkflowEdge(input: ProjectWorkflowEdgeAddInput): Promise<StudioProjectState>
    removeWorkflowEdge(input: ProjectWorkflowEdgeRemoveInput): Promise<StudioProjectState>
    freezeWorkflow(input: ProjectWorkflowFreezeInput): Promise<StudioProjectState>
    freeze(expectedRevision: number): Promise<StudioProjectState>
    export(): Promise<ProjectExportResult>
    loadDemoData(): Promise<ComponentRecord[]>
    onExternalChanged(callback: () => void): () => void
  }
  discovery: {
    search(input: SourceSearchInput): Promise<SourceSearchResult>
    inspect(input: SourceLocatorInput): Promise<DiscoveredRepository>
    handoff(input: SourceHandoffInput): Promise<SourceHandoff>
    cancel(): Promise<{ cancelled: boolean }>
    copy(text: string): Promise<void>
    open(url: string): Promise<void>
  }
  menu: {
    onCreateAgent(callback: () => void): () => void
    onOpenSettings(callback: () => void): () => void
  }
}
