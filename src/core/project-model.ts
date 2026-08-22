import { createHash } from 'node:crypto'
import { z } from 'zod'
import { compatibilityRemediationTasksSchema } from '../shared/remediation'
import { compatibilityAssessmentSchema } from '../shared/compatibility-assessment'
import { executionModeSchema } from '../shared/agent'
import {
  capabilityIdSchema,
  componentAuditEntrySchema,
  componentDescriptorSchema,
} from '../shared/component'

export const PROJECT_FILE_NAME = '.agent-stack' as const
export const PROJECT_FORMAT_VERSION = 2 as const
export const PROJECT_SCHEMA_ID = 'https://agentstack.studio/schemas/project-v2.json' as const
export const LEGACY_PROJECT_SCHEMA_ID = 'https://agentstack.studio/schemas/project-v1.json' as const

export const evidenceLevelSchema = z.enum([
  'declared',
  'detected',
  'user-confirmed',
  'contract-tested',
  'runtime-verified',
])

export const gitSnapshotSchema = z
  .object({
    remote: z.string().max(2_000).nullable(),
    commit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    status: z.enum(['clean', 'modified', 'untracked', 'unavailable']),
  })
  .strict()

export const componentSourceSnapshotSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    manifestPath: z.string().min(1).max(4_096).nullable(),
    readmePath: z.string().min(1).max(4_096).nullable(),
    licensePath: z.string().min(1).max(4_096).nullable(),
    git: gitSnapshotSchema,
    files: z.array(z.string().min(1).max(4_096)).max(400),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    inspectedAt: z.iso.datetime(),
  })
  .strict()

export const projectComponentSchema = z
  .object({
    id: z.uuid(),
    descriptor: componentDescriptorSchema,
    evidenceLevel: evidenceLevelSchema,
    source: componentSourceSnapshotSchema,
    archivedAt: z.iso.datetime().nullable(),
    importedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    auditTrail: z.array(componentAuditEntrySchema).max(500).optional(),
  })
  .strict()

export const projectStackSchema = z
  .object({
    executionMode: executionModeSchema,
    componentIds: z.array(z.uuid()),
    capabilityOwners: z.array(
      z.object({ capability: capabilityIdSchema, componentId: z.uuid() }).strict(),
    ),
  })
  .strict()
  .superRefine((stack, context) => {
    if (new Set(stack.componentIds).size !== stack.componentIds.length) {
      context.addIssue({ code: 'custom', path: ['componentIds'], message: 'Stack 组件不能重复。' })
    }
    const capabilities = new Set<string>()
    for (const owner of stack.capabilityOwners) {
      if (capabilities.has(owner.capability)) {
        context.addIssue({
          code: 'custom',
          path: ['capabilityOwners'],
          message: '同一能力只能有一个 Owner。',
        })
      }
      capabilities.add(owner.capability)
    }
  })

const workflowNodeBaseSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
})

export const workflowNodeSchema = z.discriminatedUnion('kind', [
  workflowNodeBaseSchema
    .extend({ kind: z.literal('operation'), operation: z.string().trim().min(1).max(160) })
    .strict(),
  workflowNodeBaseSchema.extend({ kind: z.literal('component'), componentId: z.uuid() }).strict(),
  workflowNodeBaseSchema
    .extend({ kind: z.literal('agent-version'), agentVersionId: z.uuid() })
    .strict(),
  workflowNodeBaseSchema
    .extend({
      kind: z.literal('workflow-version'),
      workflowId: z.uuid(),
      workflowVersionId: z.uuid(),
    })
    .strict(),
])

export const workflowEdgeSchema = z.object({ id: z.uuid(), from: z.uuid(), to: z.uuid() }).strict()

function refineWorkflowGraph(
  graph: {
    nodes: Array<z.infer<typeof workflowNodeSchema>>
    edges: Array<z.infer<typeof workflowEdgeSchema>>
  },
  context: z.RefinementCtx,
): void {
  const nodeIds = new Set(graph.nodes.map(({ id }) => id))
  if (nodeIds.size !== graph.nodes.length) {
    context.addIssue({ code: 'custom', path: ['nodes'], message: 'Workflow 节点 ID 不能重复。' })
  }
  const edgeIds = new Set<string>()
  const connections = new Set<string>()
  const outgoing = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      context.addIssue({ code: 'custom', path: ['edges'], message: 'Workflow 边 ID 不能重复。' })
    }
    edgeIds.add(edge.id)
    const connection = `${edge.from}:${edge.to}`
    if (connections.has(connection)) {
      context.addIssue({ code: 'custom', path: ['edges'], message: 'Workflow 边不能重复。' })
    }
    connections.add(connection)
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      context.addIssue({
        code: 'custom',
        path: ['edges'],
        message: `Workflow 边 ${edge.id} 引用了不存在的节点。`,
      })
      continue
    }
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visiting.add(nodeId)
    for (const target of outgoing.get(nodeId) ?? []) {
      if (visit(target)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }
  if ([...nodeIds].some(visit)) {
    context.addIssue({ code: 'custom', path: ['edges'], message: 'Workflow DAG 检测到直接循环。' })
  }
}

