import { z } from 'zod'

export const executionModes = ['agent-loop', 'workflow', 'hybrid', 'external-harness'] as const

export const executionModeSchema = z.enum(executionModes)

export const agentSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500),
  executionMode: executionModeSchema,
  archivedAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const createAgentInputSchema = z.object({
  name: z.string().trim().min(1, '请输入 Agent 名称。').max(80),
  description: z.string().trim().max(500),
  executionMode: executionModeSchema,
})

export const updateAgentInputSchema = createAgentInputSchema.extend({
  id: z.uuid(),
})

export const agentListInputSchema = z
  .object({
    scope: z.enum(['active', 'archived']).default('active'),
  })
  .strict()
  .default({ scope: 'active' })

export const agentIdInputSchema = z.object({ id: z.uuid() }).strict()

export const duplicateAgentInputSchema = agentIdInputSchema.extend({
  name: z.string().trim().min(1).max(80).optional(),
})

export const agentLifecycleResultSchema = z.object({
  agent: agentSchema,
  message: z.string().min(1),
})

export const deleteAgentResultSchema = z.object({
  id: z.uuid(),
  deleted: z.literal(true),
  message: z.string().min(1),
})

export const agentListSchema = z.array(agentSchema)

export type Agent = z.infer<typeof agentSchema>
export type CreateAgentInput = z.infer<typeof createAgentInputSchema>
export type UpdateAgentInput = z.infer<typeof updateAgentInputSchema>
export type ExecutionMode = z.infer<typeof executionModeSchema>
export type AgentListInput = z.infer<typeof agentListInputSchema>
export type DuplicateAgentInput = z.infer<typeof duplicateAgentInputSchema>
export type AgentLifecycleResult = z.infer<typeof agentLifecycleResultSchema>
export type DeleteAgentResult = z.infer<typeof deleteAgentResultSchema>
