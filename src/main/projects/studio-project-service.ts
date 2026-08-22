import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { StudioCore } from '../../core/studio-core'
import { stableHash } from '../../core/project-model'
import type { ComponentDescriptor } from '../../shared/component'
import type { ExecutionMode } from '../../shared/agent'
import { builtInComponents } from '../components/built-in-components'
import { studioProjectStateSchema, type StudioProjectState } from '../../shared/studio-project'
import type { ComponentService } from '../components/component-service'
import type { ProjectIndexRepository } from '../persistence/project-index-repository'
import type { ProjectExportResult } from '../../shared/agent-stack-package'
import type { AgentRepository } from '../persistence/agent-repository'
import {
  isProjectAgentVersionReference,
  type AgentVersion,
  type MaterializedAgentVersion,
} from '../../shared/agent-detail'
import type { TrustedCompatibilityRuntimeGateway } from '../../core/trusted-compatibility-runtime'
import { StudioCoreError } from '../../core/project-errors'

export class StudioProjectService {
  readonly #core: StudioCore
  readonly #index: ProjectIndexRepository
  readonly #components: ComponentService
  readonly #agents: AgentRepository | null
  readonly #cliPath: string
  readonly #compatibilityRuntime: TrustedCompatibilityRuntimeGateway | null
  #activeRoot: string | null = null
  #watcher: FSWatcher | null = null
  #watchedPath: string | null = null
  #changeListeners = new Set<() => void>()
  #watchTimer: NodeJS.Timeout | undefined
  #pendingRecoveryNotice = false
  #detectingChange = false
  #detectAgain = false
  #lastNotifiedHash: string | null = null
  #notifiedUnreadable = false
  #activeAgentId: string | null = null
  #cachedState: StudioProjectState | null = null
  #pendingAgentId: string | undefined
  #compatibilityValidationControllers = new Map<string, AbortController>()

  constructor(options: {
    core?: StudioCore
    index: ProjectIndexRepository
    components: ComponentService
    agents?: AgentRepository
    cliPath: string
    compatibilityRuntime?: TrustedCompatibilityRuntimeGateway
  }) {
    this.#core = options.core ?? new StudioCore()
    this.#index = options.index
    this.#components = options.components
    this.#agents = options.agents ?? null
    this.#cliPath = options.cliPath
    this.#compatibilityRuntime = options.compatibilityRuntime ?? null
    const latest = this.#index.latest()
    if (latest) this.#activeRoot = path.dirname(latest.projectPath)
  }

