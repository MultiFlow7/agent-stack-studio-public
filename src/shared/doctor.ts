import { z } from 'zod'
import { harnessProbeSchema } from './native-agent'

export const doctorCheckSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    category: z.enum(['application', 'data', 'project', 'harness', 'publish']),
    status: z.enum(['pass', 'warning', 'blocking']),
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(1_000),
    remediation: z.string().min(1).max(1_000).nullable(),
    facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .strict()

export const doctorProjectFactSchema = z
  .object({
    status: z.enum(['healthy', 'missing', 'failed']),
    name: z.string().min(1).max(200).nullable(),
    revision: z.number().int().nonnegative().nullable(),
    formatVersion: z.number().int().positive().nullable(),
    versionsChecked: z.number().int().nonnegative(),
    message: z.string().min(1).max(1_000),
  })
  .strict()

export const doctorDataFactSchema = z
  .object({
    databaseSchemaVersion: z.number().int().positive(),
    supportedDatabaseSchemaVersion: z.number().int().positive(),
    pendingRestore: z.boolean(),
    lastRestoreAt: z.iso.datetime().nullable(),
  })
  .strict()

export const doctorMulticaFactSchema = z
  .object({
    status: z.enum(['ready', 'not-installed', 'authentication-required', 'unavailable']),
    runtimeCount: z.number().int().nonnegative(),
    onlineRuntimeCount: z.number().int().nonnegative(),
    message: z.string().min(1).max(1_000),
  })
  .strict()

export const studioDoctorFactsSchema = z
  .object({
    application: z
      .object({
        version: z.string().min(1),
        platform: z.string().min(1),
        architecture: z.string().min(1),
        packaged: z.boolean(),
        cliExecutable: z.boolean(),
        bundledCliRuntime: z.boolean(),
      })
      .strict(),
    data: doctorDataFactSchema.nullable(),
    project: doctorProjectFactSchema,
    harnesses: z.array(harnessProbeSchema).length(3),
    multica: doctorMulticaFactSchema,
  })
  .strict()

export const studioDoctorReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    checkedAt: z.iso.datetime(),
    status: z.enum(['ready', 'degraded', 'blocked']),
    counts: z
      .object({
        passed: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative(),
        blocking: z.number().int().nonnegative(),
      })
      .strict(),
    checks: z.array(doctorCheckSchema).min(7).max(12),
  })
  .strict()

export const emptyDoctorInputSchema = z.object({}).strict()

export type StudioDoctorFacts = z.infer<typeof studioDoctorFactsSchema>
export type StudioDoctorReport = z.infer<typeof studioDoctorReportSchema>
export type DoctorMulticaFact = z.infer<typeof doctorMulticaFactSchema>
