import { z } from 'zod'
import { harnessProbeSchema } from './native-agent'
import {
  agentModelReadinessSchema,
  harnessModelCapabilitySchema,
  modelConfigurationSchema,
} from './model-auth'

export const modelAuthEmptyInputSchema = z.object({}).strict()

export const modelAuthSelectInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    modelConfiguration: modelConfigurationSchema,
  })
  .strict()

export const modelAuthVerifyInputSchema = z
  .object({
    requestId: z.uuid(),
    costAcknowledged: z.literal(true),
    timeoutMs: z.number().int().min(1_000).max(300_000).default(120_000),
  })
  .strict()

export const modelAuthCancelInputSchema = z.object({ requestId: z.uuid() }).strict()
export const modelAuthCancelResultSchema = z.object({ cancelled: z.boolean() }).strict()

export const modelAuthViewSchema = z
  .object({
    harness: z
      .object({ id: z.enum(['pi', 'openclaw', 'codex']), label: z.string().min(1).max(120) })
      .strict()
      .nullable(),
    capability: harnessModelCapabilitySchema.nullable(),
    probe: harnessProbeSchema.nullable(),
    selection: modelConfigurationSchema.nullable(),
    readiness: agentModelReadinessSchema,
  })
  .strict()

export const modelAuthActionResultSchema = z
  .object({
    status: z.enum(['completed', 'cancelled', 'launched']),
    view: modelAuthViewSchema,
  })
  .strict()

export type ModelAuthSelectInput = z.infer<typeof modelAuthSelectInputSchema>
export type ModelAuthVerifyInput = z.infer<typeof modelAuthVerifyInputSchema>
export type ModelAuthView = z.infer<typeof modelAuthViewSchema>
export type ModelAuthActionResult = z.infer<typeof modelAuthActionResultSchema>
