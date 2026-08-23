import { z } from 'zod'

export const harnessIds = ['pi', 'openclaw', 'codex'] as const
export const harnessIdSchema = z.enum(harnessIds)

export const harnessProbeSchema = z
  .object({
    id: harnessIdSchema,
    label: z.string().min(1),
    executable: z.string().min(1),
    status: z.enum(['ready', 'not-installed', 'unsupported-version', 'authentication-required']),
    version: z.string().nullable(),
    requiredVersion: z.string().min(1),
    capabilities: z
      .object({
        prompt: z.enum(['native', 'adapted', 'unavailable']),
        skills: z.enum(['native', 'adapted', 'unavailable']),
        memory: z.enum(['native', 'adapted', 'unavailable']),
        mcp: z.enum(['native', 'adapted', 'unavailable']),
        sessions: z.enum(['native', 'adapted', 'unavailable']),
      })
      .strict(),
    detail: z.string().min(1).max(1_000),
  })
  .strict()

export const nativeAgentUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
  })
  .strict()

export const nativeAgentModelLayerSchema = z
  .object({
    kind: z.enum(['harness-provider', 'codex-simulation']),
    provider: z.string().min(1).max(120),
    model: z.string().min(1).max(200).nullable(),
  })
  .strict()

export const nativeAgentResultSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['chat', 'run']),
    projectId: z.uuid(),
    projectRevision: z.number().int().nonnegative(),
    projectHash: z.string().regex(/^[a-f0-9]{64}$/),
    harness: harnessIdSchema,
    harnessVersion: z.string().min(1),
    sessionId: z.uuid(),
    status: z.enum(['succeeded', 'failed', 'cancelled', 'timed-out']),
    responseMarkdown: z.string().max(200_000),
    usage: nativeAgentUsageSchema,
    modelLayer: nativeAgentModelLayerSchema.optional(),
    degradedFeatures: z.array(z.string().min(1).max(500)).max(20),
    failure: z
      .object({ code: z.string().min(1).max(80), message: z.string().min(1).max(1_000) })
      .strict()
      .nullable(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
  })
  .strict()

export const nativeAgentExecuteInputSchema = z
  .object({
    projectPath: z.string().min(1).max(4_096),
    kind: z.enum(['chat', 'run']),
    message: z.string().trim().min(1).max(40_000),
    requestId: z.uuid().optional(),
    sessionId: z.uuid().optional(),
    timeoutMs: z.number().int().min(1_000).max(900_000),
    idempotencyKey: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{1,160}$/)
      .optional(),
  })
  .strict()

export const nativeAgentListInputSchema = z
  .object({ projectPath: z.string().min(1).max(4_096), kind: z.enum(['chat', 'run']).nullable() })
  .strict()

export const nativeAgentResultListSchema = z.array(nativeAgentResultSchema)
export const nativeAgentCancelInputSchema = z.object({ requestId: z.uuid() }).strict()
export const nativeAgentUiExecuteInputSchema = nativeAgentExecuteInputSchema.omit({
  projectPath: true,
})
export const nativeAgentUiListInputSchema = z
  .object({ kind: z.enum(['chat', 'run']).nullable() })
  .strict()
export const harnessProbeListSchema = z.array(harnessProbeSchema)
export const nativeAgentCancelResultSchema = z.object({ cancelled: z.boolean() }).strict()

export type HarnessId = z.infer<typeof harnessIdSchema>
export type HarnessProbe = z.infer<typeof harnessProbeSchema>
export type NativeAgentResult = z.infer<typeof nativeAgentResultSchema>
export type NativeAgentExecuteInput = z.infer<typeof nativeAgentExecuteInputSchema>
export type NativeAgentUiExecuteInput = z.infer<typeof nativeAgentUiExecuteInputSchema>
export type NativeAgentUiListInput = z.infer<typeof nativeAgentUiListInputSchema>
