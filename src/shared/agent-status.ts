import { z } from 'zod'
import { agentSchema } from './agent'
import { experimentStatusSchema } from './experiment'
import { publishReceiptSchema, publishTargetSchema } from './publish'
import { runStatusSchema } from './run'

export const agentStatusProjectionSchema = z
  .object({
    agent: agentSchema,
    draftRevision: z.number().int().positive(),
    currentVersion: z
      .object({
        id: z.uuid(),
        versionNumber: z.number().int().positive(),
        createdAt: z.iso.datetime(),
      })
      .strict()
      .nullable(),
    stack: z
      .object({
        status: z.enum(['ready', 'blocked']),
        componentCount: z.number().int().nonnegative(),
        ownerCount: z.number().int().nonnegative(),
        issueCount: z.number().int().nonnegative(),
      })
      .strict(),
    latestRun: z
      .object({
        id: z.uuid(),
        status: runStatusSchema,
        updatedAt: z.iso.datetime(),
      })
      .strict()
      .nullable(),
    latestExperiment: z
      .object({
        id: z.uuid(),
        name: z.string().min(1),
        status: experimentStatusSchema,
        updatedAt: z.iso.datetime(),
      })
      .strict()
      .nullable(),
    latestPublish: z
      .object({
        targetId: publishTargetSchema.shape.id,
        targetLabel: z.string().min(1),
        status: publishReceiptSchema.shape.status,
        occurredAt: z.iso.datetime(),
      })
      .strict()
      .nullable(),
  })
  .strict()

export const agentStatusListSchema = z.array(agentStatusProjectionSchema)

export type AgentStatusProjection = z.infer<typeof agentStatusProjectionSchema>
