import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  componentDescriptorSchema,
  type CapabilityId,
  type ComponentDescriptor,
} from '../shared/component'
import {
  componentFromInspection,
  inspectComponentSource,
  type ComponentInspection,
} from './component-inspector'
import { StudioCoreError } from './project-errors'
import {
  PROJECT_FORMAT_VERSION,
  PROJECT_SCHEMA_ID,
  projectValidationSchema,
  projectVersionSchema,
  projectWorkflowSchema,
  stableHash,
  studioProjectSchema,
  type ProjectComponent,
  type ProjectValidation,
  type ProjectVersion,
  type ProjectWorkflow,
  type StudioProject,
  type WorkflowNode,
  type WorkflowVersion,
} from './project-model'
import { ProjectStore, type ProjectReadResult } from './project-store'
import type { ProjectIntegrityReport } from './project-integrity'
import { buildAgentStackPackage, writeAgentStackPackage } from './agent-stack-package'
import type { ProjectExportResult } from '../shared/agent-stack-package'
import {
  buildCompatibilityRemediationTasks,
  type CompatibilityRemediationTask,
} from '../shared/remediation'

export interface ProjectMutationOptions {
  expectedRevision?: number
}

function projectComparable(project: StudioProject): unknown {
  return Object.fromEntries(
    Object.entries(project).filter(([key]) => key !== 'revision' && key !== 'updatedAt'),
  )
}

function validationAction(code: ProjectValidation['issues'][number]['code']): string[] {
  switch (code) {
    case 'EMPTY_STACK':
      return ['使用 studio stack add <component-id> 添加组件。']
    case 'OWNER_REQUIRED':
    case 'OWNER_INVALID':
      return ['使用 studio stack owner set <capability> <component-id> 设置 Owner。']
    case 'COMPATIBILITY_UNKNOWN':
      return ['更正 Component Descriptor，并把兼容性结论记录为用户确认或更高证据级别。']
    case 'ADAPTER_UNVERIFIED':
      return ['先在受信环境完成契约测试和最小运行验证，再更新 Descriptor。']
    case 'SOURCE_DIRTY':
      return ['提交或明确接受本地变更，然后运行 studio component update。']
    default:
      return ['运行 studio project inspect --json 查看当前状态。']
  }
}

export class StudioCore {
  readonly #store: ProjectStore

  constructor(store = new ProjectStore()) {
    this.#store = store
  }

  async initProject(
    rootPath: string,
    input: {
      name: string
      description?: string
      executionMode?: StudioProject['stack']['executionMode']
    },
  ): Promise<ProjectReadResult> {
    const timestamp = new Date().toISOString()
    const project = studioProjectSchema.parse({
      $schema: PROJECT_SCHEMA_ID,
      formatVersion: PROJECT_FORMAT_VERSION,
      id: randomUUID(),
      name: input.name,
      description: input.description ?? '',
      revision: 0,
      components: [],
      stack: {
        executionMode: input.executionMode ?? 'agent-loop',
        componentIds: [],
        capabilityOwners: [],
      },
      workflows: [],
      versions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    return this.#store.init(rootPath, project)
  }

  inspectProject(rootPath: string): Promise<ProjectReadResult> {
    return this.#store.read(rootPath, { recover: true })
  }

  async exportProjectPackage(
    rootPath: string,
    destinationPath: string,
  ): Promise<ProjectExportResult> {
    const result = await this.#store.read(rootPath, { recover: false })
    if (path.resolve(destinationPath) === result.path) {
      throw new StudioCoreError(
        'PACKAGE_DESTINATION_INVALID',
        '导出目标不能覆盖项目事实文件 .agent-stack。',
        {
          details: { projectPath: result.path, destinationPath: path.resolve(destinationPath) },
          suggestedActions: [
            {
              description: '选择另一个 .agent-stack-package.json 文件作为导出目标。',
            },
          ],
        },
      )
    }
    return writeAgentStackPackage(destinationPath, buildAgentStackPackage(result.project))
  }

  async auditProject(rootPath: string): Promise<{
    path: string
    project: Pick<StudioProject, 'id' | 'name' | 'revision'>
    integrity: ProjectIntegrityReport
  }> {
    const result = await this.#store.read(rootPath, { recover: false })
    return {
      path: result.path,
      project: {
        id: result.project.id,
        name: result.project.name,
        revision: result.project.revision,
      },
      integrity: result.integrity,
    }
  }

  inspectComponent(sourcePath: string): Promise<ComponentInspection> {
    return inspectComponentSource(sourcePath)
  }

  async importComponent(
    rootPath: string,
    sourcePath: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    const inspection = await inspectComponentSource(sourcePath)
    return this.#mutate(rootPath, options, (project) => {
      const existing = project.components.find(
        ({ descriptor }) =>
          descriptor.id === inspection.descriptor.id &&
          descriptor.version === inspection.descriptor.version,
      )
      if (existing?.source.contentHash === inspection.source.contentHash) return project
      const component = componentFromInspection(inspection, existing)
      return {
        ...project,
        components: existing
          ? project.components.map((current) => (current.id === existing.id ? component : current))
          : [...project.components, component],
      }
    })
  }

