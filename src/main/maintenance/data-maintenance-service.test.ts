import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentRepository } from '../persistence/agent-repository'
import { CURRENT_SCHEMA_VERSION } from '../persistence/migrations'
import { revealDataLocationInputSchema } from '../../shared/maintenance'
import { DataMaintenanceService } from './data-maintenance-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function createService(userData: string, applicationVersion = '0.2.0'): DataMaintenanceService {
  return new DataMaintenanceService({
    applicationVersion,
    packaged: false,
    paths: {
      userData,
      database: path.join(userData, 'studio.sqlite3'),
      workspaces: path.join(userData, 'workspaces'),
      artifacts: path.join(userData, 'artifacts'),
    },
    now: () => new Date('2026-08-19T12:34:56.000Z'),
  })
}

function createCurrentDatabase(userData: string, name: string): void {
  const repository = new AgentRepository(path.join(userData, 'studio.sqlite3'))
  repository.create({ name, description: '', executionMode: 'agent-loop' })
  repository.close()
}

describe('DataMaintenanceService', () => {
  it('reports stable data boundaries and only accepts allowlisted reveal identifiers', async () => {
    const userData = await temporaryDirectory('studio-data-locations-')
    createCurrentDatabase(userData, '路径合约 Agent')
    const service = createService(userData)

    const status = await service.status()
    expect(status.dataLocations.map(({ id }) => id)).toEqual([
      'application-support',
      'database',
      'workspaces',
      'artifacts',
      'recovery',
      'logs',
    ])
    expect(status.dataLocations.find(({ id }) => id === 'database')).toMatchObject({
      path: path.join(userData, 'studio.sqlite3'),
      kind: 'file',
      includedInBackup: true,
    })
    expect(status.dataLocations.find(({ id }) => id === 'logs')).toMatchObject({
      path: path.join(userData, 'logs'),
      includedInBackup: false,
    })

    await expect(service.prepareDataLocation('recovery')).resolves.toMatchObject({
      path: path.join(userData, 'recovery'),
      kind: 'directory',
    })
    expect(await readdir(userData)).toContain('recovery')
    expect(
      revealDataLocationInputSchema.safeParse({ id: 'recovery', path: '/tmp/attacker-path' })
        .success,
    ).toBe(false)
    expect(revealDataLocationInputSchema.safeParse({ id: '../outside' }).success).toBe(false)
  })

  it('creates a verified backup without logs, Keychain values, or symbolic-link targets', async () => {
    const userData = await temporaryDirectory('studio-backup-source-')
    const destination = await temporaryDirectory('studio-backup-destination-')
    createCurrentDatabase(userData, '备份 Agent')
    await mkdir(path.join(userData, 'workspaces', 'agent-a'), { recursive: true })
    await writeFile(path.join(userData, 'workspaces', 'agent-a', 'manifest.json'), '{"ok":true}')
    await mkdir(path.join(userData, 'artifacts', 'run-a'), { recursive: true })
    await writeFile(path.join(userData, 'artifacts', 'run-a', 'result.txt'), '可验证产物')
    await mkdir(path.join(userData, 'logs'), { recursive: true })
    await writeFile(path.join(userData, 'logs', 'main.log'), 'secret-from-log')
    await symlink(
      path.join(userData, 'logs'),
      path.join(userData, 'workspaces', 'agent-a', 'outside-link'),
    )

    const service = createService(userData)
    const result = await service.createBackup(destination)
    const backupPath = path.join(destination, result.backupName)
    const inspected = await service.inspectBackup(backupPath)

    expect(result).toMatchObject({
      status: 'saved',
      databaseSchemaVersion: CURRENT_SCHEMA_VERSION,
      fileCount: 3,
      excludedSymbolicLinks: 1,
    })
    expect(inspected.manifest.excluded).toEqual([
      'keychain-secret-values',
      'logs',
      'symbolic-links',
    ])
    expect(inspected.preview.migrationRequired).toBe(false)
    expect(await readFile(path.join(backupPath, 'artifacts', 'run-a', 'result.txt'), 'utf8')).toBe(
      '可验证产物',
    )
    expect(await readdir(backupPath)).not.toContain('logs')
    expect(await readdir(path.join(backupPath, 'workspaces', 'agent-a'))).not.toContain(
      'outside-link',
    )
    expect((await stat(backupPath)).mode & 0o777).toBe(0o700)
    expect((await stat(path.join(backupPath, 'studio.sqlite3'))).mode & 0o777).toBe(0o600)
  })

  it('rejects a backup destination inside managed data to prevent recursive copying', async () => {
    const userData = await temporaryDirectory('studio-recursive-backup-')
    createCurrentDatabase(userData, 'Recursive Agent')
    const workspace = path.join(userData, 'workspaces', 'agent-a')
    await mkdir(workspace, { recursive: true })
    const service = createService(userData)

    await expect(service.createBackup(workspace)).rejects.toThrow('递归复制')
    expect((await readdir(workspace)).filter((name) => name.includes('studio-backup'))).toEqual([])
  })

  it('stages and applies a restore while preserving an automatic rollback backup', async () => {
    const userData = await temporaryDirectory('studio-restore-target-')
    const destination = await temporaryDirectory('studio-restore-package-')
    createCurrentDatabase(userData, '要恢复的 Agent')
    await mkdir(path.join(userData, 'workspaces', 'original'), { recursive: true })
    await writeFile(path.join(userData, 'workspaces', 'original', 'note.txt'), '恢复后存在')
    const service = createService(userData)
    const backup = await service.createBackup(destination)
    const backupPath = path.join(destination, backup.backupName)

    const changed = new AgentRepository(path.join(userData, 'studio.sqlite3'))
    changed.create({ name: '不应保留的 Agent', description: '', executionMode: 'workflow' })
    changed.close()
    await rm(path.join(userData, 'workspaces'), { recursive: true, force: true })
    await mkdir(path.join(userData, 'workspaces', 'changed'), { recursive: true })
    await writeFile(path.join(userData, 'workspaces', 'changed', 'note.txt'), '恢复后删除')

    const [firstStage, duplicateStage] = await Promise.all([
      service.stageRestore(backupPath),
      service.stageRestore(backupPath),
    ])
    expect(duplicateStage.preview.backupName).toBe(firstStage.preview.backupName)
    expect((await service.status()).pendingRestore).toBe(true)
    await service.applyPendingRestore()

    const restored = new AgentRepository(path.join(userData, 'studio.sqlite3'))
    expect(restored.list().map(({ name }) => name)).toEqual(['要恢复的 Agent'])
    restored.close()
    expect(await readFile(path.join(userData, 'workspaces', 'original', 'note.txt'), 'utf8')).toBe(
      '恢复后存在',
    )
    expect(await readdir(path.join(userData, 'recovery'))).toHaveLength(1)
    expect((await service.status()).pendingRestore).toBe(false)
    expect((await service.status()).lastRestoreAt).toBe('2026-08-19T12:34:56.000Z')
  })

  it('restores a v1 backup and lets the current repository migrate it safely', async () => {
    const legacyUserData = await temporaryDirectory('studio-legacy-source-')
    const destination = await temporaryDirectory('studio-legacy-package-')
    const legacy = new Database(path.join(legacyUserData, 'studio.sqlite3'))
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations VALUES (1, '2026-08-19T00:00:00.000Z');
      CREATE TABLE agents (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        execution_mode TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO agents VALUES (
        '4061fbad-2152-47bc-9db3-bd70d133f2be',
        '跨版本 Agent',
        '',
        'agent-loop',
        '2026-08-19T00:00:00.000Z',
        '2026-08-19T00:00:00.000Z'
      );
    `)
    legacy.close()
    const legacyService = createService(legacyUserData, '0.0.1')
    const backup = await legacyService.createBackup(destination)

    const currentUserData = await temporaryDirectory('studio-current-target-')
    createCurrentDatabase(currentUserData, '当前 Agent')
    const currentService = createService(currentUserData)
    const selected = await currentService.inspectBackup(path.join(destination, backup.backupName))
    expect(selected.preview).toMatchObject({
      sourceDatabaseSchemaVersion: 1,
      targetDatabaseSchemaVersion: CURRENT_SCHEMA_VERSION,
      migrationRequired: true,
    })

    await currentService.stageRestore(path.join(destination, backup.backupName))
    await currentService.applyPendingRestore()
    const migrated = new AgentRepository(path.join(currentUserData, 'studio.sqlite3'))
    expect(migrated.list()[0]?.name).toBe('跨版本 Agent')
    migrated.close()
    expect((await currentService.status()).databaseSchemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })
})
