import { z } from 'zod'
import { agentSchema, executionModeSchema } from './agent'
import { capabilityIdSchema } from './component'

export const stackDraftSchema = z.object({
  agentId: z.uuid(),
  executionMode: executionModeSchema,
  revision: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
})

export const agentVersionSnapshotSchema = z.object({
  agent: agentSchema.pick({
    id: true,
    name: true,
    description: true,
    executionMode: true,
  }),
  stack: stackDraftSchema.pick({ executionMode: true, revision: true }).extend({
    components: z
      .array(
        z.object({
          componentId: z.uuid(),
          contractId: z.string().min(1),
          version: z.string().min(1),
        }),
      )
      .default([]),
    capabilityOwners: z
      .array(z.object({ capability: capabilityIdSchema, componentId: z.uuid() }))
      .default([]),
  }),
})

export const agentVersionSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  versionNumber: z.number().int().positive(),
  snapshot: agentVersionSnapshotSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
})

export const agentLocationSchema = z.object({
  workspacePath: z.string().min(1),
  sourceKind: z.enum(['blank', 'local-import']),
  sourcePath: z.string().min(1).nullable(),
})

export const agentDetailSchema = z.object({
  agent: agentSchema,
  draft: stackDraftSchema,
  versions: z.array(agentVersionSchema),
  location: agentLocationSchema.nullable(),
})

export type AgentDetail = z.infer<typeof agentDetailSchema>
export type AgentLocation = z.infer<typeof agentLocationSchema>
export type AgentVersion = z.infer<typeof agentVersionSchema>
export type StackDraft = z.infer<typeof stackDraftSchema>
