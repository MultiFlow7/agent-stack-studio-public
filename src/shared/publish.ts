import { z } from 'zod'
import { executionModeSchema } from './agent'
import { capabilityIdSchema } from './component'

export const localContractTestTargetId = 'studio://publishers/multica-contract-test' as const
export const unconfiguredMulticaTargetId = 'studio://publishers/multica' as const

export const publishTargetSchema = z
  .object({
    id: z.enum([localContractTestTargetId, unconfiguredMulticaTargetId]),
    connector: z.literal('multica'),
    transport: z.enum(['contract-test', 'unconfigured']),
    label: z.string().min(1),
    description: z.string().min(1),
    availability: z.enum(['ready', 'decision-required']),
    externalSideEffect: z.boolean(),
  })
  .strict()

export const publishPackageSchema = z
  .object({
    packageVersion: z.literal(1),
    source: z
      .object({
        studioVersion: z.literal('0.1.0'),
        localAgentId: z.uuid(),
        agentVersionId: z.uuid(),
        agentVersionNumber: z.number().int().positive(),
        agentVersionHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    agent: z
      .object({
        name: z.string().min(1).max(80),
        description: z.string().max(500),
        executionMode: executionModeSchema,
      })
      .strict(),
    stack: z
      .object({
        revision: z.number().int().positive(),
        components: z.array(
          z
            .object({
              contractId: z.string().min(1),
              version: z.string().min(1),
              capabilities: z.array(capabilityIdSchema),
              runtimeRequired: z.boolean(),
            })
            .strict(),
        ),
        capabilityOwners: z.array(
          z.object({ capability: capabilityIdSchema, contractId: z.string().min(1) }).strict(),
        ),
      })
      .strict(),
    environmentDeclarations: z.array(
      z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]*$/), required: z.boolean() }).strict(),
    ),
    requirements: z
      .object({
        platforms: z.array(z.enum(['darwin-arm64', 'darwin-x64'])).min(1),
        cordisVersion: z.literal('4.0.0-rc.8'),
        network: z.literal('denied'),
      })
      .strict(),
    excludedContent: z
      .array(
        z.enum(['local-paths', 'keychain-secrets', 'experiment-data', 'run-logs', 'artifacts']),
      )
      .length(5),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const publishValidationIssueSchema = z
  .object({
    field: z.string().min(1),
    severity: z.enum(['blocking', 'warning']),
    code: z.enum([
      'TARGET_UNAVAILABLE',
      'VERSION_NOT_VERIFIED',
      'STACK_DRIFT',
      'EMPTY_STACK',
      'UNSUPPORTED_COMPONENT',
      'SENSITIVE_CONTENT',
      'LOCAL_TEST_ONLY',
    ]),
    message: z.string().min(1),
  })
  .strict()

export const publishValidationSchema = z
  .object({
    status: z.enum(['ready', 'blocked']),
    issues: z.array(publishValidationIssueSchema),
    checkedAt: z.iso.datetime(),
  })
  .strict()

export const publishReceiptSchema = z
  .object({
    id: z.uuid(),
    targetId: publishTargetSchema.shape.id,
    agentId: z.uuid(),
    agentVersionId: z.uuid(),
    packageHash: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
    attempt: z.number().int().positive(),
    status: z.enum(['pending', 'succeeded', 'failed']),
    remoteAgentId: z.string().min(1).nullable(),
    remoteVersionId: z.string().min(1).nullable(),
    response: z
      .object({
        message: z.string().min(1),
        publishedFields: z.array(z.string()),
        testOnly: z.boolean(),
      })
      .strict()
      .nullable(),
    failure: z
      .object({ code: z.string().min(1), message: z.string().min(1), retryable: z.boolean() })
      .strict()
      .nullable(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict()

export const publishMappingSchema = z
  .object({
    targetId: publishTargetSchema.shape.id,
    agentId: z.uuid(),
    remoteAgentId: z.string().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()

export const publishPreviewSchema = z
  .object({
    target: publishTargetSchema,
    package: publishPackageSchema,
    validation: publishValidationSchema,
    priorReceipt: publishReceiptSchema.nullable(),
  })
  .strict()

export const publishHistorySchema = z
  .object({
    mapping: publishMappingSchema.nullable(),
    receipts: z.array(publishReceiptSchema),
  })
  .strict()

export const publishResultSchema = z
  .object({ receipt: publishReceiptSchema, reused: z.boolean() })
  .strict()

export const publishTargetsSchema = z.array(publishTargetSchema)
export const publishPreviewInputSchema = z
  .object({ targetId: publishTargetSchema.shape.id, agentId: z.uuid(), agentVersionId: z.uuid() })
  .strict()
export const publishExecuteInputSchema = publishPreviewInputSchema.extend({
  confirmed: z.literal(true),
})
export const publishHistoryInputSchema = z
  .object({ targetId: publishTargetSchema.shape.id, agentId: z.uuid() })
  .strict()

export type PublishTarget = z.infer<typeof publishTargetSchema>
export type PublishPackage = z.infer<typeof publishPackageSchema>
export type PublishValidation = z.infer<typeof publishValidationSchema>
export type PublishReceipt = z.infer<typeof publishReceiptSchema>
export type PublishMapping = z.infer<typeof publishMappingSchema>
export type PublishPreview = z.infer<typeof publishPreviewSchema>
export type PublishHistory = z.infer<typeof publishHistorySchema>
export type PublishResult = z.infer<typeof publishResultSchema>
export type PublishPreviewInput = z.infer<typeof publishPreviewInputSchema>
export type PublishExecuteInput = z.infer<typeof publishExecuteInputSchema>
