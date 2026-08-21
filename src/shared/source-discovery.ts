import { z } from 'zod'

export const sourceProviderSchema = z.literal('github')
export const discoverySortSchema = z.enum(['relevance', 'stars', 'forks', 'updated'])
export const discoveryOrderSchema = z.enum(['desc', 'asc'])

export const sourceSearchInputSchema = z
  .object({
    provider: sourceProviderSchema,
    query: z.string().trim().min(2).max(256),
    sort: discoverySortSchema,
    order: discoveryOrderSchema,
    page: z.number().int().min(1).max(10),
    perPage: z.number().int().min(1).max(50),
  })
  .strict()

export const sourceLocatorInputSchema = z
  .object({
    provider: sourceProviderSchema,
    locator: z.string().trim().min(3).max(512),
  })
  .strict()

export const sourceHandoffInputSchema = sourceLocatorInputSchema.extend({
  destination: z.string().trim().min(1).max(1024).optional(),
})

export const sourceRateLimitSchema = z
  .object({
    limit: z.number().int().nonnegative().nullable(),
    remaining: z.number().int().nonnegative().nullable(),
    resetAt: z.iso.datetime().nullable(),
    resource: z.string().nullable(),
  })
  .strict()

export const discoveredRepositorySchema = z
  .object({
    provider: sourceProviderSchema,
    sourceId: z.string().min(1),
    owner: z.string().min(1),
    name: z.string().min(1),
    fullName: z.string().min(3),
    description: z.string().nullable(),
    htmlUrl: z.url().refine((value) => new URL(value).hostname === 'github.com'),
    cloneUrl: z.url().refine((value) => new URL(value).hostname === 'github.com'),
    defaultBranch: z.string().min(1),
    licenseSpdx: z.string().nullable(),
    language: z.string().nullable(),
    topics: z.array(z.string()),
    stars: z.number().int().nonnegative(),
    forks: z.number().int().nonnegative(),
    openIssues: z.number().int().nonnegative(),
    archived: z.boolean(),
    disabled: z.boolean(),
    fork: z.boolean(),
    pushedAt: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
    metadataLevel: z.literal('provider-reported'),
  })
  .strict()

export const sourceSearchResultSchema = z
  .object({
    provider: sourceProviderSchema,
    query: z.string(),
    totalCount: z.number().int().nonnegative(),
    incompleteResults: z.boolean(),
    items: z.array(discoveredRepositorySchema),
    page: z.number().int().positive(),
    perPage: z.number().int().positive(),
    cacheHit: z.boolean(),
    rateLimit: sourceRateLimitSchema,
  })
  .strict()

export const handoffCommandSchema = z
  .object({
    purpose: z.enum(['clone', 'inspect']),
    executable: z.string().min(1),
    args: z.array(z.string()),
    requiresReview: z.literal(true),
  })
  .strict()

export const sourceHandoffSchema = z
  .object({
    formatVersion: z.literal(1),
    provider: sourceProviderSchema,
    repository: discoveredRepositorySchema,
    destination: z.string().min(1),
    commands: z.array(handoffCommandSchema).length(2),
    safetyNotice: z.string().min(1),
    createdAt: z.iso.datetime(),
  })
  .strict()

export const sourceCancelResultSchema = z.object({ cancelled: z.boolean() }).strict()
export const sourceClipboardInputSchema = z.object({ text: z.string().min(1).max(20_000) }).strict()
export const sourceOpenUrlInputSchema = z
  .object({
    url: z
      .url()
      .refine((value) => new URL(value).protocol === 'https:')
      .refine((value) => ['github.com', 'www.github.com'].includes(new URL(value).hostname)),
  })
  .strict()
export const sourceActionResultSchema = z.object({ ok: z.literal(true) }).strict()

export type SourceProvider = z.infer<typeof sourceProviderSchema>
export type SourceSearchInput = z.infer<typeof sourceSearchInputSchema>
export type SourceLocatorInput = z.infer<typeof sourceLocatorInputSchema>
export type SourceHandoffInput = z.infer<typeof sourceHandoffInputSchema>
export type DiscoveredRepository = z.infer<typeof discoveredRepositorySchema>
export type SourceSearchResult = z.infer<typeof sourceSearchResultSchema>
export type SourceHandoff = z.infer<typeof sourceHandoffSchema>
export type SourceRateLimit = z.infer<typeof sourceRateLimitSchema>
