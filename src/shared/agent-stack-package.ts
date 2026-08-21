import { z } from 'zod'
import { studioProjectSchema } from '../core/project-model'

export const AGENT_STACK_PACKAGE_FORMAT_VERSION = 2 as const
export const AGENT_STACK_PACKAGE_SCHEMA_ID =
  'https://agentstack.studio/schemas/agent-stack-package-v2.json' as const

export const agentStackPackageExcludedContent = [
  'keychain-secrets',
  'sqlite-local-index',
  'runs-and-experiments',
  'receipts-and-remote-mappings',
  'artifacts-and-logs',
  'absolute-local-paths',
] as const

export const agentStackPackageSchema = z
  .object({
    $schema: z.literal(AGENT_STACK_PACKAGE_SCHEMA_ID),
    packageFormatVersion: z.literal(AGENT_STACK_PACKAGE_FORMAT_VERSION),
    producer: z
      .object({
        name: z.literal('Agent Stack Studio'),
        version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
      })
      .strict(),
    project: studioProjectSchema,
    excludedContent: z.tuple([
      z.literal('keychain-secrets'),
      z.literal('sqlite-local-index'),
      z.literal('runs-and-experiments'),
      z.literal('receipts-and-remote-mappings'),
      z.literal('artifacts-and-logs'),
      z.literal('absolute-local-paths'),
    ]),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()

export const projectExportResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('cancelled'),
    })
    .strict(),
  z
    .object({
      status: z.literal('exported'),
      path: z.string().min(1),
      packageHash: z.string().regex(/^[a-f0-9]{64}$/),
      projectRevision: z.number().int().nonnegative(),
      componentCount: z.number().int().nonnegative(),
      workflowCount: z.number().int().nonnegative(),
      versionCount: z.number().int().nonnegative(),
      excludedContent: z.tuple([
        z.literal('keychain-secrets'),
        z.literal('sqlite-local-index'),
        z.literal('runs-and-experiments'),
        z.literal('receipts-and-remote-mappings'),
        z.literal('artifacts-and-logs'),
        z.literal('absolute-local-paths'),
      ]),
    })
    .strict(),
])

export type AgentStackPackage = z.infer<typeof agentStackPackageSchema>
export type ProjectExportResult = z.infer<typeof projectExportResultSchema>
