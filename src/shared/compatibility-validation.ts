import { z } from 'zod'

export const trustedCompatibilityValidationRequestSchema = z
  .object({
    requestId: z.uuid(),
    componentId: z.uuid(),
    contractId: z.string().trim().min(1).max(160),
    componentVersion: z.string().trim().min(1).max(80),
    adapterRef: z.string().trim().min(1).max(2_000),
  })
  .strict()

export const trustedCompatibilityValidationReceiptSchema = z
  .object({
    id: z.uuid(),
    componentId: z.uuid(),
    adapterRef: z.string().trim().min(1).max(2_000),
    status: z.enum(['succeeded', 'failed', 'cancelled', 'timed-out']),
    method: z.literal('trusted-runtime-validation-v1'),
    checks: z.array(
      z
        .object({
          name: z.enum(['whitelist', 'kernel-start', 'adapter-contract', 'cancel', 'cleanup']),
          status: z.enum(['passed', 'failed', 'not-run']),
        })
        .strict(),
    ),
    artifact: z
      .object({
        name: z.literal('compatibility-validation.json'),
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
  })
  .strict()

export const compatibilityValidationParentMessageSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('validate'), request: trustedCompatibilityValidationRequestSchema })
    .strict(),
  z.object({ type: z.literal('cancel'), requestId: z.uuid() }).strict(),
  z.object({ type: z.literal('shutdown') }).strict(),
])

export const compatibilityValidationChildMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z
    .object({ type: z.literal('completed'), receipt: trustedCompatibilityValidationReceiptSchema })
    .strict(),
  z
    .object({
      type: z.literal('failed'),
      requestId: z.uuid(),
      message: z.string().trim().min(1).max(500),
    })
    .strict(),
])

export type TrustedCompatibilityValidationRequest = z.infer<
  typeof trustedCompatibilityValidationRequestSchema
>
export type TrustedCompatibilityValidationReceipt = z.infer<
  typeof trustedCompatibilityValidationReceiptSchema
>
