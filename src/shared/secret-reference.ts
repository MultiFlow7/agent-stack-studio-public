import { z } from 'zod'

export const secretReferenceSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  label: z.string().trim().min(1).max(80),
  keychainService: z.string().min(1),
  keychainAccount: z.string().min(1),
  createdAt: z.iso.datetime(),
})

export const configureAgentSecretInputSchema = z
  .object({
    agentId: z.uuid(),
    label: z.string().trim().min(1).max(80),
    keychainAccount: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[^\0\r\n]+$/),
  })
  .strict()

export const deleteAgentSecretInputSchema = z.object({
  referenceId: z.uuid(),
})

export const secretReferenceStatusSchema = secretReferenceSchema.extend({
  configured: z.boolean(),
})

export const secretReferenceStatusListSchema = z.array(secretReferenceStatusSchema)

export const configureAgentSecretResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('configured'), reference: secretReferenceStatusSchema }),
])

export const deleteAgentSecretResultSchema = z.object({
  referenceId: z.uuid(),
  deleted: z.boolean(),
})

export type SecretReference = z.infer<typeof secretReferenceSchema>
export type ConfigureAgentSecretInput = z.infer<typeof configureAgentSecretInputSchema>
export type ConfigureAgentSecretResult = z.infer<typeof configureAgentSecretResultSchema>
export type DeleteAgentSecretInput = z.infer<typeof deleteAgentSecretInputSchema>
export type SecretReferenceStatus = z.infer<typeof secretReferenceStatusSchema>
export type DeleteAgentSecretResult = z.infer<typeof deleteAgentSecretResultSchema>
