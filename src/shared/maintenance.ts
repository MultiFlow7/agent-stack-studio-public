import { z } from 'zod'

export const backupFileEntrySchema = z
  .object({
    relativePath: z
      .string()
      .min(1)
      .max(4_096)
      .refine(
        (value) =>
          !value.startsWith('/') &&
          !value.includes('\\') &&
          !value.split('/').some((segment) => segment === '..'),
        '备份文件路径必须保持在备份根目录内。',
      ),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict()

export const backupManifestSchema = z
  .object({
    formatVersion: z.literal(1),
    applicationId: z.literal('studio.agentstack.desktop'),
    applicationVersion: z.string().min(1),
    createdAt: z.string().datetime(),
    database: z
      .object({
        schemaVersion: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        sizeBytes: z.number().int().nonnegative(),
      })
      .strict(),
    files: z.array(backupFileEntrySchema).max(100_000),
    excluded: z.array(z.enum(['keychain-secret-values', 'logs', 'symbolic-links'])),
    excludedSymbolicLinks: z.number().int().nonnegative(),
  })
  .strict()

export type BackupManifest = z.infer<typeof backupManifestSchema>

export const dataLocationIdSchema = z.enum([
  'application-support',
  'database',
  'workspaces',
  'artifacts',
  'recovery',
  'logs',
])

export type DataLocationId = z.infer<typeof dataLocationIdSchema>

export const dataLocationSchema = z.object({
  id: dataLocationIdSchema,
  label: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['directory', 'file']),
  purpose: z.string().min(1),
  includedInBackup: z.boolean(),
})

export type DataLocation = z.infer<typeof dataLocationSchema>

export const maintenanceStatusSchema = z.object({
  applicationVersion: z.string().min(1),
  databaseSchemaVersion: z.number().int().positive(),
  supportedDatabaseSchemaVersion: z.number().int().positive(),
  pendingRestore: z.boolean(),
  lastRestoreAt: z.string().datetime().nullable(),
  packaged: z.boolean(),
  platform: z.literal('darwin'),
  dataLocations: z.array(dataLocationSchema).length(6),
})

export type MaintenanceStatus = z.infer<typeof maintenanceStatusSchema>

export const createBackupResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }),
  z.object({
    status: z.literal('saved'),
    backupName: z.string().min(1),
    createdAt: z.string().datetime(),
    databaseSchemaVersion: z.number().int().positive(),
    fileCount: z.number().int().nonnegative(),
    sizeBytes: z.number().int().nonnegative(),
    excludedSymbolicLinks: z.number().int().nonnegative(),
  }),
])

export type CreateBackupResult = z.infer<typeof createBackupResultSchema>

export const restorePreviewSchema = z.object({
  selectionId: z.string().uuid(),
  backupName: z.string().min(1),
  createdAt: z.string().datetime(),
  sourceApplicationVersion: z.string().min(1),
  sourceDatabaseSchemaVersion: z.number().int().positive(),
  targetDatabaseSchemaVersion: z.number().int().positive(),
  migrationRequired: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  excludedSymbolicLinks: z.number().int().nonnegative(),
})

export type RestorePreview = z.infer<typeof restorePreviewSchema>

export const selectRestoreResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('selected'), preview: restorePreviewSchema }),
])

export type SelectRestoreResult = z.infer<typeof selectRestoreResultSchema>

export const applyRestoreInputSchema = z.object({
  selectionId: z.string().uuid(),
  confirmed: z.literal(true),
})

export type ApplyRestoreInput = z.infer<typeof applyRestoreInputSchema>

export const applyRestoreResultSchema = z.object({
  status: z.literal('restarting'),
  backupName: z.string().min(1),
})

export type ApplyRestoreResult = z.infer<typeof applyRestoreResultSchema>

export const revealDataLocationInputSchema = z.object({ id: dataLocationIdSchema }).strict()

export type RevealDataLocationInput = z.infer<typeof revealDataLocationInputSchema>

export const revealDataLocationResultSchema = z.object({
  status: z.literal('revealed'),
  id: dataLocationIdSchema,
})

export type RevealDataLocationResult = z.infer<typeof revealDataLocationResultSchema>

export const emptyMaintenanceInputSchema = z.object({}).strict()
