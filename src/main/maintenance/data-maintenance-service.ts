import { createHash, randomUUID } from 'node:crypto'
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  backupManifestSchema,
  maintenanceStatusSchema,
  restorePreviewSchema,
  type BackupManifest,
  type CreateBackupResult,
  type DataLocation,
  type DataLocationId,
  type MaintenanceStatus,
  type RestorePreview,
} from '../../shared/maintenance'
import { AppError } from '../../shared/errors'
import { CURRENT_SCHEMA_VERSION } from '../persistence/migrations'

const BACKUP_DATABASE_NAME = 'studio.sqlite3'
const BACKUP_MANIFEST_NAME = 'backup-manifest.json'
const APPLICATION_ID = 'studio.agentstack.desktop'

interface DataMaintenancePaths {
  userData: string
  database: string
  workspaces: string
  artifacts: string
}

interface DataMaintenanceOptions {
  paths: DataMaintenancePaths
  applicationVersion: string
  packaged: boolean
  now?: () => Date
}

interface FileEntry {
  relativePath: string
  sha256: string
  sizeBytes: number
}

interface CopySummary {
  excludedSymbolicLinks: number
}

interface InspectedBackup {
  sourcePath: string
  manifest: BackupManifest
  preview: Omit<RestorePreview, 'selectionId'>
}

interface RestoreMarker {
  restoredAt: string
  backupName: string
  sourceSchemaVersion: number
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function sha256File(filePath: string): Promise<string> {
  const contents = await readFile(filePath)
  return createHash('sha256').update(contents).digest('hex')
}

function portableRelativePath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

async function copyDataTree(source: string, destination: string): Promise<CopySummary> {
  await mkdir(destination, { recursive: true })
  if (!(await exists(source))) return { excludedSymbolicLinks: 0 }

  let excludedSymbolicLinks = 0
  const visit = async (sourceDirectory: string, destinationDirectory: string): Promise<void> => {
    const entries = await readdir(sourceDirectory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const sourcePath = path.join(sourceDirectory, entry.name)
      const destinationPath = path.join(destinationDirectory, entry.name)
      const entryStats = await lstat(sourcePath)
      if (entryStats.isSymbolicLink()) {
        excludedSymbolicLinks += 1
        continue
      }
      if (entryStats.isDirectory()) {
        await mkdir(destinationPath, { recursive: true })
        await visit(sourcePath, destinationPath)
        continue
      }
      if (entryStats.isFile()) await copyFile(sourcePath, destinationPath)
    }
  }

  await visit(source, destination)
  return { excludedSymbolicLinks }
}

async function copyVerifiedTree(source: string, destination: string): Promise<void> {
  const visit = async (sourceDirectory: string, destinationDirectory: string): Promise<void> => {
    await mkdir(destinationDirectory, { recursive: true })
    const entries = await readdir(sourceDirectory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const sourcePath = path.join(sourceDirectory, entry.name)
      const destinationPath = path.join(destinationDirectory, entry.name)
      const entryStats = await lstat(sourcePath)
      if (entryStats.isSymbolicLink()) {
        throw new AppError('VALIDATION_FAILED', '备份包包含不允许的符号链接。')
      }
      if (entryStats.isDirectory()) await visit(sourcePath, destinationPath)
      else if (entryStats.isFile()) await copyFile(sourcePath, destinationPath)
    }
  }
  await visit(source, destination)
}

async function collectFileEntries(root: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  if (!(await exists(root))) return entries

  const visit = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true })
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const childPath = path.join(directory, child.name)
      const childStats = await lstat(childPath)
      if (childStats.isSymbolicLink()) {
        throw new AppError('VALIDATION_FAILED', '备份包包含不允许的符号链接。')
      }
      if (childStats.isDirectory()) {
        await visit(childPath)
        continue
      }
      if (!childStats.isFile()) continue
      entries.push({
        relativePath: portableRelativePath(path.relative(root, childPath)),
        sha256: await sha256File(childPath),
        sizeBytes: childStats.size,
      })
    }
  }

  await visit(root)
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function inspectOpenDatabase(database: Database.Database): number {
  const integrity = database.pragma('integrity_check', { simple: true })
  if (integrity !== 'ok') {
    throw new AppError('VALIDATION_FAILED', '备份中的 SQLite 完整性检查未通过。')
  }
  const foreignKeyErrors = database.pragma('foreign_key_check') as unknown[]
  if (foreignKeyErrors.length > 0) {
    throw new AppError('VALIDATION_FAILED', '备份中的 SQLite 外键检查未通过。')
  }
  const row = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null
  }
  if (!row.version) throw new AppError('VALIDATION_FAILED', '备份缺少数据库版本记录。')
  return row.version
}