export const workflowVersionSnapshotSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500),
    nodes: z.array(workflowNodeSchema),
    edges: z.array(workflowEdgeSchema),
  })
  .strict()
  .superRefine(refineWorkflowGraph)

export const workflowVersionSchema = z
  .object({
    id: z.uuid(),
    versionNumber: z.number().int().positive(),
    sourceRevision: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    snapshot: workflowVersionSnapshotSchema,
    createdAt: z.iso.datetime(),
  })
  .strict()

export const projectWorkflowSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500),
    revision: z.number().int().nonnegative(),
    nodes: z.array(workflowNodeSchema),
    edges: z.array(workflowEdgeSchema),
    versions: z.array(workflowVersionSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((workflow, context) => {
    refineWorkflowGraph(workflow, context)
    const versionIds = new Set(workflow.versions.map(({ id }) => id))
    const versionNumbers = new Set(workflow.versions.map(({ versionNumber }) => versionNumber))
    if (versionIds.size !== workflow.versions.length) {
      context.addIssue({
        code: 'custom',
        path: ['versions'],
        message: 'Workflow Version ID 不能重复。',
      })
    }
    if (versionNumbers.size !== workflow.versions.length) {
      context.addIssue({
        code: 'custom',
        path: ['versions'],
        message: 'Workflow Version 序号不能重复。',
      })
    }
  })

export const projectVersionSnapshotSchema = z
  .object({
    project: z.object({ id: z.uuid(), name: z.string().min(1).max(100) }).strict(),
    stack: projectStackSchema,
    components: z.array(projectComponentSchema),
    workflows: z.array(projectWorkflowSchema).optional(),
  })
  .strict()

export const projectVersionSchema = z
  .object({
    id: z.uuid(),
    versionNumber: z.number().int().positive(),
    sourceRevision: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    snapshot: projectVersionSnapshotSchema,
    createdAt: z.iso.datetime(),
  })
  .strict()

export const studioProjectSchema = z
  .object({
    $schema: z.literal(PROJECT_SCHEMA_ID),
    formatVersion: z.literal(PROJECT_FORMAT_VERSION),
    id: z.uuid(),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500),
    revision: z.number().int().nonnegative(),
    components: z.array(projectComponentSchema),
    stack: projectStackSchema,
    workflows: z.array(projectWorkflowSchema),
    versions: z.array(projectVersionSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((project, context) => {
    const ids = new Set(project.components.map(({ id }) => id))
    if (ids.size !== project.components.length) {
      context.addIssue({ code: 'custom', path: ['components'], message: '组件 ID 不能重复。' })
    }
    for (const componentId of project.stack.componentIds) {
      if (!ids.has(componentId)) {
        context.addIssue({
          code: 'custom',
          path: ['stack', 'componentIds'],
          message: `Stack 引用了不存在的组件 ${componentId}。`,
        })
      }
    }
    for (const owner of project.stack.capabilityOwners) {
      if (!project.stack.componentIds.includes(owner.componentId)) {
        context.addIssue({
          code: 'custom',
          path: ['stack', 'capabilityOwners'],
          message: `Owner ${owner.componentId} 不在当前 Stack 中。`,
        })
      }
    }
    const versionNumbers = project.versions.map(({ versionNumber }) => versionNumber)
    if (new Set(versionNumbers).size !== versionNumbers.length) {
      context.addIssue({ code: 'custom', path: ['versions'], message: '版本号不能重复。' })
    }
    const workflowIds = new Set(project.workflows.map(({ id }) => id))
    if (workflowIds.size !== project.workflows.length) {
      context.addIssue({ code: 'custom', path: ['workflows'], message: 'Workflow ID 不能重复。' })
    }
    const workflowVersions = new Map<string, z.infer<typeof workflowVersionSchema>>()
    const workflowByVersion = new Map<string, string>()
    for (const workflow of project.workflows) {
      for (const version of workflow.versions) {
        if (workflowVersions.has(version.id)) {
          context.addIssue({
            code: 'custom',
            path: ['workflows'],
            message: `Workflow Version ID ${version.id} 在项目中重复。`,
          })
        }
        workflowVersions.set(version.id, version)
        workflowByVersion.set(version.id, workflow.id)
      }
    }
    const references = new Map<string, string[]>()
    for (const workflow of project.workflows) {
      const graphs = [workflow, ...workflow.versions.map(({ snapshot }) => snapshot)]
      for (const graph of graphs) {
        for (const node of graph.nodes) {
          if (node.kind === 'component' && !ids.has(node.componentId)) {
            context.addIssue({
              code: 'custom',
              path: ['workflows'],
              message: `Workflow“${workflow.name}”引用了不存在的 Component ${node.componentId}。`,
            })
          }
          if (
            node.kind === 'workflow-version' &&
            (workflowByVersion.get(node.workflowVersionId) !== node.workflowId ||
              !workflowVersions.has(node.workflowVersionId))
          ) {
            context.addIssue({
              code: 'custom',
              path: ['workflows'],
              message: `Workflow“${workflow.name}”引用了不存在或不匹配的子 Workflow Version ${node.workflowVersionId}。`,
            })
          }
        }
      }
      for (const version of workflow.versions) {
        const targets = version.snapshot.nodes.flatMap((node) =>
          node.kind === 'workflow-version' ? [node.workflowVersionId] : [],
        )
        references.set(version.id, targets)
        for (const target of targets) {
          const targetVersion = workflowVersions.get(target)
          const targetWorkflowId = workflowByVersion.get(target)
          const node = version.snapshot.nodes.find(
            (candidate) =>
              candidate.kind === 'workflow-version' && candidate.workflowVersionId === target,
          )
          if (
            !targetVersion ||
            !targetWorkflowId ||
            node?.kind !== 'workflow-version' ||
            targetWorkflowId !== node.workflowId
          ) {
            context.addIssue({
              code: 'custom',
              path: ['workflows'],
              message: `Workflow Version ${version.id} 引用了不存在或不匹配的子 Workflow Version ${target}。`,
            })
          }
        }
      }
    }
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (versionId: string): boolean => {
      if (visiting.has(versionId)) return true
      if (visited.has(versionId)) return false
      visiting.add(versionId)
      for (const target of references.get(versionId) ?? []) {
        if (visit(target)) return true
      }
      visiting.delete(versionId)
      visited.add(versionId)
      return false
    }
    if ([...references.keys()].some(visit)) {
      context.addIssue({
        code: 'custom',
        path: ['workflows'],
        message: 'Workflow Version 引用检测到直接或间接循环。',
      })
    }
  })

export const studioProjectV1Schema = studioProjectSchema
  .omit({ workflows: true, $schema: true, formatVersion: true })
  .extend({
    $schema: z.literal(LEGACY_PROJECT_SCHEMA_ID),
    formatVersion: z.literal(1),
  })
  .strict()

export const validationIssueSchema = z
  .object({
    severity: z.enum(['error', 'warning']),
    code: z.enum([
      'EMPTY_STACK',
      'COMPONENT_MISSING',
      'COMPONENT_ARCHIVED',
      'OWNER_REQUIRED',
      'OWNER_INVALID',
      'UNSATISFIED_REQUIREMENT',
      'COMPONENT_BLOCKED',
      'COMPATIBILITY_UNKNOWN',
      'ADAPTER_UNVERIFIED',
      'UNCONTROLLED_SIDE_EFFECT',
      'SOURCE_DIRTY',
      'SOURCE_UNAVAILABLE',
    ]),
    message: z.string().min(1),
    componentId: z.uuid().nullable(),
    capability: capabilityIdSchema.nullable(),
    suggestedActions: z.array(z.string().min(1)),
  })
  .strict()

export const projectValidationSchema = z
  .object({
    status: z.enum(['ready', 'blocked']),
    revision: z.number().int().nonnegative(),
    issues: z.array(validationIssueSchema),
    assessments: z.array(compatibilityAssessmentSchema).optional(),
    remediationTasks: compatibilityRemediationTasksSchema,
    runtimePlanHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    checkedAt: z.iso.datetime(),
  })
  .strict()

export type EvidenceLevel = z.infer<typeof evidenceLevelSchema>
export type ComponentSourceSnapshot = z.infer<typeof componentSourceSnapshotSchema>
export type ProjectComponent = z.infer<typeof projectComponentSchema>
export type ProjectStack = z.infer<typeof projectStackSchema>
export type WorkflowNode = z.infer<typeof workflowNodeSchema>
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>
export type WorkflowVersion = z.infer<typeof workflowVersionSchema>
export type ProjectWorkflow = z.infer<typeof projectWorkflowSchema>
export type ProjectVersion = z.infer<typeof projectVersionSchema>
export type StudioProject = z.infer<typeof studioProjectSchema>
export type ProjectValidation = z.infer<typeof projectValidationSchema>

export function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
