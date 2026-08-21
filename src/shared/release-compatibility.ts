import { z } from 'zod'
import manifest from '../../config/release-compatibility.json'

export const releaseCompatibilitySchema = z
  .object({
    contractVersion: z.literal(1),
    application: z
      .object({
        versionSource: z.literal('package.json#version'),
        platform: z.literal('darwin'),
        architectures: z.tuple([z.literal('arm64'), z.literal('x64')]),
        minimumMacOS: z.string().regex(/^\d+\.\d+$/),
        bundleId: z.string().min(1),
      })
      .strict(),
    project: z
      .object({
        currentFormatVersion: z.number().int().positive(),
        minimumReadableFormatVersion: z.number().int().nonnegative(),
        schemaId: z.url(),
        schemaPath: z.string().min(1),
        portableFacts: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    agentStackPackage: z
      .object({
        currentFormatVersion: z.number().int().positive(),
        schemaId: z.url(),
        schemaPath: z.string().min(1),
        contentHash: z.literal('sha256'),
        secretPolicy: z.literal('reject-local-paths-and-exclude-keychain-local-data'),
      })
      .strict(),
    database: z
      .object({
        currentSchemaVersion: z.number().int().positive(),
        responsibility: z.string().min(1),
      })
      .strict(),
    contracts: z
      .object({
        domainModel: z.number().int().positive(),
        ipc: z.number().int().positive(),
        runtimeProtocol: z.number().int().positive(),
        cliEnvelope: z.number().int().positive(),
      })
      .strict(),
    distributionOnlyMutableFields: z.array(z.string().min(1)).min(1),
  })
  .strict()

export const releaseCompatibility = releaseCompatibilitySchema.parse(manifest)
export type ReleaseCompatibility = z.infer<typeof releaseCompatibilitySchema>
