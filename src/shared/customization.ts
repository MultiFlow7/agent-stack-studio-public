import { z } from 'zod'
import { harnessIdSchema } from './native-agent'

export const customizationSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('github'), repository: z.string().min(3).max(200) }).strict(),
  z.object({ kind: z.literal('local'), path: z.string().min(1).max(2_000) }).strict(),
])

export const installRecipeSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
    title: z.string().min(1).max(120),
    kind: z.literal('skill-markdown'),
    repository: z.string().min(3).max(200),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    artifactPath: z.string().min(1).max(500),
    artifactUrl: z.url(),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    license: z.string().min(1).max(80),
    licensePath: z.string().min(1).max(500),
    licenseUrl: z.url(),
    licenseSha256: z.string().regex(/^[a-f0-9]{64}$/),
    platforms: z.array(z.enum(['darwin-arm64', 'darwin-x64'])).min(1),
    skillId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    skillName: z.string().min(1).max(100),
    supportedHarnesses: z.array(harnessIdSchema).min(1),
    harnessSupport: z
      .array(
        z
          .object({
            harnessId: harnessIdSchema,
            level: z.enum(['native', 'adapted', 'degraded', 'unavailable']),
            detail: z.string().min(1).max(500),
          })
          .strict(),
      )
      .min(1),
    capabilities: z.array(z.enum(['skill-provider', 'prompt-policy'])).min(1),
    executionPolicy: z.literal('content-only'),
    contentCompleteness: z.enum(['complete', 'instructions-only']),
    limitations: z.array(z.string().min(1).max(500)).max(10),
    verification: z
      .object({
        status: z.literal('content-verified'),
        verifiedAt: z.iso.date(),
        method: z.literal('pinned-sha256-content-smoke-v1'),
        detail: z.string().min(1).max(500),
      })
      .strict(),
  })
  .strict()

export const customizationRecognitionInputSchema = z
  .object({ source: z.string().trim().min(1).max(2_000), harnessId: harnessIdSchema })
  .strict()

export const customizationEvidenceSchema = z
  .object({
    kind: z.enum(['locator', 'git-remote', 'artifact-hash', 'manifest']),
    detail: z.string(),
  })
  .strict()

export const customizationRecognitionSchema = z
  .object({
    status: z.enum(['known', 'unknown']),
    source: customizationSourceSchema,
    harnessId: harnessIdSchema,
    recipe: installRecipeSchema.nullable(),
    availableRecipes: z.array(installRecipeSchema),
    evidence: z.array(customizationEvidenceSchema),
    safetyNotice: z.string().min(1),
  })
  .strict()

export const customizationTaskInputSchema = customizationRecognitionInputSchema.extend({
  projectPath: z.string().trim().min(1).max(2_000).optional(),
  goal: z.string().trim().min(1).max(1_000).optional(),
})

export const customizationTaskSchema = z
  .object({
    formatVersion: z.literal(1),
    fileName: z.string().regex(/^[a-z0-9-]+\.md$/),
    markdown: z.string().min(500).max(40_000),
    recognition: customizationRecognitionSchema,
    createdAt: z.iso.datetime(),
  })
  .strict()

export const customizationInstallInputSchema = z
  .object({
    projectPath: z.string().trim().min(1).max(2_000),
    recipeId: installRecipeSchema.shape.id,
    harnessId: harnessIdSchema,
    localSourcePath: z.string().trim().min(1).max(2_000).optional(),
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
    operation: z.enum(['install', 'update']).optional(),
  })
  .strict()

export const customizationUiInstallInputSchema = customizationInstallInputSchema.omit({
  projectPath: true,
})

export const customizationCancelResultSchema = z.object({ cancelled: z.boolean() }).strict()

export const customizationInstallResultSchema = z
  .object({
    status: z.enum(['installed', 'reused']),
    operation: z.enum(['install', 'update']),
    recipeId: installRecipeSchema.shape.id,
    projectId: z.uuid(),
    previousRevision: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    snapshotPath: z.string().min(1),
    snapshotId: z.uuid(),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    smokeTest: z.object({ status: z.literal('passed'), detail: z.string().min(1) }).strict(),
    executedThirdPartyCode: z.literal(false),
  })
  .strict()

