import { z } from 'zod'

export const coreCapabilities = [
  'execution-controller',
  'model-provider',
  'prompt-policy',
  'context-builder',
  'memory',
  'tool-runtime',
  'skill-provider',
  'mcp-client',
  'state-store',
  'sandbox',
  'trace',
  'evaluator',
  'human-gate',
] as const

const customCapabilitySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/, '扩展能力必须使用命名空间。')

export const capabilityIdSchema = z.union([z.enum(coreCapabilities), customCapabilitySchema])
export const replaceabilitySchema = z.enum([
  'built-in',
  'configurable',
  'disableable',
  'replaceable',
  'adapter-required',
  'fork-required',
  'locked',
  'unknown',
])
export const compatibilityLevelSchema = z.enum([
  'native',
  'configuration',
  'adapter',
  'fork',
  'blocked',
  'unknown',
])
export const validationStatusSchema = z.enum([
  'declared',
  'contract-tested',
  'runtime-verified',
  'failed',
])

export const componentPermissionScopeSchema = z.enum([
  'network',
  'filesystem-read',
  'filesystem-write',
  'subprocess',
  'keychain',
])

export const componentPermissionSchema = z
  .object({
    scope: componentPermissionScopeSchema,
    required: z.boolean(),
    reason: z.string().trim().min(1).max(300),
  })
  .strict()

export const componentSecretReferenceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,79}$/, '密钥引用名必须是大写标识符。'),
    purpose: z.string().trim().min(1).max(300),
    required: z.boolean(),
  })
  .strict()

export const componentAuditEntrySchema = z
  .object({
    id: z.uuid(),
    action: z.enum([
      'imported',
      'static-inspected',
      'descriptor-updated',
      'strategy-selected',
      'contract-tested',
      'runtime-validated',
      'archived',
      'restored',
    ]),
    actor: z.enum(['system', 'user']),
    summary: z.string().trim().min(1).max(500),
    recordedAt: z.iso.datetime(),
  })
  .strict()

function safeDescriptorReference(value: string): boolean {
  if (/[\0\r\n]/.test(value)) return false
  if (
    /\b(?:authorization|credential|password|passwd|private[-_]?key|secret|token|api[-_]?key)\s*[:=]\s*\S+/i.test(
      value,
    )
  )
    return false
  try {
    const url = new URL(value)
    if (url.username || url.password) return false
    return ![...url.searchParams.keys()].some((key) =>
      /(?:^|[-_])(?:authorization|credential|password|secret|token|api[-_]?key)(?:$|[-_])/i.test(
        key,
      ),
    )
  } catch {
    return true
  }
}

const descriptorReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine(safeDescriptorReference, '引用不得包含凭证、密钥查询参数或换行符。')

export const componentProviderSchema = z
  .object({
    capability: capabilityIdSchema,
    implementation: z.string().trim().min(1).max(160),
    replaceability: replaceabilitySchema,
    confidence: z.enum(['declared', 'detected', 'user-confirmed', 'verified']),
    activation: z.enum(['owner-only', 'always-active']),
  })
  .strict()

export const componentRequirementSchema = z
  .object({
    capability: capabilityIdSchema,
    version: z.string().trim().min(1).max(80).nullable(),
  })
  .strict()

export const componentDescriptorSchema = z
  .object({
    contractVersion: z.literal(1),
    id: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/, '组件 ID 必须是稳定的命名空间标识。'),
    name: z.string().trim().min(1).max(100),
    version: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    kind: z.enum(['component', 'adapter']),
    source: z
      .object({
        kind: z.enum(['built-in', 'local-package', 'static-import', 'generated-adapter']),
        location: descriptorReferenceSchema,
        license: z.string().trim().min(1).max(120),
      })
      .strict(),
    platforms: z.array(z.enum(['darwin-arm64', 'darwin-x64'])).min(1),
    provides: z.array(componentProviderSchema).min(1),
    requires: z.array(componentRequirementSchema),
    configSchema: descriptorReferenceSchema.nullable(),
    runtimeAdapter: descriptorReferenceSchema.nullable(),
    permissions: z.array(componentPermissionSchema).max(20).optional(),
    secretReferences: z.array(componentSecretReferenceSchema).max(20).optional(),
    compatibility: z
      .object({
        level: compatibilityLevelSchema,
        validation: validationStatusSchema,
        detail: z.string().trim().min(1).max(500),
        strategyRationale: z.string().trim().min(1).max(500).optional(),
        strategySelectedAt: z.iso.datetime().optional(),
      })
      .strict(),
    evidence: z.array(
      z
        .object({
          kind: z.enum([
            'manifest',
            'static-check',
            'contract-test',
            'runtime-check',
            'user-confirmation',
          ]),
          detail: z.string().trim().min(1).max(500),
          status: z.enum(['passed', 'failed', 'human-decision']).optional(),
          method: z
            .enum([
              'safe-static-inspection-v2',
              'descriptor-contract-test-v1',
              'trusted-runtime-validation-v1',
              'legacy-user-confirmation',
            ])
            .optional(),
          recordedAt: z.iso.datetime().optional(),
          supersededAt: z.iso.datetime().optional(),
          artifact: z
            .object({
              name: z.string().trim().min(1).max(120),
              contentHash: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict()
            .optional(),
          receiptId: z.uuid().optional(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((descriptor, context) => {
    const capabilities = new Set<string>()
    for (const provider of descriptor.provides) {
      if (capabilities.has(provider.capability)) {
        context.addIssue({
          code: 'custom',
          path: ['provides'],
          message: '一个组件不能重复声明同一能力。',
        })
      }
      capabilities.add(provider.capability)
    }
    if (descriptor.kind === 'adapter' && !descriptor.runtimeAdapter) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeAdapter'],
        message: 'Adapter 必须声明 Runtime Adapter 引用。',
      })
    }
    const permissionScopes = descriptor.permissions?.map(({ scope }) => scope) ?? []
    if (new Set(permissionScopes).size !== permissionScopes.length) {
      context.addIssue({
        code: 'custom',
        path: ['permissions'],
        message: '每个权限范围只能声明一次。',
      })
    }
    const secretNames = descriptor.secretReferences?.map(({ name }) => name) ?? []
    if (new Set(secretNames).size !== secretNames.length) {
      context.addIssue({
        code: 'custom',
        path: ['secretReferences'],
        message: '每个密钥引用名只能声明一次。',
      })
    }
  })

export const componentRecordSchema = z
  .object({
    id: z.uuid(),
    descriptor: componentDescriptorSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    archivedAt: z.iso.datetime().nullable().optional(),
  })
  .strict()

export const componentListSchema = z.array(componentRecordSchema)
export const addStackComponentInputSchema = z
  .object({ agentId: z.uuid(), componentId: z.uuid() })
  .strict()
export const removeStackComponentInputSchema = addStackComponentInputSchema
export const selectCapabilityOwnerInputSchema = addStackComponentInputSchema
  .extend({ capability: capabilityIdSchema })
  .strict()

export type CapabilityId = z.infer<typeof capabilityIdSchema>
export type ComponentDescriptor = z.infer<typeof componentDescriptorSchema>
export type ComponentRecord = z.infer<typeof componentRecordSchema>
export type AddStackComponentInput = z.infer<typeof addStackComponentInputSchema>
export type RemoveStackComponentInput = z.infer<typeof removeStackComponentInputSchema>
export type SelectCapabilityOwnerInput = z.infer<typeof selectCapabilityOwnerInputSchema>