  async updateComponent(
    rootPath: string,
    componentId: string,
    options: ProjectMutationOptions & { sourcePath?: string } = {},
  ): Promise<ProjectReadResult> {
    const current = await this.inspectProject(rootPath)
    this.#component(current.project, componentId)
    if (!options.sourcePath) {
      throw new StudioCoreError('COMPONENT_NOT_FOUND', '更新组件需要明确提供本地来源路径。', {
        suggestedActions: [
          {
            command: `studio component update ${componentId} --source <path>`,
            description: '指定当前机器上的组件仓库路径。',
          },
        ],
      })
    }
    const inspection = await inspectComponentSource(options.sourcePath)
    return this.#mutate(rootPath, { expectedRevision: options.expectedRevision }, (project) => ({
      ...project,
      components: project.components.map((component) =>
        component.id === componentId ? componentFromInspection(inspection, component) : component,
      ),
    }))
  }

  async confirmComponentDescriptor(
    rootPath: string,
    componentId: string,
    descriptor: ComponentDescriptor,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    const parsed = componentDescriptorSchema.parse(descriptor)
    return this.#mutate(rootPath, options, (project) => {
      this.#component(project, componentId)
      return {
        ...project,
        components: project.components.map((component) =>
          component.id === componentId
            ? {
                ...component,
                descriptor: parsed,
                evidenceLevel: 'user-confirmed' as const,
                updatedAt: new Date().toISOString(),
              }
            : component,
        ),
      }
    })
  }

  async confirmComponentDescriptorFile(
    rootPath: string,
    componentId: string,
    descriptorPath: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    const raw = JSON.parse(await readFile(path.resolve(descriptorPath), 'utf8')) as unknown
    return this.confirmComponentDescriptor(
      rootPath,
      componentId,
      componentDescriptorSchema.parse(raw),
      options,
    )
  }

  archiveComponent(
    rootPath: string,
    componentId: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      const existing = this.#component(project, componentId)
      if (existing.archivedAt) return project
      const timestamp = new Date().toISOString()
      return {
        ...project,
        components: project.components.map((component) =>
          component.id === componentId
            ? { ...component, archivedAt: timestamp, updatedAt: timestamp }
            : component,
        ),
      }
    })
  }

  deleteComponent(
    rootPath: string,
    componentId: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      const component = this.#component(project, componentId)
      const stackReference = project.stack.componentIds.includes(componentId)
      const versionReferences = project.versions
        .filter(({ snapshot }) => snapshot.components.some(({ id }) => id === componentId))
        .map(({ versionNumber }) => versionNumber)
      const workflowReferences = project.workflows.flatMap((workflow) => {
        const current = workflow.nodes.some(
          (node) => node.kind === 'component' && node.componentId === componentId,
        )
        const versions = workflow.versions
          .filter(({ snapshot }) =>
            snapshot.nodes.some(
              (node) => node.kind === 'component' && node.componentId === componentId,
            ),
          )
          .map(({ versionNumber }) => versionNumber)
        return current || versions.length > 0
          ? [{ workflowId: workflow.id, workflowName: workflow.name, current, versions }]
          : []
      })
      if (stackReference || versionReferences.length > 0 || workflowReferences.length > 0) {
        throw new StudioCoreError(
          'COMPONENT_IN_USE',
          '组件仍被 Stack、Workflow 或历史版本引用，不能删除。',
          {
            details: { componentId, stackReference, versionReferences, workflowReferences },
            suggestedActions: [
              {
                command: `studio component archive ${componentId}`,
                description: '归档组件并保留历史引用。',
              },
              {
                command: `studio stack remove ${componentId}`,
                description: '先从当前 Stack 移除组件。',
              },
            ],
          },
        )
      }
      return { ...project, components: project.components.filter(({ id }) => id !== component.id) }
    })
  }

  addStackComponent(
    rootPath: string,
    componentId: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      const component = this.#component(project, componentId)
      if (component.archivedAt) {
        throw new StudioCoreError('STACK_INVALID', '已归档组件不能加入当前 Stack。')
      }
      if (project.stack.componentIds.includes(componentId)) return project
      return {
        ...project,
        stack: { ...project.stack, componentIds: [...project.stack.componentIds, componentId] },
      }
    })
  }

  removeStackComponent(
    rootPath: string,
    componentId: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      if (!project.stack.componentIds.includes(componentId)) return project
      return {
        ...project,
        stack: {
          ...project.stack,
          componentIds: project.stack.componentIds.filter((id) => id !== componentId),
          capabilityOwners: project.stack.capabilityOwners.filter(
            (owner) => owner.componentId !== componentId,
          ),
        },
      }
    })
  }

  setOwner(
    rootPath: string,
    capability: CapabilityId,
    componentId: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      const component = this.#component(project, componentId)
      if (!project.stack.componentIds.includes(componentId)) {
        throw new StudioCoreError('STACK_INVALID', 'Owner 必须是当前 Stack 中的组件。')
      }
      if (!component.descriptor.provides.some((provider) => provider.capability === capability)) {
        throw new StudioCoreError('STACK_INVALID', '所选组件不提供该能力。')
      }
      const existing = project.stack.capabilityOwners.find(
        (owner) => owner.capability === capability,
      )
      if (existing?.componentId === componentId) return project
      return {
        ...project,
        stack: {
          ...project.stack,
          capabilityOwners: [
            ...project.stack.capabilityOwners.filter((owner) => owner.capability !== capability),
            { capability, componentId },
          ],
        },
      }
    })
  }

  createWorkflow(
    rootPath: string,
    input: { name: string; description?: string },
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      const timestamp = new Date().toISOString()
      const workflow = projectWorkflowSchema.parse({
        id: randomUUID(),
        name: input.name,
        description: input.description ?? '',
        revision: 0,
        nodes: [],
        edges: [],
        versions: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      return { ...project, workflows: [...project.workflows, workflow] }
    })
  }

  addWorkflowNode(
    rootPath: string,
    workflowId: string,
    input:
      | { kind: 'operation'; name: string; operation: string }
      | { kind: 'component'; name: string; componentId: string }
      | { kind: 'agent-version'; name: string; agentVersionId: string }
      | {
          kind: 'workflow-version'
          name: string
          workflowId: string
          workflowVersionId: string
        },
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      const workflow = this.#workflow(project, workflowId)
      if (input.kind === 'component') this.#component(project, input.componentId)
      if (input.kind === 'workflow-version') {
        const target = this.#workflow(project, input.workflowId)
        if (!target.versions.some(({ id }) => id === input.workflowVersionId)) {
          throw new StudioCoreError(
            'WORKFLOW_VERSION_NOT_FOUND',
            '子 Workflow 必须绑定已存在的不可变 Version。',
          )
        }
      }
      const node = { id: randomUUID(), ...input } as WorkflowNode
      return this.#replaceWorkflow(project, workflowId, {
        ...workflow,
        nodes: [...workflow.nodes, node],
      })
    })
  }

  removeWorkflowNode(
    rootPath: string,
    workflowId: string,
    nodeId: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      const workflow = this.#workflow(project, workflowId)
      if (!workflow.nodes.some(({ id }) => id === nodeId)) {
        throw new StudioCoreError('WORKFLOW_INVALID', '指定的 Workflow 节点不存在。')
      }
      return this.#replaceWorkflow(project, workflowId, {
        ...workflow,
        nodes: workflow.nodes.filter(({ id }) => id !== nodeId),
        edges: workflow.edges.filter(({ from, to }) => from !== nodeId && to !== nodeId),
      })
    })
  }

  addWorkflowEdge(
    rootPath: string,
    workflowId: string,
    from: string,
    to: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      const workflow = this.#workflow(project, workflowId)
      if (
        !workflow.nodes.some(({ id }) => id === from) ||
        !workflow.nodes.some(({ id }) => id === to)
      ) {
        throw new StudioCoreError('WORKFLOW_INVALID', 'Workflow 边必须连接已存在的节点。')
      }
      if (workflow.edges.some((edge) => edge.from === from && edge.to === to)) return project
      if (from === to || this.#workflowPathExists(workflow, to, from)) {
        throw new StudioCoreError('WORKFLOW_CYCLE', '保存被拒绝：Workflow DAG 检测到直接循环。', {
          details: { workflowId, from, to },
          suggestedActions: [{ description: '移除回边，确保每条路径只沿 DAG 向前。' }],
        })
      }
      return this.#replaceWorkflow(project, workflowId, {
        ...workflow,
        edges: [...workflow.edges, { id: randomUUID(), from, to }],
      })
    })
  }

  removeWorkflowEdge(
    rootPath: string,
    workflowId: string,
    edgeId: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      const workflow = this.#workflow(project, workflowId)
      if (!workflow.edges.some(({ id }) => id === edgeId)) {
        throw new StudioCoreError('WORKFLOW_INVALID', '指定的 Workflow 边不存在。')
      }
      return this.#replaceWorkflow(project, workflowId, {
        ...workflow,
        edges: workflow.edges.filter(({ id }) => id !== edgeId),
      })
    })
  }

  async freezeWorkflowVersion(
    rootPath: string,
    workflowId: string,
    options: ProjectMutationOptions = {},
  ): Promise<{ result: ProjectReadResult; version: WorkflowVersion; reused: boolean }> {
    const current = await this.inspectProject(rootPath)
    const workflow = this.#workflow(current.project, workflowId)
    if (workflow.nodes.length === 0) {
      throw new StudioCoreError('WORKFLOW_INVALID', '空 Workflow 不能冻结。', {
        suggestedActions: [{ description: '至少添加一个结构化节点。' }],
      })
    }
    const snapshot = {
      name: workflow.name,
      description: workflow.description,
      nodes: structuredClone(workflow.nodes),
      edges: structuredClone(workflow.edges),
    }
    const contentHash = stableHash(snapshot)
    const existing = workflow.versions.find((version) => version.contentHash === contentHash)
    if (existing) return { result: current, version: existing, reused: true }
    let created: WorkflowVersion | undefined
    const result = await this.#mutate(rootPath, options, (project) => {
      const latest = this.#workflow(project, workflowId)
      created = {
        id: randomUUID(),
        versionNumber: (latest.versions.at(-1)?.versionNumber ?? 0) + 1,
        sourceRevision: latest.revision,
        contentHash,
        snapshot,
        createdAt: new Date().toISOString(),
      }
      return this.#replaceWorkflow(project, workflowId, {
        ...latest,
        versions: [...latest.versions, created],
      })
    })
    if (!created) throw new Error('Workflow Version creation failed.')
    return { result, version: created, reused: false }
  }

  listWorkflows(project: StudioProject): ProjectWorkflow[] {
    return [...project.workflows].sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-CN'),
    )
  }

  inspectWorkflow(project: StudioProject, workflowId: string): ProjectWorkflow {
    return this.#workflow(project, workflowId)
  }

  validate(project: StudioProject, checkedAt = new Date().toISOString()): ProjectValidation {
    const issues: ProjectValidation['issues'] = []
    const remediationTasks: CompatibilityRemediationTask[] = []
    const byId = new Map(project.components.map((component) => [component.id, component]))
    const components = project.stack.componentIds.flatMap((id) => {
      const component = byId.get(id)
      if (!component) {
        issues.push({
          severity: 'error',
          code: 'COMPONENT_MISSING',
          message: `Stack 组件 ${id} 不存在。`,
          componentId: null,
          capability: null,
          suggestedActions: validationAction('COMPONENT_MISSING'),
        })
        return []
      }
      return [component]
    })
    if (components.length === 0) {
      issues.push({
        severity: 'error',
        code: 'EMPTY_STACK',
        message: 'Stack 尚未添加组件。',
        componentId: null,
        capability: null,
        suggestedActions: validationAction('EMPTY_STACK'),
      })
    }
    const providers = new Map<CapabilityId, ProjectComponent[]>()
    for (const component of components) {
      if (component.archivedAt) {
        issues.push({
          severity: 'error',
          code: 'COMPONENT_ARCHIVED',
          message: `${component.descriptor.name} 已归档。`,
          componentId: component.id,
          capability: null,
          suggestedActions: ['从当前 Stack 移除归档组件。'],
        })
      }
      const compatibility = component.descriptor.compatibility
      if (compatibility.level === 'blocked' || compatibility.validation === 'failed') {
        issues.push({
          severity: 'error',
          code: 'COMPONENT_BLOCKED',
          message: `${component.descriptor.name} 已阻断：${compatibility.detail}`,
          componentId: component.id,
          capability: null,
          suggestedActions: validationAction('COMPONENT_BLOCKED'),
        })
      } else if (compatibility.level === 'unknown') {
        issues.push({
          severity: 'error',
          code: 'COMPATIBILITY_UNKNOWN',
          message: `${component.descriptor.name} 缺少兼容性结论。`,
          componentId: component.id,
          capability: null,
          suggestedActions: validationAction('COMPATIBILITY_UNKNOWN'),
        })
      } else if (
        ['adapter', 'fork'].includes(compatibility.level) &&
        compatibility.validation !== 'runtime-verified'
      ) {
        remediationTasks.push(
          ...buildCompatibilityRemediationTasks({
            componentId: component.id,
            componentName: component.descriptor.name,
            compatibility,
          }),
        )
        issues.push({
          severity: 'error',
          code: 'ADAPTER_UNVERIFIED',
          message: `${component.descriptor.name} 尚未通过最小运行验证。`,
          componentId: component.id,
          capability: null,
          suggestedActions: validationAction('ADAPTER_UNVERIFIED'),
        })
      }
      if (
        component.source.git.status === 'modified' ||
        component.source.git.status === 'untracked'
      ) {
        issues.push({
          severity: 'warning',
          code: 'SOURCE_DIRTY',
          message: `${component.descriptor.name} 的 Git 工作树不是 clean。`,
          componentId: component.id,
          capability: null,
          suggestedActions: validationAction('SOURCE_DIRTY'),
        })
      }
      for (const provider of component.descriptor.provides) {
        providers.set(provider.capability, [
          ...(providers.get(provider.capability) ?? []),
          component,
        ])
      }
    }
    const owners = new Map(
      project.stack.capabilityOwners.map((owner) => [owner.capability, owner.componentId]),
    )
    for (const [capability, candidates] of providers) {
      const ownerId = owners.get(capability)
      if (candidates.length > 1 && !ownerId) {
        issues.push({
          severity: 'error',
          code: 'OWNER_REQUIRED',
          message: `${capability} 有 ${candidates.length} 个 Provider，必须明确选择 Owner。`,
          componentId: null,
          capability,
          suggestedActions: validationAction('OWNER_REQUIRED'),
        })
      } else if (ownerId && !candidates.some(({ id }) => id === ownerId)) {
        issues.push({
          severity: 'error',
          code: 'OWNER_INVALID',
          message: `${capability} 的 Owner 不提供该能力。`,
          componentId: ownerId,
          capability,
          suggestedActions: validationAction('OWNER_INVALID'),
        })
      }
      if (ownerId) {
        for (const candidate of candidates) {
          const provider = candidate.descriptor.provides.find(
            (item) => item.capability === capability,
          )
          if (candidate.id !== ownerId && provider?.activation === 'always-active') {
            issues.push({
              severity: 'error',
              code: 'UNCONTROLLED_SIDE_EFFECT',
              message: `${candidate.descriptor.name} 未成为 Owner 但仍会激活 ${capability}。`,
              componentId: candidate.id,
              capability,
              suggestedActions: validationAction('UNCONTROLLED_SIDE_EFFECT'),
            })
          }
        }
      }
    }
    for (const component of components) {
      for (const requirement of component.descriptor.requires) {
        if (!providers.has(requirement.capability)) {
          issues.push({
            severity: 'error',
            code: 'UNSATISFIED_REQUIREMENT',
            message: `${component.descriptor.name} 依赖 ${requirement.capability}，当前 Stack 没有 Provider。`,
            componentId: component.id,
            capability: requirement.capability,
            suggestedActions: validationAction('UNSATISFIED_REQUIREMENT'),
          })
        }
      }
    }
    const blocking = issues.some(({ severity }) => severity === 'error')
    return projectValidationSchema.parse({
      status: blocking ? 'blocked' : 'ready',
      revision: project.revision,
      issues,
      remediationTasks,
      runtimePlanHash: blocking
        ? null
        : stableHash({
            stack: project.stack,
            components: components.map(({ id, descriptor }) => ({ id, descriptor })),
          }),
      checkedAt,
    })
  }

  async validateProject(
    rootPath: string,
  ): Promise<{ project: StudioProject; validation: ProjectValidation }> {
    const { project } = await this.inspectProject(rootPath)
    return { project, validation: this.validate(project) }
  }

  async freezeVersion(
    rootPath: string,
    options: ProjectMutationOptions = {},
  ): Promise<{ result: ProjectReadResult; version: ProjectVersion; reused: boolean }> {
    const current = await this.inspectProject(rootPath)
    const validation = this.validate(current.project)
    if (validation.status !== 'ready') {
      throw new StudioCoreError('STACK_INVALID', 'Stack 验证未通过，不能创建不可变版本。', {
        details: { issues: validation.issues },
        suggestedActions: [
          { command: 'studio stack validate --json', description: '查看并解决阻断问题。' },
        ],
      })
    }
    const workflowComponentIds = current.project.workflows.flatMap((workflow) => [
      ...workflow.nodes.flatMap((node) => (node.kind === 'component' ? [node.componentId] : [])),
      ...workflow.versions.flatMap(({ snapshot }) =>
        snapshot.nodes.flatMap((node) => (node.kind === 'component' ? [node.componentId] : [])),
      ),
    ])
    const snapshotComponentIds = [
      ...new Set([...current.project.stack.componentIds, ...workflowComponentIds]),
    ]
    const components = snapshotComponentIds.map((id) => this.#component(current.project, id))
    const snapshot = {
      project: { id: current.project.id, name: current.project.name },
      stack: structuredClone(current.project.stack),
      components: structuredClone(components),
      workflows: structuredClone(current.project.workflows),
    }
    const contentHash = stableHash(snapshot)
    const existing = current.project.versions.find((version) => version.contentHash === contentHash)
    if (existing) return { result: current, version: existing, reused: true }
    let created: ProjectVersion | undefined
    const result = await this.#mutate(rootPath, options, (project) => {
      created = projectVersionSchema.parse({
        id: randomUUID(),
        versionNumber: (project.versions.at(-1)?.versionNumber ?? 0) + 1,
        sourceRevision: project.revision,
        contentHash,
        snapshot,
        createdAt: new Date().toISOString(),
      })
      return { ...project, versions: [...project.versions, created] }
    })
    if (!created) throw new Error('Version creation failed.')
    return { result, version: created, reused: false }
  }

  listVersions(project: StudioProject): ProjectVersion[] {
    return [...project.versions].sort((left, right) => right.versionNumber - left.versionNumber)
  }

  inspectVersion(project: StudioProject, versionIdentity: string): ProjectVersion {
    const versionNumber = Number(versionIdentity)
    const version = project.versions.find(
      (candidate) => candidate.id === versionIdentity || candidate.versionNumber === versionNumber,
    )
    if (!version) throw new StudioCoreError('VERSION_NOT_FOUND', '指定的项目版本不存在。')
    return version
  }

  async #mutate(
    rootPath: string,
    options: ProjectMutationOptions,
    mutate: (project: StudioProject) => StudioProject,
  ): Promise<ProjectReadResult> {
    const current = await this.inspectProject(rootPath)
    const expectedRevision = options.expectedRevision ?? current.project.revision
    if (expectedRevision !== current.project.revision) {
      throw new StudioCoreError('REVISION_CONFLICT', '提交的 revision 已过期。', {
        details: { expectedRevision, actualRevision: current.project.revision },
        suggestedActions: [
          { command: 'studio project inspect --json', description: '重新读取项目状态后重试。' },
        ],
      })
    }
    const next = studioProjectSchema.parse(mutate(structuredClone(current.project)))
    if (
      JSON.stringify(projectComparable(next)) === JSON.stringify(projectComparable(current.project))
    ) {
      return current
    }
    const timestamp = new Date().toISOString()
    return this.#store.write(
      rootPath,
      studioProjectSchema.parse({
        ...next,
        revision: current.project.revision + 1,
        updatedAt: timestamp,
      }),
      expectedRevision,
    )
  }

  #component(project: StudioProject, componentId: string): ProjectComponent {
    const component = project.components.find(({ id }) => id === componentId)
    if (!component)
      throw new StudioCoreError('COMPONENT_NOT_FOUND', '指定的项目组件不存在。', {
        details: { componentId },
      })
    return component
  }

  #workflow(project: StudioProject, workflowId: string): ProjectWorkflow {
    const workflow = project.workflows.find(({ id }) => id === workflowId)
    if (!workflow) {
      throw new StudioCoreError('WORKFLOW_NOT_FOUND', '指定的 Workflow 不存在。', {
        details: { workflowId },
      })
    }
    return workflow
  }

  #replaceWorkflow(
    project: StudioProject,
    workflowId: string,
    workflow: ProjectWorkflow,
  ): StudioProject {
    const timestamp = new Date().toISOString()
    const next = projectWorkflowSchema.parse({
      ...workflow,
      revision: workflow.revision + 1,
      updatedAt: timestamp,
    })
    return {
      ...project,
      workflows: project.workflows.map((current) => (current.id === workflowId ? next : current)),
    }
  }

  #workflowPathExists(workflow: ProjectWorkflow, start: string, target: string): boolean {
    const outgoing = new Map<string, string[]>()
    for (const edge of workflow.edges) {
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
    }
    const pending = [start]
    const visited = new Set<string>()
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current || visited.has(current)) continue
      if (current === target) return true
      visited.add(current)
      pending.push(...(outgoing.get(current) ?? []))
    }
    return false
  }
}