  async current(changedExternally = false): Promise<StudioProjectState> {
    if (!this.#activeRoot) {
      return studioProjectStateSchema.parse({
        projectPath: null,
        localAgentId: null,
        project: null,
        validation: null,
        integrity: null,
        recovered: false,
        changedExternally,
        cliPath: this.#cliPath,
      })
    }
    const result = await this.#core.inspectProject(this.#activeRoot)
    const recovered = result.recovered || this.#pendingRecoveryNotice
    this.#pendingRecoveryNotice = false
    this.#index.touch(result.path, result.project)
    this.#lastNotifiedHash = null
    this.#notifiedUnreadable = false
    if (result.migrated) {
      this.#index.recordMaintenance('project-migration', result.project.id, {
        path: result.path,
        revision: result.project.revision,
      })
    }
    if (result.recovered) {
      this.#index.recordMaintenance('project-recovery', result.project.id, { path: result.path })
    }
    this.#startWatching(result.path)
    const link =
      this.#agents?.ensureProjectAgent(result.project, result.path, this.#pendingAgentId) ?? null
    this.#pendingAgentId = undefined
    this.#activeAgentId = link?.agentId ?? null
    const state = studioProjectStateSchema.parse({
      projectPath: result.path,
      localAgentId: link?.agentId ?? null,
      project: result.project,
      validation: this.#core.validate(result.project),
      integrity: result.integrity,
      recovered,
      changedExternally,
      cliPath: this.#cliPath,
    })
    this.#cachedState = state
    return state
  }

  async updateMetadata(input: {
    name: string
    description: string
    executionMode: ExecutionMode
    expectedRevision: number
  }): Promise<StudioProjectState> {
    await this.#core.updateProjectMetadata(this.#requireRoot(), input, {
      expectedRevision: input.expectedRevision,
    })
    return this.current()
  }

  async summary(): Promise<StudioProjectState> {
    if (!this.#activeRoot) return this.current()
    const result = await this.#core.inspectProject(this.#activeRoot)
    this.#startWatching(result.path)
    const link = this.#agents?.ensureProjectAgent(result.project, result.path) ?? null
    this.#activeAgentId = link?.agentId ?? null
    const state = studioProjectStateSchema.parse({
      projectPath: result.path,
      localAgentId: link?.agentId ?? null,
      project: result.project,
      validation: this.#core.validate(result.project),
      integrity: result.integrity,
      recovered: result.recovered || this.#pendingRecoveryNotice,
      changedExternally: false,
      cliPath: this.#cliPath,
    })
    this.#cachedState = state
    return state
  }

  async open(rootPath: string): Promise<StudioProjectState> {
    const result = await this.#core.inspectProject(rootPath)
    this.#pendingRecoveryNotice = result.recovered
    this.#activeRoot = path.dirname(result.path)
    this.#index.touch(result.path, result.project)
    this.#startWatching(result.path)
    return this.current()
  }

  async init(
    rootPath: string,
    input?: {
      name: string
      description?: string
      executionMode?: Parameters<StudioCore['initProject']>[1]['executionMode']
    },
    preferredAgentId?: string,
  ): Promise<StudioProjectState> {
    this.#pendingAgentId = preferredAgentId
    let result
    try {
      result = await this.#core.initProject(rootPath, {
        name: input?.name ?? path.basename(path.resolve(rootPath)),
        description: input?.description,
        executionMode: input?.executionMode,
      })
    } catch (error) {
      this.#pendingAgentId = undefined
      throw error
    }
    this.#activeRoot = path.dirname(result.path)
    this.#index.touch(result.path, result.project)
    this.#startWatching(result.path)
    return this.current()
  }

  async importComponent(sourcePath: string, expectedRevision: number): Promise<StudioProjectState> {
    const root = this.#requireRoot()
    const inspection = await this.#core.inspectComponent(sourcePath)
    const result = await this.#core.importComponent(root, sourcePath, { expectedRevision })
    const component = result.project.components.find(
      ({ descriptor }) =>
        descriptor.id === inspection.descriptor.id &&
        descriptor.version === inspection.descriptor.version,
    )
    if (component) this.#index.setComponentPath(result.project.id, component.id, sourcePath)
    return this.current()
  }

  async updateDescriptor(
    componentId: string,
    descriptor: ComponentDescriptor,
    expectedRevision: number,
  ): Promise<StudioProjectState> {
    await this.#core.confirmComponentDescriptor(this.#requireRoot(), componentId, descriptor, {
      expectedRevision,
    })
    return this.current()
  }

  async archive(componentId: string, expectedRevision: number): Promise<StudioProjectState> {
    await this.#core.archiveComponent(this.#requireRoot(), componentId, { expectedRevision })
    return this.current()
  }

  async restore(componentId: string, expectedRevision: number): Promise<StudioProjectState> {
    await this.#core.restoreComponent(this.#requireRoot(), componentId, { expectedRevision })
    return this.current()
  }

  async recheck(componentId: string, expectedRevision: number): Promise<StudioProjectState> {
    const state = await this.current()
    if (!state.project) throw new StudioCoreError('PROJECT_NOT_FOUND', '请先打开 Studio 项目。')
    const sourcePath = this.#index.componentPath(state.project.id, componentId)
    if (!sourcePath) {
      throw new StudioCoreError('COMPONENT_NOT_FOUND', '当前 Mac 没有该组件的本地来源路径。', {
        suggestedActions: [{ description: '使用“导入本地组件”重新选择来源目录。' }],
      })
    }
    await this.#core.updateComponent(this.#requireRoot(), componentId, {
      expectedRevision,
      sourcePath,
    })
    return this.current()
  }

  async contractTest(componentId: string, expectedRevision: number): Promise<StudioProjectState> {
    await this.#core.runComponentContractTest(this.#requireRoot(), componentId, {
      expectedRevision,
    })
    return this.current()
  }

  async runtimeValidate(
    componentId: string,
    expectedRevision: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<StudioProjectState> {
    if (!this.#compatibilityRuntime) {
      throw new StudioCoreError('UNSAFE_SOURCE', '受信兼容性 Runtime 未配置。')
    }
    if (this.#compatibilityValidationControllers.has(componentId)) {
      throw new StudioCoreError('REVISION_CONFLICT', '该组件已在进行运行验证。')
    }
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    signal?.addEventListener('abort', forwardAbort, { once: true })
    this.#compatibilityValidationControllers.set(componentId, controller)
    try {
      await this.#core.runTrustedComponentValidation(
        this.#requireRoot(),
        componentId,
        this.#compatibilityRuntime,
        { expectedRevision, timeoutMs, signal: controller.signal },
      )
      return this.current()
    } finally {
      signal?.removeEventListener('abort', forwardAbort)
      this.#compatibilityValidationControllers.delete(componentId)
    }
  }

  cancelRuntimeValidation(componentId: string): boolean {
    const controller = this.#compatibilityValidationControllers.get(componentId)
    if (!controller) return false
    controller.abort()
    return true
  }

  async delete(componentId: string, expectedRevision: number): Promise<StudioProjectState> {
    await this.#core.deleteComponent(this.#requireRoot(), componentId, { expectedRevision })
    return this.current()
  }

  async stackAdd(componentId: string, expectedRevision: number): Promise<StudioProjectState> {
    await this.#core.addStackComponent(this.#requireRoot(), componentId, { expectedRevision })
    return this.current()
  }

  async stackRemove(componentId: string, expectedRevision: number): Promise<StudioProjectState> {
    await this.#core.removeStackComponent(this.#requireRoot(), componentId, { expectedRevision })
    return this.current()
  }

  async ownerSet(
    capability: Parameters<StudioCore['setOwner']>[1],
    componentId: string,
    expectedRevision: number,
  ): Promise<StudioProjectState> {
    await this.#core.setOwner(this.#requireRoot(), capability, componentId, { expectedRevision })
    return this.current()
  }

  async workflowCreate(
    name: string,
    description: string,
    expectedRevision: number,
  ): Promise<StudioProjectState> {
    await this.#core.createWorkflow(
      this.#requireRoot(),
      { name, description },
      { expectedRevision },
    )
    return this.current()
  }

  async workflowNodeAdd(
    workflowId: string,
    node: Parameters<StudioCore['addWorkflowNode']>[2],
    expectedRevision: number,
  ): Promise<StudioProjectState> {
    await this.#core.addWorkflowNode(this.#requireRoot(), workflowId, node, { expectedRevision })
    return this.current()
  }

  async workflowNodeRemove(
    workflowId: string,
    nodeId: string,
    expectedRevision: number,
  ): Promise<StudioProjectState> {
    await this.#core.removeWorkflowNode(this.#requireRoot(), workflowId, nodeId, {
      expectedRevision,
    })
    return this.current()
  }

  async workflowEdgeAdd(
    workflowId: string,
    from: string,
    to: string,
    expectedRevision: number,
  ): Promise<StudioProjectState> {
    await this.#core.addWorkflowEdge(this.#requireRoot(), workflowId, from, to, {
      expectedRevision,
    })
    return this.current()
  }

  async workflowEdgeRemove(
    workflowId: string,
    edgeId: string,
    expectedRevision: number,
  ): Promise<StudioProjectState> {
    await this.#core.removeWorkflowEdge(this.#requireRoot(), workflowId, edgeId, {
      expectedRevision,
    })
    return this.current()
  }

  async workflowFreeze(workflowId: string, expectedRevision: number): Promise<StudioProjectState> {
    await this.#core.freezeWorkflowVersion(this.#requireRoot(), workflowId, { expectedRevision })
    return this.current()
  }

  async freeze(expectedRevision: number): Promise<StudioProjectState> {
    await this.#core.freezeVersion(this.#requireRoot(), { expectedRevision })
    return this.current()
  }

  async freezeForAgent(agentId: string): Promise<AgentVersion> {
    const state = await this.current()
    if (!state.project || state.localAgentId !== agentId) {
      throw new Error('请先切换到该 Agent 绑定的 Studio 项目。')
    }
    const frozen = await this.#core.freezeVersion(this.#requireRoot(), {
      expectedRevision: state.project.revision,
    })
    if (!this.#agents) throw new Error('本机 Agent 引用存储不可用。')
    const version = this.#agents.createProjectVersionReference(
      agentId,
      frozen.result.project,
      frozen.version,
    )
    await this.current()
    return version
  }

  activeComposition(agentId: string): StudioProjectState | null {
    if (this.#activeAgentId !== agentId || !this.#cachedState?.project) return null
    return this.#cachedState
  }

  activeAgentId(): string | null {
    return this.#activeAgentId
  }

  materializeVersion(agentId: string, version: AgentVersion): MaterializedAgentVersion {
    if (!isProjectAgentVersionReference(version.snapshot)) {
      return { ...version, snapshot: version.snapshot }
    }
    const reference = version.snapshot
    const state = this.activeComposition(agentId)
    const project = state?.project
    if (!project || project.id !== reference.projectId) {
      throw new Error('请先切换到该 Agent Version 绑定的项目。')
    }
    const projectVersion = project.versions.find(({ id }) => id === reference.projectVersionId)
    if (!projectVersion || projectVersion.contentHash !== version.contentHash) {
      throw new Error('本地 Agent Version 引用与项目中的不可变 Version 不一致。')
    }
    const componentsById = new Map(
      projectVersion.snapshot.components.map((component) => [component.id, component]),
    )
    return {
      ...version,
      snapshot: {
        agent: {
          id: agentId,
          name: projectVersion.snapshot.project.name,
          description: project.description,
          executionMode: projectVersion.snapshot.stack.executionMode,
        },
        stack: {
          executionMode: projectVersion.snapshot.stack.executionMode,
          revision: reference.projectRevision + 1,
          components: projectVersion.snapshot.stack.componentIds.map((componentId) => {
            const component = componentsById.get(componentId)
            if (!component) throw new Error('项目 Version 引用的组件快照不完整。')
            return {
              componentId,
              contractId: component.descriptor.id,
              version: component.descriptor.version,
            }
          }),
          capabilityOwners: projectVersion.snapshot.stack.capabilityOwners,
        },
      },
    }
  }

  exportTo(destinationPath: string): Promise<ProjectExportResult> {
    return this.#core.exportProjectPackage(this.#requireRoot(), destinationPath)
  }

  async loadDemoData() {
    const current = await this.current()
    if (!current.project) throw new Error('请先打开或创建 Agent 项目。')
    const result = await this.#core.installDeclaredComponents(
      this.#requireRoot(),
      builtInComponents,
      { expectedRevision: current.project.revision },
    )
    this.#index.setPreference('demo-data-loaded', true)
    this.#index.recordMaintenance('demo-data-load', result.project.id, {
      componentCount: result.project.components.length,
    })
    await this.current()
    return this.#components.list()
  }

  onChanged(listener: () => void): () => void {
    this.#changeListeners.add(listener)
    return () => this.#changeListeners.delete(listener)
  }

  close(): void {
    if (this.#watchTimer) clearTimeout(this.#watchTimer)
    this.#watcher?.close()
    this.#watcher = null
    this.#watchedPath = null
    this.#changeListeners.clear()
    this.#cachedState = null
    this.#activeAgentId = null
  }

  #requireRoot(): string {
    if (!this.#activeRoot) throw new Error('请先打开或创建 Studio 项目。')
    return this.#activeRoot
  }

  #startWatching(projectPath: string): void {
    if (this.#watchedPath === projectPath && this.#watcher) return
    this.#watcher?.close()
    this.#watchedPath = projectPath
    const projectName = path.basename(projectPath)
    const watcher = watch(path.dirname(projectPath), { persistent: false }, (_event, fileName) => {
      if (fileName !== null && String(fileName) !== projectName) return
      if (this.#watchTimer) clearTimeout(this.#watchTimer)
      this.#watchTimer = setTimeout(() => {
        this.#watchTimer = undefined
        void this.#detectExternalChange(projectPath)
      }, 120)
    })
    this.#watcher = watcher
    watcher.on('error', () => {
      if (this.#watcher !== watcher) return
      watcher.close()
      this.#watcher = null
      this.#watchedPath = null
      this.#notifyUnreadable()
    })
  }

  async #detectExternalChange(projectPath: string): Promise<void> {
    if (this.#detectingChange) {
      this.#detectAgain = true
      return
    }
    this.#detectingChange = true
    try {
      do {
        this.#detectAgain = false
        try {
          const result = await this.#core.inspectProject(projectPath)
          if (result.recovered) this.#pendingRecoveryNotice = true
          const indexed = this.#index.findByPath(result.path)
          const currentHash = stableHash(result.project)
          this.#notifiedUnreadable = false
          if (indexed?.lastSeenHash === currentHash) {
            this.#lastNotifiedHash = null
            continue
          }
          if (this.#lastNotifiedHash === currentHash) continue
          // Refresh the shared project projection before notifying Renderer subscribers. Do not
          // call current() here: that would consume a pending backup-recovery notice before GUI
          // readers can display it.
          this.#index.touch(result.path, result.project)
          const link = this.#agents?.ensureProjectAgent(result.project, result.path) ?? null
          this.#activeAgentId = link?.agentId ?? this.#activeAgentId
          this.#cachedState = studioProjectStateSchema.parse({
            projectPath: result.path,
            localAgentId: this.#activeAgentId,
            project: result.project,
            validation: this.#core.validate(result.project),
            integrity: result.integrity,
            recovered: result.recovered || this.#pendingRecoveryNotice,
            changedExternally: true,
            cliPath: this.#cliPath,
          })
          this.#lastNotifiedHash = currentHash
          this.#notifyChanged()
        } catch {
          this.#notifyUnreadable()
        }
      } while (this.#detectAgain)
    } finally {
      this.#detectingChange = false
    }
  }

  #notifyUnreadable(): void {
    if (this.#notifiedUnreadable) return
    this.#notifiedUnreadable = true
    this.#notifyChanged()
  }

  #notifyChanged(): void {
    for (const listener of this.#changeListeners) {
      try {
        listener()
      } catch {
        // A faulty UI listener must not terminate filesystem monitoring.
      }
    }
  }
}
