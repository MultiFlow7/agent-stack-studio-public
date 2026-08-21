import { z } from 'zod'
import { executionModeSchema } from './agent'
import { driftCheckSchema } from './experiment'
import { runtimePlanSchema } from './runtime-plan'

export const runStatuses = [
  'queued',
  'starting',
  'running',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'timed-out',
] as const

export const runStatusSchema = z.enum(runStatuses)

export const executionDescriptionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('agent-loop'),
      controllerServiceKey: z.string().min(1),
      maxTurns: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('workflow'),
      workflowVersionId: z.uuid().nullable(),
      entryNode: z.string().min(1).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('hybrid'),
      workflowVersionId: z.uuid().nullable(),
      controllerServiceKey: z.string().min(1).nullable(),
      handoff: z.enum(['workflow-to-agent', 'agent-to-workflow']).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('external-harness'),
      harnessComponentId: z.uuid().nullable(),
      trustedExecution: z.boolean(),
    })
    .strict(),
])

export const runManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    runId: z.uuid(),
    agentId: z.uuid(),
    agentVersionId: z.uuid(),
    agentVersionNumber: z.number().int().positive(),
    agentVersionHash: z.string().regex(/^[a-f0-9]{64}$/),
    executionMode: executionModeSchema,
    execution: executionDescriptionSchema,
    runtimePlan: runtimePlanSchema,
    components: z.array(
      z
        .object({
          componentId: z.uuid(),
          contractId: z.string().min(1),
          version: z.string().min(1),
          descriptorHash: z.string().regex(/^[a-f0-9]{64}$/),
          adapterRef: z.string().min(1).nullable(),
        })
        .strict(),
    ),
    input: z
      .object({
        prompt: z.string().trim().min(1).max(1_000),
      })
      .strict(),
    environment: z
      .object({
        platform: z.literal('darwin'),
        architecture: z.enum(['arm64', 'x64']),
        nodeVersion: z.string().min(1),
        electronVersion: z.string().min(1),
        cordisVersion: z.literal('4.0.0-rc.8'),
      })
      .strict(),
    reproducibility: z
      .object({
        randomSeed: z.number().int().nonnegative(),
        timeoutMs: z.number().int().min(500).max(60_000),
        retryLimit: z.literal(0),
        concurrency: z.literal(1),
      })
      .strict(),
    permissions: z
      .object({
        network: z.literal('denied'),
        filesystem: z.literal('artifacts-only'),
      })
      .strict(),
    createdAt: z.iso.datetime(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const runFailureSchema = z
  .object({
    code: z.enum(['PRECHECK_FAILED', 'RUNTIME_FAILED', 'PROCESS_CRASHED', 'TIMEOUT', 'CANCELLED']),
    message: z.string().min(1),
  })
  .strict()

export const runRecordSchema = z
  .object({
    id: z.uuid(),
    agentId: z.uuid(),
    agentVersionId: z.uuid(),
    status: runStatusSchema,
    manifest: runManifestSchema,
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    failure: runFailureSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

const runEventDetailsValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const runEventSchema = z
  .object({
    id: z.uuid(),
    runId: z.uuid(),
    sequence: z.number().int().positive(),
    type: z.enum([
      'queued',
      'process-started',
      'runtime-ready',
      'step-started',
      'step-completed',
      'output',
      'cancel-requested',
      'completed',
      'failed',
      'timed-out',
      'cancelled',
      'artifact-written',
    ]),
    message: z.string().min(1).max(1_000),
    details: z.record(z.string(), runEventDetailsValueSchema),
    createdAt: z.iso.datetime(),
  })
  .strict()

export const runArtifactSchema = z
  .object({
    id: z.uuid(),
    runId: z.uuid(),
    kind: z.enum(['output', 'log', 'metrics']),
    relativePath: z.string().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
  })
  .strict()

export const runDetailSchema = z
  .object({
    run: runRecordSchema,
    events: z.array(runEventSchema),
    artifacts: z.array(runArtifactSchema),
  })
  .strict()

export const runHistorySchema = z
  .object({
    durationMs: z.number().int().nonnegative().nullable(),
    variables: z
      .object({
        prompt: z.string().min(1),
        randomSeed: z.number().int().nonnegative(),
        timeoutMs: z.number().int().positive(),
        retryLimit: z.literal(0),
        concurrency: z.literal(1),
      })
      .strict(),
    experiment: z
      .object({
        id: z.uuid(),
        name: z.string().min(1),
        cellId: z.uuid(),
        promptIndex: z.number().int().nonnegative(),
        repetition: z.number().int().positive(),
        drift: driftCheckSchema,
      })
      .strict()
      .nullable(),
  })
  .strict()

export const runHistoryDetailSchema = runDetailSchema.extend({ history: runHistorySchema }).strict()

export const runListSchema = z.array(runRecordSchema)
export const startRunInputSchema = z
  .object({
    agentId: z.uuid(),
    prompt: z.string().trim().min(1, '请输入样例任务。').max(1_000),
    timeoutMs: z.number().int().min(500).max(60_000),
    randomSeed: z.number().int().nonnegative().max(2_147_483_646).optional(),
  })
  .strict()
export const runIdInputSchema = z.object({ id: z.uuid() }).strict()
export const runListInputSchema = z.object({ agentId: z.uuid().nullable() }).strict()

export const runtimeRunEventSchema = runEventSchema.pick({
  type: true,
  message: true,
  details: true,
})
export const runtimeRunResultSchema = z
  .object({
    summary: z.string().min(1).max(2_000),
    stepsCompleted: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict()

export const runtimeParentMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('execute'), manifest: runManifestSchema }).strict(),
  z.object({ type: z.literal('cancel'), runId: z.uuid() }).strict(),
  z.object({ type: z.literal('shutdown') }).strict(),
])

export const runtimeChildMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('runtime-ready'), cordisVersion: z.literal('4.0.0-rc.8') }).strict(),
  z.object({ type: z.literal('run-event'), event: runtimeRunEventSchema }).strict(),
  z.object({ type: z.literal('run-completed'), result: runtimeRunResultSchema }).strict(),
  z.object({ type: z.literal('run-cancelled'), message: z.string().min(1).max(1_000) }).strict(),
  z.object({ type: z.literal('runtime-error'), message: z.string().min(1).max(1_000) }).strict(),
])

export type ExecutionDescription = z.infer<typeof executionDescriptionSchema>
export type RunManifest = z.infer<typeof runManifestSchema>
export type RunRecord = z.infer<typeof runRecordSchema>
export type RunEvent = z.infer<typeof runEventSchema>
export type RunArtifact = z.infer<typeof runArtifactSchema>
export type RunDetail = z.infer<typeof runDetailSchema>
export type RunHistory = z.infer<typeof runHistorySchema>
export type RunHistoryDetail = z.infer<typeof runHistoryDetailSchema>
export type StartRunInput = z.infer<typeof startRunInputSchema>
export type RuntimeRunEvent = z.infer<typeof runtimeRunEventSchema>
export type RuntimeRunResult = z.infer<typeof runtimeRunResultSchema>
export type RuntimeChildMessage = z.infer<typeof runtimeChildMessageSchema>
