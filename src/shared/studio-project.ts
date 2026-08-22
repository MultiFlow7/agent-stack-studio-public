import { z } from 'zod'
import { executionModeSchema } from './agent'
import { componentDescriptorSchema, capabilityIdSchema } from './component'
import { projectValidationSchema, studioProjectSchema } from '../core/project-model'
import { projectIntegrityReportSchema } from '../core/project-integrity'

export const studioProjectStateSchema = z
  .object({
    projectPath: z.string().min(1).nullable(),
    localAgentId: z.uuid().nullable().default(null),
    project: studioProjectSchema.nullable(),
    validation: projectValidationSchema.nullable(),
    integrity: projectIntegrityReportSchema.nullable().default(null),
    recovered: z.boolean().default(false),
    changedExternally: z.boolean(),
    cliPath: z.string().min(1),
  })
  .strict()

export const projectMutationInputSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict()
export const projectMetadataInputSchema = projectMutationInputSchema
  .extend({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500),
    executionMode: executionModeSchema,
  })
  .strict()
export const projectComponentInputSchema = projectMutationInputSchema.extend({
  componentId: z.uuid(),
})
export const projectOwnerInputSchema = projectComponentInputSchema.extend({
  capability: capabilityIdSchema,
})
export const projectDescriptorInputSchema = projectComponentInputSchema.extend({
  descriptor: componentDescriptorSchema,
})
export const emptyProjectInputSchema = z.object({}).strict()

export const projectWorkflowCreateInputSchema = projectMutationInputSchema
  .extend({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).default(''),
  })
  .strict()

const workflowNodeInputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('operation'),
      name: z.string().trim().min(1).max(100),
      operation: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      kind: z.literal('component'),
      name: z.string().trim().min(1).max(100),
      componentId: z.uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('agent-version'),
      name: z.string().trim().min(1).max(100),
      agentVersionId: z.uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('workflow-version'),
      name: z.string().trim().min(1).max(100),
      workflowId: z.uuid(),
      workflowVersionId: z.uuid(),
    })
    .strict(),
])

export const projectWorkflowNodeAddInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    workflowId: z.uuid(),
    node: workflowNodeInputSchema,
  })
  .strict()
export const projectWorkflowNodeRemoveInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    workflowId: z.uuid(),
    nodeId: z.uuid(),
  })
  .strict()
export const projectWorkflowEdgeAddInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    workflowId: z.uuid(),
    from: z.uuid(),
    to: z.uuid(),
  })
  .strict()
export const projectWorkflowEdgeRemoveInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    workflowId: z.uuid(),
    edgeId: z.uuid(),
  })
  .strict()
export const projectWorkflowFreezeInputSchema = z
  .object({ expectedRevision: z.number().int().nonnegative(), workflowId: z.uuid() })
  .strict()

export type StudioProjectState = z.infer<typeof studioProjectStateSchema>
export type ProjectMetadataInput = z.infer<typeof projectMetadataInputSchema>
export type ProjectComponentInput = z.infer<typeof projectComponentInputSchema>
export type ProjectOwnerInput = z.infer<typeof projectOwnerInputSchema>
export type ProjectDescriptorInput = z.infer<typeof projectDescriptorInputSchema>
export type ProjectWorkflowCreateInput = z.infer<typeof projectWorkflowCreateInputSchema>
export type ProjectWorkflowNodeAddInput = z.infer<typeof projectWorkflowNodeAddInputSchema>
export type ProjectWorkflowNodeRemoveInput = z.infer<typeof projectWorkflowNodeRemoveInputSchema>
export type ProjectWorkflowEdgeAddInput = z.infer<typeof projectWorkflowEdgeAddInputSchema>
export type ProjectWorkflowEdgeRemoveInput = z.infer<typeof projectWorkflowEdgeRemoveInputSchema>
export type ProjectWorkflowFreezeInput = z.infer<typeof projectWorkflowFreezeInputSchema>
