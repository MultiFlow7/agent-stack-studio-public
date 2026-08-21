import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { StudioCore } from '../../core/studio-core'
import { stableHash } from '../../core/project-model'
import type { ComponentDescriptor } from '../../shared/component'
import { studioProjectStateSchema, type StudioProjectState } from '../../shared/studio-project'
import type { ComponentService } from '../components/component-service'
import type { ProjectIndexRepository } from '../persistence/project-index-repository'
import type { ProjectExportResult } from '../../shared/agent-stack-package'

export class StudioProjectService {
  readonly #core: StudioCore
  readonly #index: ProjectIndexRepository
  readonly #components: ComponentService
  readonly #cliPath: string
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

  constructor(options: {
    core?: StudioCore
    index: ProjectIndexRepository
    components: ComponentService
    cliPath: string
  }) {
    this.#core = options.core ?? new StudioCore()
    this.#index = options.index
    this.#components = options.components
    this.#cliPath = options.cliPath
    const latest = this.#index.latest()
    if (latest) this.#activeRoot = path.dirname(latest.projectPath)
  }

  async current(changedExternally = false): Promise<StudioProjectState> {
    if (!this.#activeRoot) {
      return studioProjectStateSchema.parse({
        projectPath: null,
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
    return studioProjectStateSchema.parse({
      projectPath: result.path,
      project: result.project,
      validation: this.#core.validate(result.project),
      integrity: result.integrity,
      recovered,
      changedExternally,
      cliPath: this.#cliPath,
    })
  }

  async summary(): Promise<StudioProjectState> {
    if (!this.#activeRoot) return this.current()
    const result = await this.#core.inspectProject(this.#activeRoot)
    this.#startWatching(result.path)
    return studioProjectStateSchema.parse({
      projectPath: result.path,
      project: result.project,
      validation: this.#core.validate(result.project),
      integrity: result.integrity,
      recovered: result.recovered || this.#pendingRecoveryNotice,
      changedExternally: false,
      cliPath: this.#cliPath,
    })
  }

  async open(rootPath: string): Promise<StudioProjectState> {
    const result = await this.#core.inspectProject(rootPath)
    this.#pendingRecoveryNotice = result.recovered
    this.#activeRoot = path.dirname(result.path)
    this.#index.touch(result.path, result.project)
    this.#startWatching(result.path)
    return this.current()
  }

  async init(rootPath: string): Promise<StudioProjectState> {
    const result = await this.#core.initProject(rootPath, {
      name: path.basename(path.resolve(rootPath)),
    })
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

  exportTo(destinationPath: string): Promise<ProjectExportResult> {
    return this.#core.exportProjectPackage(this.#requireRoot(), destinationPath)
  }

  loadDemoData() {
    const result = this.#components.loadDemoData()
    this.#index.setPreference('demo-data-loaded', true)
    this.#index.recordMaintenance('demo-data-load', null, { componentCount: result.length })
    return result
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