function inspectDatabase(databasePath: string): number {
  let database: Database.Database | undefined
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true })
    return inspectOpenDatabase(database)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('VALIDATION_FAILED', '无法读取备份中的 SQLite 数据库。', {
      cause: error,
    })
  } finally {
    database?.close()
  }
}

export class DataMaintenanceService {
  readonly #paths: DataMaintenancePaths
  readonly #applicationVersion: string
  readonly #packaged: boolean
  readonly #now: () => Date
  readonly #pendingRestorePath: string
  readonly #lastRestorePath: string
  readonly #recoveryPath: string
  readonly #logsPath: string

  constructor(options: DataMaintenanceOptions) {
    this.#paths = options.paths
    this.#applicationVersion = options.applicationVersion
    this.#packaged = options.packaged
    this.#now = options.now ?? (() => new Date())
    this.#pendingRestorePath = path.join(options.paths.userData, 'pending-restore')
    this.#lastRestorePath = path.join(options.paths.userData, 'last-restore.json')
    this.#recoveryPath = path.join(options.paths.userData, 'recovery')
    this.#logsPath = path.join(options.paths.userData, 'logs')
  }

  #dataLocations(): DataLocation[] {
    return [
      {
        id: 'application-support',
        label: 'Application Support',
        path: this.#paths.userData,
        kind: 'directory',
        purpose: '本机索引、运行记录与可恢复工作数据的根目录',
        includedInBackup: false,
      },
      {
        id: 'database',
        label: 'SQLite',
        path: this.#paths.database,
        kind: 'file',
        purpose: '本机索引、Run、Experiment、Receipt 和 Artifact 引用',
        includedInBackup: true,
      },
      {
        id: 'workspaces',
        label: 'Workspaces',
        path: this.#paths.workspaces,
        kind: 'directory',
        purpose: 'Agent 的本地可写工作空间',
        includedInBackup: true,
      },
      {
        id: 'artifacts',
        label: 'Artifacts',
        path: this.#paths.artifacts,
        kind: 'directory',
        purpose: '本地 Run 产物与 Receipt 附件',
        includedInBackup: true,
      },
      {
        id: 'recovery',
        label: 'Recovery',
        path: this.#recoveryPath,
        kind: 'directory',
        purpose: '恢复前自动回滚备份',
        includedInBackup: false,
      },
      {
        id: 'logs',
        label: 'Logs',
        path: this.#logsPath,
        kind: 'directory',
        purpose: '本地诊断日志，不得写入密钥原文',
        includedInBackup: false,
      },
    ]
  }

  async prepareDataLocation(id: DataLocationId): Promise<DataLocation> {
    const location = this.#dataLocations().find((candidate) => candidate.id === id)
    if (!location) throw new AppError('NOT_FOUND', '本地数据位置不存在。')
    if (location.kind === 'directory') await mkdir(location.path, { recursive: true })
    else await access(location.path)
    return location
  }

  async status(): Promise<MaintenanceStatus> {
    const databaseSchemaVersion = inspectDatabase(this.#paths.database)
    let lastRestoreAt: string | null = null
    if (await exists(this.#lastRestorePath)) {
      try {
        const marker = JSON.parse(await readFile(this.#lastRestorePath, 'utf8')) as RestoreMarker
        lastRestoreAt = marker.restoredAt
      } catch {
        lastRestoreAt = null
      }
    }
    return maintenanceStatusSchema.parse({
      applicationVersion: this.#applicationVersion,
      databaseSchemaVersion,
      supportedDatabaseSchemaVersion: CURRENT_SCHEMA_VERSION,
      pendingRestore: await exists(this.#pendingRestorePath),
      lastRestoreAt,
      packaged: this.#packaged,
      platform: 'darwin',
      dataLocations: this.#dataLocations(),
    })
  }

  async createBackup(
    destinationParent: string,
  ): Promise<Extract<CreateBackupResult, { status: 'saved' }>> {
    await mkdir(destinationParent, { recursive: true })
    const createdAt = this.#now().toISOString()
    const timestamp = createdAt.replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const backupName = `Agent Stack Studio Backup ${timestamp}`
    const suffix = randomUUID().slice(0, 8)
    const finalPath = path.join(destinationParent, `${backupName} ${suffix}`)
    const stagingPath = path.join(destinationParent, `.studio-backup-${randomUUID()}.tmp`)

    try {
      await mkdir(stagingPath, { recursive: true })
      const snapshotPath = path.join(stagingPath, BACKUP_DATABASE_NAME)
      const sourceDatabase = new Database(this.#paths.database, {
        readonly: true,
        fileMustExist: true,
      })
      try {
        inspectOpenDatabase(sourceDatabase)
        await sourceDatabase.backup(snapshotPath)
      } finally {
        sourceDatabase.close()
      }

      const workspaces = await copyDataTree(
        this.#paths.workspaces,
        path.join(stagingPath, 'workspaces'),
      )
      const artifacts = await copyDataTree(
        this.#paths.artifacts,
        path.join(stagingPath, 'artifacts'),
      )
      const snapshotDatabase = new Database(snapshotPath)
      let databaseSchemaVersion: number
      try {
        databaseSchemaVersion = inspectOpenDatabase(snapshotDatabase)
        snapshotDatabase.pragma('journal_mode = DELETE')
      } finally {
        snapshotDatabase.close()
      }
      await rm(`${snapshotPath}-wal`, { force: true })
      await rm(`${snapshotPath}-shm`, { force: true })
      const databaseStats = await stat(snapshotPath)
      const files = await collectFileEntries(stagingPath)
      const dataFiles = files.filter(({ relativePath }) => relativePath !== BACKUP_DATABASE_NAME)
      const excludedSymbolicLinks =
        workspaces.excludedSymbolicLinks + artifacts.excludedSymbolicLinks
      const manifest = backupManifestSchema.parse({
        formatVersion: 1,
        applicationId: APPLICATION_ID,
        applicationVersion: this.#applicationVersion,
        createdAt,
        database: {
          schemaVersion: databaseSchemaVersion,
          sha256: await sha256File(snapshotPath),
          sizeBytes: databaseStats.size,
        },
        files: dataFiles,
        excluded: ['keychain-secret-values', 'logs', 'symbolic-links'],
        excludedSymbolicLinks,
      })
      await writeFile(
        path.join(stagingPath, BACKUP_MANIFEST_NAME),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      )
      await rename(stagingPath, finalPath)

      return {
        status: 'saved',
        backupName: path.basename(finalPath),
        createdAt,
        databaseSchemaVersion,
        fileCount: dataFiles.length + 1,
        sizeBytes:
          databaseStats.size + dataFiles.reduce((total, entry) => total + entry.sizeBytes, 0),
        excludedSymbolicLinks,
      }
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true })
      if (error instanceof AppError) throw error
      throw new AppError('PERSISTENCE_FAILED', '无法创建完整的本地备份。', { cause: error })
    }
  }

  async inspectBackup(sourcePath: string): Promise<InspectedBackup> {
    try {
      const manifest = backupManifestSchema.parse(
        JSON.parse(await readFile(path.join(sourcePath, BACKUP_MANIFEST_NAME), 'utf8')),
      )
      const databasePath = path.join(sourcePath, BACKUP_DATABASE_NAME)
      const databaseSchemaVersion = inspectDatabase(databasePath)
      if (databaseSchemaVersion !== manifest.database.schemaVersion) {
        throw new AppError('VALIDATION_FAILED', '备份清单与 SQLite 版本不一致。')
      }
      if (databaseSchemaVersion > CURRENT_SCHEMA_VERSION) {
        throw new AppError(
          'VALIDATION_FAILED',
          `备份数据库版本 ${databaseSchemaVersion} 高于当前应用支持的版本 ${CURRENT_SCHEMA_VERSION}。`,
        )
      }
      const databaseStats = await stat(databasePath)
      if (
        databaseStats.size !== manifest.database.sizeBytes ||
        (await sha256File(databasePath)) !== manifest.database.sha256
      ) {
        throw new AppError('VALIDATION_FAILED', '备份中的 SQLite 文件已变更或损坏。')
      }
      const actualFiles = (await collectFileEntries(sourcePath)).filter(
        ({ relativePath }) =>
          relativePath !== BACKUP_DATABASE_NAME && relativePath !== BACKUP_MANIFEST_NAME,
      )
      if (JSON.stringify(actualFiles) !== JSON.stringify(manifest.files)) {
        throw new AppError('VALIDATION_FAILED', '备份中的工作空间或产物文件已变更。')
      }
      const sizeBytes =
        databaseStats.size + actualFiles.reduce((total, entry) => total + entry.sizeBytes, 0)
      return {
        sourcePath,
        manifest,
        preview: restorePreviewSchema.omit({ selectionId: true }).parse({
          backupName: path.basename(sourcePath),
          createdAt: manifest.createdAt,
          sourceApplicationVersion: manifest.applicationVersion,
          sourceDatabaseSchemaVersion: databaseSchemaVersion,
          targetDatabaseSchemaVersion: CURRENT_SCHEMA_VERSION,
          migrationRequired: databaseSchemaVersion < CURRENT_SCHEMA_VERSION,
          fileCount: actualFiles.length + 1,
          sizeBytes,
          excludedSymbolicLinks: manifest.excludedSymbolicLinks,
        }),
      }
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('VALIDATION_FAILED', '所选文件夹不是可用的 Agent Stack Studio 备份。', {
        cause: error,
      })
    }
  }

  async stageRestore(sourcePath: string): Promise<InspectedBackup> {
    const inspected = await this.inspectBackup(sourcePath)
    const stagingPath = path.join(this.#paths.userData, `.pending-restore-${randomUUID()}`)
    try {
      await copyVerifiedTree(sourcePath, stagingPath)
      await this.inspectBackup(stagingPath)
      await rm(this.#pendingRestorePath, { recursive: true, force: true })
      await rename(stagingPath, this.#pendingRestorePath)
      return inspected
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true })
      throw error
    }
  }

  async applyPendingRestore(): Promise<RestoreMarker | null> {
    if (!(await exists(this.#pendingRestorePath))) return null
    const inspected = await this.inspectBackup(this.#pendingRestorePath)
    await mkdir(this.#recoveryPath, { recursive: true })
    await this.createBackup(this.#recoveryPath)

    const stagingPath = path.join(this.#paths.userData, `.restore-staging-${randomUUID()}`)
    const rollbackPath = path.join(this.#paths.userData, `.restore-rollback-${randomUUID()}`)
    const targets = [
      [path.join(this.#pendingRestorePath, BACKUP_DATABASE_NAME), this.#paths.database],
      [path.join(this.#pendingRestorePath, 'workspaces'), this.#paths.workspaces],
      [path.join(this.#pendingRestorePath, 'artifacts'), this.#paths.artifacts],
    ] as const
    let swapStarted = false

    try {
      await mkdir(stagingPath, { recursive: true })
      await mkdir(rollbackPath, { recursive: true })
      for (const [source, target] of targets) {
        const staged = path.join(stagingPath, path.basename(target))
        const sourceStats = await lstat(source)
        if (sourceStats.isDirectory()) await copyVerifiedTree(source, staged)
        else await copyFile(source, staged)
      }

      swapStarted = true
      for (const [, target] of targets) {
        if (await exists(target))
          await rename(target, path.join(rollbackPath, path.basename(target)))
      }
      await rm(`${this.#paths.database}-wal`, { force: true })
      await rm(`${this.#paths.database}-shm`, { force: true })
      for (const [, target] of targets) {
        await rename(path.join(stagingPath, path.basename(target)), target)
      }
    } catch (error) {
      if (swapStarted) {
        for (const [, target] of targets) {
          await rm(target, { recursive: true, force: true })
          const rollbackTarget = path.join(rollbackPath, path.basename(target))
          if (await exists(rollbackTarget)) await rename(rollbackTarget, target)
        }
      }
      throw new AppError('PERSISTENCE_FAILED', '恢复本地数据失败，原数据已回滚。', { cause: error })
    } finally {
      await rm(stagingPath, { recursive: true, force: true })
      await rm(rollbackPath, { recursive: true, force: true })
    }

    const marker: RestoreMarker = {
      restoredAt: this.#now().toISOString(),
      backupName: inspected.preview.backupName,
      sourceSchemaVersion: inspected.manifest.database.schemaVersion,
    }
    await writeFile(this.#lastRestorePath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
    await rm(this.#pendingRestorePath, { recursive: true, force: true })
    return marker
  }
}
