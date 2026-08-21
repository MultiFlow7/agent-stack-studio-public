import { z } from 'zod'
import { executionModeSchema } from './agent'

export const experimentStatuses = [
  'ready',
  'running',
  'cancelling',
  'completed',
  'completed-with-errors',
  'blocked',
  'cancelled',
] as const

export const experimentStatusSchema = z.enum(experimentStatuses)
export const experimentCellStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'blocked',
])

export const experimentControlSnapshotSchema = z
  .object({
    agentVersion: z
      .object({
        id: z.uuid(),
        versionNumber: z.number().int().positive(),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    stack: z
      .object({
        revision: z.number().int().positive(),
        runtimePlanHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    components: z.array(
      z
        .object({
          componentId: z.uuid(),
          contractId: z.string().min(1),
          version: z.string().min(1),
          descriptorHash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ),
    executionMode: executionModeSchema,
    runtime: z
      .object({
        cordisVersion: z.literal('4.0.0-rc.8'),
        platform: z.literal('darwin'),
        architecture: z.enum(['arm64', 'x64']),
        nodeVersion: z.string().min(1),
        electronVersion: z.string().min(1),
      })
      .strict(),
    permissions: z
      .object({ network: z.literal('denied'), filesystem: z.literal('artifacts-only') })
      .strict(),
    dataset: z
      .object({ id: z.literal('studio://datasets/built-in-prompt-v1'), version: z.literal('1') })
      .strict(),
  })
  .strict()

export const experimentDefinitionSchema = z
  .object({
    definitionVersion: z.literal(1),
    baselinePrompt: z.string().trim().min(1).max(1_000),
    promptVariants: z.array(z.string().trim().min(1).max(1_000)).min(2).max(4),
    randomSeeds: z.array(z.number().int().nonnegative().max(2_147_483_646)).min(1).max(4),
    repetitions: z.number().int().min(1).max(3),
    timeoutMs: z.number().int().min(500).max(60_000),
    controls: experimentControlSnapshotSchema,
    evaluator: z
      .object({
        id: z.literal('studio://evaluators/runtime-duration-v1'),
        direction: z.literal('lower-is-better'),
      })
      .strict(),
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.promptVariants[0] !== definition.baselinePrompt) {
      context.addIssue({
        code: 'custom',
        path: ['promptVariants', 0],
        message: '矩阵首项必须是基准 Prompt。',
      })
    }
    if (new Set(definition.promptVariants).size !== definition.promptVariants.length) {
      context.addIssue({
        code: 'custom',
        path: ['promptVariants'],
        message: 'Prompt 变量不能重复。',
      })
    }
    if (new Set(definition.randomSeeds).size !== definition.randomSeeds.length) {
      context.addIssue({ code: 'custom', path: ['randomSeeds'], message: '随机种子不能重复。' })
    }
  })

export const driftIssueSchema = z
  .object({
    control: z.enum([
      'agent-version',
      'stack',
      'component',
      'execution-mode',
      'runtime',
      'permissions',
      'dataset',
    ]),
    baseline: z.string(),
    current: z.string(),
    message: z.string().min(1),
  })
  .strict()

export const driftCheckSchema = z
  .object({
    status: z.enum(['clean', 'blocked']),
    issues: z.array(driftIssueSchema),
    checkedAt: z.iso.datetime(),
  })
  .strict()

export const experimentRecordSchema = z
  .object({
    id: z.uuid(),
    agentId: z.uuid(),
    name: z.string().trim().min(1).max(80),
    researchQuestion: z.string().trim().min(1).max(500),
    status: experimentStatusSchema,
    definition: experimentDefinitionSchema,
    drift: driftCheckSchema,
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

export const experimentCellSchema = z
  .object({
    id: z.uuid(),
    experimentId: z.uuid(),
    promptIndex: z.number().int().nonnegative(),
    promptValue: z.string().min(1),
    randomSeed: z.number().int().nonnegative(),
    repetition: z.number().int().positive(),
    status: experimentCellStatusSchema,
    runId: z.uuid().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    failureMessage: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

export const experimentComparisonSchema = z
  .object({
    promptIndex: z.number().int().nonnegative(),
    promptValue: z.string().min(1),
    randomSeed: z.number().int().nonnegative(),
    totalRuns: z.number().int().positive(),
    succeededRuns: z.number().int().nonnegative(),
    successRate: z.number().min(0).max(1),
    averageDurationMs: z.number().int().nonnegative().nullable(),
    deltaFromBaselineMs: z.number().int().nullable(),
  })
  .strict()

export const experimentDetailSchema = z
  .object({
    experiment: experimentRecordSchema,
    cells: z.array(experimentCellSchema),
    comparison: z.array(experimentComparisonSchema),
  })
  .strict()

export const experimentListSchema = z.array(experimentRecordSchema)
export const createExperimentInputSchema = z
  .object({
    agentId: z.uuid(),
    name: z.string().trim().min(1, '请输入实验名称。').max(80),
    researchQuestion: z.string().trim().min(1, '请输入研究问题。').max(500),
    baselinePrompt: z.string().trim().min(1).max(1_000),
    promptVariants: z.array(z.string().trim().min(1).max(1_000)).min(1).max(3),
    randomSeeds: z.array(z.number().int().nonnegative().max(2_147_483_646)).min(1).max(4),
    repetitions: z.number().int().min(1).max(3),
    timeoutMs: z.number().int().min(500).max(60_000),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.promptVariants).size !== input.promptVariants.length) {
      context.addIssue({
        code: 'custom',
        path: ['promptVariants'],
        message: 'Prompt 候选不能重复。',
      })
    }
    if (input.promptVariants.includes(input.baselinePrompt)) {
      context.addIssue({
        code: 'custom',
        path: ['promptVariants'],
        message: '变量候选不能与基准 Prompt 相同。',
      })
    }
    if (new Set(input.randomSeeds).size !== input.randomSeeds.length) {
      context.addIssue({ code: 'custom', path: ['randomSeeds'], message: '随机种子不能重复。' })
    }
  })

export const experimentIdInputSchema = z.object({ id: z.uuid() }).strict()
export const experimentListInputSchema = z.object({ agentId: z.uuid().nullable() }).strict()
export const exportExperimentInputSchema = z
  .object({ id: z.uuid(), format: z.enum(['json', 'csv']) })
  .strict()
export const exportExperimentResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('saved'), fileName: z.string().min(1) }).strict(),
])

export type ExperimentControlSnapshot = z.infer<typeof experimentControlSnapshotSchema>
export type ExperimentDefinition = z.infer<typeof experimentDefinitionSchema>
export type DriftCheck = z.infer<typeof driftCheckSchema>
export type ExperimentRecord = z.infer<typeof experimentRecordSchema>
export type ExperimentCell = z.infer<typeof experimentCellSchema>
export type ExperimentComparison = z.infer<typeof experimentComparisonSchema>
export type ExperimentDetail = z.infer<typeof experimentDetailSchema>
export type CreateExperimentInput = z.infer<typeof createExperimentInputSchema>
export type ExportExperimentResult = z.infer<typeof exportExperimentResultSchema>