export const customizationCheckInputSchema = z
  .object({
    projectPath: z.string().trim().min(1).max(2_000),
    harnessId: harnessIdSchema,
  })
  .strict()

export const customizationUiCheckInputSchema = customizationCheckInputSchema.omit({
  projectPath: true,
})

export const customizationRecipeStatusSchema = z
  .object({
    recipe: installRecipeSchema,
    state: z.enum(['not-installed', 'current', 'drifted', 'disabled']),
    installedSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    support: installRecipeSchema.shape.harnessSupport.element,
  })
  .strict()

export const customizationRecipeStatusListSchema = z.array(customizationRecipeStatusSchema)

export const customizationSmokeInputSchema = z
  .object({
    projectPath: z.string().trim().min(1).max(2_000),
    recipeId: installRecipeSchema.shape.id,
    harnessId: harnessIdSchema,
  })
  .strict()

export const customizationUiSmokeInputSchema = customizationSmokeInputSchema.omit({
  projectPath: true,
})

export const customizationSmokeResultSchema = z
  .object({
    status: z.literal('passed'),
    recipeId: installRecipeSchema.shape.id,
    harnessId: harnessIdSchema,
    level: z.enum(['native', 'adapted', 'degraded']),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    detail: z.string().min(1).max(1_000),
    executedThirdPartyCode: z.literal(false),
  })
  .strict()

export const customizationUninstallInputSchema = z
  .object({
    projectPath: z.string().trim().min(1).max(2_000),
    recipeId: installRecipeSchema.shape.id,
    harnessId: harnessIdSchema,
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict()

export const customizationUiUninstallInputSchema = customizationUninstallInputSchema.omit({
  projectPath: true,
})

export const customizationUninstallResultSchema = z
  .object({
    status: z.enum(['uninstalled', 'not-installed']),
    recipeId: installRecipeSchema.shape.id,
    projectId: z.uuid(),
    previousRevision: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    snapshotId: z.uuid().nullable(),
    smokeTest: z.object({ status: z.literal('passed'), detail: z.string().min(1) }).strict(),
    executedThirdPartyCode: z.literal(false),
  })
  .strict()

export const customizationRestoreInputSchema = z
  .object({
    projectPath: z.string().trim().min(1).max(2_000),
    snapshotId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict()

export const customizationUiRestoreInputSchema = customizationRestoreInputSchema.omit({
  projectPath: true,
})

export const customizationRestoreResultSchema = z
  .object({
    status: z.literal('restored'),
    projectId: z.uuid(),
    revision: z.number().int().nonnegative(),
    snapshotId: z.uuid(),
  })
  .strict()

export type InstallRecipe = z.infer<typeof installRecipeSchema>
export type CustomizationRecognitionInput = z.infer<typeof customizationRecognitionInputSchema>
export type CustomizationRecognition = z.infer<typeof customizationRecognitionSchema>
export type CustomizationTaskInput = z.infer<typeof customizationTaskInputSchema>
export type CustomizationTask = z.infer<typeof customizationTaskSchema>
export type CustomizationInstallInput = z.infer<typeof customizationInstallInputSchema>
export type CustomizationInstallResult = z.infer<typeof customizationInstallResultSchema>
export type CustomizationCheckInput = z.infer<typeof customizationCheckInputSchema>
export type CustomizationRecipeStatus = z.infer<typeof customizationRecipeStatusSchema>
export type CustomizationSmokeInput = z.infer<typeof customizationSmokeInputSchema>
export type CustomizationSmokeResult = z.infer<typeof customizationSmokeResultSchema>
export type CustomizationUninstallInput = z.infer<typeof customizationUninstallInputSchema>
export type CustomizationUninstallResult = z.infer<typeof customizationUninstallResultSchema>
export type CustomizationRestoreInput = z.infer<typeof customizationRestoreInputSchema>
export type CustomizationRestoreResult = z.infer<typeof customizationRestoreResultSchema>
