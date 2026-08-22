import { randomUUID } from 'node:crypto'
import { copyFile, readFile } from 'node:fs/promises'
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
import { assessComponentCompatibility } from '../shared/compatibility-assessment'
import type { AgentDetail } from '../shared/agent-detail'
import { isProjectAgentVersionReference } from '../shared/agent-detail'
import type { ComponentRecord } from '../shared/component'
import type { StackState } from '../shared/runtime-plan'
import { isTrustedRuntimeAdapterRef } from '../shared/trusted-execution'
import type { TrustedCompatibilityRuntimeGateway } from './trusted-compatibility-runtime'

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
      return ['执行静态兼容性评估，按证据补全平台、入口、配置或 Adapter 契约。']
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

  async updateProjectMetadata(
    rootPath: string,
    input: Pick<StudioProject, 'name' | 'description'> & {
      executionMode: StudioProject['stack']['executionMode']
    },
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => ({
      ...project,
      name: input.name.trim(),
      description: input.description,
      stack: { ...project.stack, executionMode: input.executionMode },
    }))
  }

  async migrateLegacyAgentProject(
    rootPath: string,
    detail: AgentDetail,
    stack: StackState,
    catalog: ComponentRecord[],
  ): Promise<ProjectReadResult> {
    const referencedIds = new Set([
      ...stack.components.map(({ id }) => id),
      ...detail.versions.flatMap((version) =>
        isProjectAgentVersionReference(version.snapshot)
          ? []
          : version.snapshot.stack.components.map(({ componentId }) => componentId),
      ),
    ])
    // The legacy catalog was global. Copy every descriptor into each migrated Agent project so
    // no unassigned library entry is silently discarded when SQLite portable tables are retired.
    const records = catalog
    const missing = [...referencedIds].filter((id) => !records.some((record) => record.id === id))
    if (missing.length) {
      throw new StudioCoreError(
        'COMPONENT_NOT_FOUND',
        '历史 Agent 引用的组件记录不完整，已拒绝迁移。',
        {
          details: { missingComponentIds: missing },
        },
      )
    }
    const toProjectComponent = (record: ComponentRecord): ProjectComponent => ({
      id: record.id,
      descriptor: record.descriptor,
      evidenceLevel: 'declared',
      source: {
        path: `legacy-sqlite:${record.id}`,
        manifestPath: null,
        readmePath: null,
        licensePath: null,
        git: { remote: null, commit: null, status: 'unavailable' },
        files: [],
        contentHash: stableHash(record.descriptor),
        inspectedAt: record.updatedAt,
      },
      archivedAt: null,
      importedAt: record.createdAt,
      updatedAt: record.updatedAt,
    })
    const components = records.map(toProjectComponent)
    const byId = new Map(components.map((component) => [component.id, component]))
    const versions = detail.versions.map((version) => {
      if (isProjectAgentVersionReference(version.snapshot)) {
        throw new StudioCoreError(
          'PROJECT_INVALID',
          '未绑定的历史 Agent 包含项目引用，已拒绝混合迁移。',
        )
      }
      const snapshotComponents = version.snapshot.stack.components.map(({ componentId }) => {
        const component = byId.get(componentId)
        if (!component) throw new Error(`Missing migrated component ${componentId}`)
        return component
      })
      const snapshot = {
        project: { id: detail.agent.id, name: version.snapshot.agent.name },
        stack: {
          executionMode: version.snapshot.stack.executionMode,
          componentIds: version.snapshot.stack.components.map(({ componentId }) => componentId),
          capabilityOwners: version.snapshot.stack.capabilityOwners,
        },
        components: snapshotComponents,
        workflows: [],
      }
      return projectVersionSchema.parse({
        id: version.id,
        versionNumber: version.versionNumber,
        sourceRevision: Math.max(0, version.snapshot.stack.revision - 1),
        contentHash: stableHash(snapshot),
        snapshot,
        createdAt: version.createdAt,
      })
    })
    const project = studioProjectSchema.parse({
      $schema: PROJECT_SCHEMA_ID,
      formatVersion: PROJECT_FORMAT_VERSION,
      id: detail.agent.id,
      name: detail.agent.name,
      description: detail.agent.description,
      revision: detail.draft.revision,
      components,
      stack: {
        executionMode: detail.draft.executionMode,
        componentIds: stack.components.map(({ id }) => id),
        capabilityOwners: stack.owners.map(({ capability, componentId }) => ({
          capability,
          componentId,
        })),
      },
      workflows: [],
      versions,
      createdAt: detail.agent.createdAt,
      updatedAt: detail.agent.updatedAt,
    })
    const result = await this.#store.init(rootPath, project)
    if (result.project.id !== detail.agent.id) {
      throw new StudioCoreError(
        'PROJECT_ALREADY_EXISTS',
        '迁移目录中已有同名但不同 ID 的项目，已拒绝覆盖。',
        {
          details: { expectedProjectId: detail.agent.id, actualProjectId: result.project.id },
        },
      )
    }
    await copyFile(result.path, `${result.path}.migration-backup`)
    return result
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

  async installDeclaredComponents(
    rootPath: string,
    records: Array<Pick<ComponentRecord, 'id' | 'descriptor'>>,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      const timestamp = new Date().toISOString()
      const existing = new Set(project.components.map(({ id }) => id))
      return {
        ...project,
        components: [
          ...project.components,
          ...records
            .filter(({ id }) => !existing.has(id))
            .map((record) => ({
              id: record.id,
              descriptor: record.descriptor,
              evidenceLevel: 'declared' as const,
              source: {
                path: `studio-builtin:${record.id}`,
                manifestPath: null,
                readmePath: null,
                licensePath: null,
                git: { remote: null, commit: null, status: 'unavailable' as const },
                files: [],
                contentHash: stableHash(record.descriptor),
                inspectedAt: timestamp,
              },
              archivedAt: null,
              importedAt: timestamp,
              updatedAt: timestamp,
            })),
        ],
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
      const previous = this.#component(project, componentId)
      const strategyChanged = previous.descriptor.compatibility.level !== parsed.compatibility.level
      const timestamp = new Date().toISOString()
      // Descriptor editing is an untrusted human input path. Validation and evidence can only be
      // written by the deterministic inspection/contract/runtime methods below.
      const editableDescriptor = componentDescriptorSchema.parse({
        ...parsed,
        compatibility: {
          ...parsed.compatibility,
          validation: previous.descriptor.compatibility.validation,
        },
        evidence: previous.descriptor.evidence,
      })
      const technicalContractChanged =
        stableHash({
          platforms: previous.descriptor.platforms,
          provides: previous.descriptor.provides,
          requires: previous.descriptor.requires,
          configSchema: previous.descriptor.configSchema,
          runtimeAdapter: previous.descriptor.runtimeAdapter,
          permissions: previous.descriptor.permissions ?? [],
          secretReferences: previous.descriptor.secretReferences ?? [],
          strategy: previous.descriptor.compatibility.level,
        }) !==
        stableHash({
          platforms: editableDescriptor.platforms,
          provides: editableDescriptor.provides,
          requires: editableDescriptor.requires,
          configSchema: editableDescriptor.configSchema,
          runtimeAdapter: editableDescriptor.runtimeAdapter,
          permissions: editableDescriptor.permissions ?? [],
          secretReferences: editableDescriptor.secretReferences ?? [],
          strategy: editableDescriptor.compatibility.level,
        })
      const nextDescriptor = technicalContractChanged
        ? componentDescriptorSchema.parse({
            ...editableDescriptor,
            compatibility: { ...editableDescriptor.compatibility, validation: 'declared' },
            evidence: editableDescriptor.evidence.map((evidence) =>
              ['contract-test', 'runtime-check'].includes(evidence.kind) && !evidence.supersededAt
                ? { ...evidence, supersededAt: timestamp }
                : evidence,
            ),
          })
        : editableDescriptor
      return {
        ...project,
        components: project.components.map((component) =>
          component.id === componentId
            ? {
                ...component,
                descriptor: nextDescriptor,
                evidenceLevel: component.evidenceLevel,
                updatedAt: timestamp,
                auditTrail: [
                  ...(component.auditTrail ?? []),
                  {
                    id: randomUUID(),
                    action: strategyChanged ? 'strategy-selected' : 'descriptor-updated',
                    actor: 'user',
                    summary: strategyChanged
                      ? `处置策略已选择为 ${parsed.compatibility.level}；旧契约/运行证据保留为已失效历史，当前验证回到 declared。`
                      : technicalContractChanged
                        ? '技术契约已更改；旧契约/运行证据保留为已失效历史，当前验证回到 declared。'
                        : '结构化 Descriptor 已更新；不因人工编辑提升技术证据。',
                    recordedAt: timestamp,
                  },
                ],
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
            ? {
                ...component,
                archivedAt: timestamp,
                updatedAt: timestamp,
                auditTrail: [
                  ...(component.auditTrail ?? []),
                  {
                    id: randomUUID(),
                    action: 'archived',
                    actor: 'user',
                    summary: '组件已归档，不可加入当前 Stack，历史引用保持可读。',
                    recordedAt: timestamp,
                  },
                ],
              }
            : component,
        ),
      }
    })
  }

  restoreComponent(
    rootPath: string,
    componentId: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    return this.#mutate(rootPath, options, (project) => {
      const existing = this.#component(project, componentId)
      if (!existing.archivedAt) return project
      const timestamp = new Date().toISOString()
      return {
        ...project,
        components: project.components.map((component) =>
          component.id === componentId
            ? {
                ...component,
                archivedAt: null,
                updatedAt: timestamp,
                auditTrail: [
                  ...(component.auditTrail ?? []),
                  {
                    id: randomUUID(),
                    action: 'restored',
                    actor: 'user',
                    summary: '组件已恢复，可立即在 Agent Stack 中选择。',
                    recordedAt: timestamp,
                  },
                ],
              }
            : component,
        ),
      }
    })
  }

  async runComponentContractTest(
    rootPath: string,
    componentId: string,
    options: ProjectMutationOptions = {},
  ): Promise<ProjectReadResult> {
    const current = await this.inspectProject(rootPath)
    const component = this.#component(current.project, componentId)
    const failures = [
      component.descriptor.compatibility.level === 'unknown'
        ? '尚未选择明确的兼容处置策略。'
        : null,
      component.descriptor.provides.some(({ replaceability }) => replaceability === 'unknown')
        ? '仍有能力的 replaceability 为 unknown。'
        : null,
      ['adapter', 'fork'].includes(component.descriptor.compatibility.level) &&
      !component.descriptor.runtimeAdapter
        ? 'Adapter/Fork 策略缺少 Runtime Adapter 引用。'
        : null,
    ].filter((item): item is string => Boolean(item))
    if (failures.length) {
      throw new StudioCoreError('COMPONENT_INVALID', `契约测试未通过：${failures.join('；')}`, {
        details: { componentId, failures, executedProjectCode: false },
        suggestedActions: [
          { description: '在结构化编辑器中修正能力、替换性、激活方式与入口后重试。' },
        ],
      })
    }
    const recordedAt = new Date().toISOString()
    const receiptId = randomUUID()
    const report = {
      componentId,
      descriptorHash: stableHash(component.descriptor),
      checks: ['schema', 'provides', 'requires', 'replaceability', 'activation', 'entrypoint'],
      executedProjectCode: false,
      recordedAt,
    }
    return this.#mutate(rootPath, options, (project) => ({
      ...project,
      components: project.components.map((candidate) =>
        candidate.id === componentId
          ? {
              ...candidate,
              descriptor: {
                ...candidate.descriptor,
                compatibility: {
                  ...candidate.descriptor.compatibility,
                  validation:
                    candidate.descriptor.compatibility.validation === 'runtime-verified'
                      ? 'runtime-verified'
                      : 'contract-tested',
                  detail: '确定性 Descriptor/Adapter Contract 测试已通过；未执行项目代码。',
                },
                evidence: [
                  ...candidate.descriptor.evidence.filter(
                    ({ kind, supersededAt }) => kind !== 'contract-test' || Boolean(supersededAt),
                  ),
                  {
                    kind: 'contract-test' as const,
                    status: 'passed' as const,
                    method: 'descriptor-contract-test-v1' as const,
                    detail: '结构、能力、依赖、替换性、激活与入口契约全部通过。',
                    recordedAt,
                    receiptId,
                    artifact: {
                      name: 'component-contract-test.json',
                      contentHash: stableHash(report),
                    },
                  },
                ],
              },
              updatedAt: recordedAt,
              auditTrail: [
                ...(candidate.auditTrail ?? []),
                {
                  id: receiptId,
                  action: 'contract-tested' as const,
                  actor: 'system' as const,
                  summary: '契约测试通过，产生可校验 Artifact 与 Receipt。',
                  recordedAt,
                },
              ],
            }
          : candidate,
      ),
    }))
  }

  async runTrustedComponentValidation(
    rootPath: string,
    componentId: string,
    runtime: TrustedCompatibilityRuntimeGateway,
    options: ProjectMutationOptions & { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<ProjectReadResult> {
    const current = await this.inspectProject(rootPath)
    const component = this.#component(current.project, componentId)
    const descriptor = component.descriptor
    if (descriptor.compatibility.validation !== 'contract-tested') {
      throw new StudioCoreError('COMPONENT_INVALID', '必须先通过契约测试，才能进入受信运行验证。')
    }
    if (!descriptor.runtimeAdapter || !isTrustedRuntimeAdapterRef(descriptor.runtimeAdapter)) {
      throw new StudioCoreError(
        'UNSAFE_SOURCE',
        '运行验证已拒绝：只允许精确白名单中的 Runtime Adapter，未知代码未执行。',
        { details: { componentId, executedProjectCode: false } },
      )
    }
    if (options.signal?.aborted) {
      throw new DOMException('兼容性运行验证已取消。', 'AbortError')
    }
    const receipt = await runtime.validate(
      {
        componentId,
        contractId: descriptor.id,
        componentVersion: descriptor.version,
        adapterRef: descriptor.runtimeAdapter,
        timeoutMs: options.timeoutMs ?? 5_000,
      },
      options.signal,
    )
    if (receipt.status !== 'succeeded') {
      throw new StudioCoreError('COMPONENT_INVALID', `受信运行验证未通过：${receipt.status}。`)
    }
    return this.#mutate(
      rootPath,
      { expectedRevision: options.expectedRevision ?? current.project.revision },
      (project) => ({
        ...project,
        components: project.components.map((candidate) =>
          candidate.id === componentId
            ? {
                ...candidate,
                descriptor: {
                  ...candidate.descriptor,
                  compatibility: {
                    ...candidate.descriptor.compatibility,
                    validation: 'runtime-verified' as const,
                    detail: '精确白名单 Adapter 已在全新受信 Runtime 子进程通过最小运行验证。',
                  },
                  evidence: [
                    ...candidate.descriptor.evidence.filter(
                      ({ kind, supersededAt }) => kind !== 'runtime-check' || Boolean(supersededAt),
                    ),
                    {
                      kind: 'runtime-check' as const,
                      status: 'passed' as const,
                      method: 'trusted-runtime-validation-v1' as const,
                      detail: '白名单、Cordis 启动、Adapter Contract、取消和清理检查已通过。',
                      recordedAt: receipt.finishedAt,
                      receiptId: receipt.id,
                      artifact: receipt.artifact,
                    },
                  ],
                },
                updatedAt: receipt.finishedAt,
                auditTrail: [
                  ...(candidate.auditTrail ?? []),
                  {
                    id: receipt.id,
                    action: 'runtime-validated' as const,
                    actor: 'system' as const,
                    summary: '受信最小运行验证通过，已保存脱敏 Receipt 与 Artifact 哈希。',
                    recordedAt: receipt.finishedAt,
                  },
                ],
              }
            : candidate,
        ),
      }),
    )
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
      if (!component.archivedAt) {
        throw new StudioCoreError('COMPONENT_IN_USE', '永久删除只允许已归档组件。', {
          suggestedActions: [
            {
              command: `studio component archive ${componentId}`,
              description: '先归档并复核引用。',
            },
          ],
        })
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
    const assessments = components.map((component) =>
      assessComponentCompatibility({
        componentId: component.id,
        descriptor: component.descriptor,
        checkedAt,
      }),
    )
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
      const assessment = assessments.find(({ componentId }) => componentId === component.id)!
      if (assessment.status === 'incompatible') {
        issues.push({
          severity: 'error',
          code: 'COMPONENT_BLOCKED',
          message: `${component.descriptor.name} 不兼容：${assessment.blockers.join('；')}`,
          componentId: component.id,
          capability: null,
          suggestedActions: validationAction('COMPONENT_BLOCKED'),
        })
      } else if (assessment.status === 'unchecked') {
        issues.push({
          severity: 'error',
          code: 'COMPATIBILITY_UNKNOWN',
          message: `${component.descriptor.name} 未完成兼容性检查：${assessment.blockers.join('；')}`,
          componentId: component.id,
          capability: null,
          suggestedActions: validationAction('COMPATIBILITY_UNKNOWN'),
        })
      } else if (assessment.status === 'adapter-required') {
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
          message: `${component.descriptor.name} 需要 Adapter/Fork 契约与受信最小运行验证。`,
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
      assessments,
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
