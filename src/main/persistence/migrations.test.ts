import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentRepository } from './agent-repository'
import { CURRENT_SCHEMA_VERSION, migrate } from './migrations'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-migration-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'studio.sqlite3')
}

describe('database migrations', () => {
  it('upgrades a v1 database through every accepted migration without losing the Agent', async () => {
    const filePath = await databasePath()
    const legacy = new Database(filePath)
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
        '旧版 Agent',
        '迁移后应保留',
        'agent-loop',
        '2026-08-19T00:00:00.000Z',
        '2026-08-19T00:00:00.000Z'
      );
    `)
    legacy.close()

    const repository = new AgentRepository(filePath)
    expect(repository.list()[0]).toMatchObject({ name: '旧版 Agent', description: '迁移后应保留' })
    repository.close()

    const migrated = new Database(filePath, { readonly: true })
    const versions = migrated
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .pluck()
      .all() as number[]
    expect(versions).toEqual(
      Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => index + 1),
    )
    expect(migrated.pragma('integrity_check', { simple: true })).toBe('ok')
    migrated.close()
  })

  it('refuses to open a database created by a newer application version', async () => {
    const filePath = await databasePath()
    const newer = new Database(filePath)
    newer.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations VALUES (${CURRENT_SCHEMA_VERSION + 1}, '2026-08-19T00:00:00.000Z');
    `)

    expect(() => migrate(newer)).toThrow(/高于当前应用支持/)
    newer.close()
  })

  it('rolls back a failed historical upgrade and succeeds after the conflict is repaired', async () => {
    const filePath = await databasePath()
    const database = new Database(filePath)
    database.exec(`
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
        '可恢复 Agent', '', 'agent-loop',
        '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z'
      );
      CREATE TABLE agent_stack_drafts (conflict TEXT);
    `)

    expect(() => migrate(database)).toThrow()
    expect(
      database.prepare('SELECT version FROM schema_migrations ORDER BY version').pluck().all(),
    ).toEqual([1])
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_versions'")
        .get(),
    ).toBeUndefined()
    expect(database.prepare('SELECT name FROM agents').pluck().get()).toBe('可恢复 Agent')

    database.exec('DROP TABLE agent_stack_drafts')
    migrate(database)
    expect(database.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()).toBe(
      CURRENT_SCHEMA_VERSION,
    )
    expect(database.prepare('SELECT archived_at FROM agents').pluck().get()).toBeNull()
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    database.close()
  })

  it('is idempotent when the current schema is already installed', async () => {
    const filePath = await databasePath()
    const database = new Database(filePath)
    migrate(database)
    const firstAppliedAt = database
      .prepare('SELECT applied_at FROM schema_migrations WHERE version = ?')
      .pluck()
      .get(CURRENT_SCHEMA_VERSION)

    migrate(database)

    expect(
      database
        .prepare('SELECT applied_at FROM schema_migrations WHERE version = ?')
        .pluck()
        .get(CURRENT_SCHEMA_VERSION),
    ).toBe(firstAppliedAt)
    database.close()
  })

  it('adds the M7 project index without seeding editable demo components', async () => {
    const filePath = await databasePath()
    const database = new Database(filePath)
    migrate(database)

    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('studio_projects', 'app_preferences', 'maintenance_records', 'project_component_paths') ORDER BY name",
        )
        .pluck()
        .all(),
    ).toEqual([
      'app_preferences',
      'maintenance_records',
      'project_component_paths',
      'studio_projects',
    ])
    expect(database.prepare('SELECT COUNT(*) FROM components').pluck().get()).toBe(0)
    expect(
      database.prepare('SELECT version FROM schema_migrations WHERE version = 7').get(),
    ).toEqual({
      version: 7,
    })
    database.close()
  })

  it('upgrades v9 with empty Provider bindings while preserving legacy secret references', async () => {
    const filePath = await databasePath()
    const database = new Database(filePath)
    migrate(database)
    database.exec(`
      DROP TABLE model_verifications;
      DROP TABLE provider_credential_bindings;
      DROP TABLE agent_setup_sessions;
      DELETE FROM schema_migrations WHERE version >= 10;
      INSERT INTO agents
        (id, name, description, execution_mode, archived_at, created_at, updated_at)
      VALUES
        ('4061fbad-2152-47bc-9db3-bd70d133f2be', '历史 Agent', '', 'external-harness', NULL,
         '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z');
      INSERT INTO agent_stack_drafts (agent_id, execution_mode, revision, updated_at)
      VALUES
        ('4061fbad-2152-47bc-9db3-bd70d133f2be', 'external-harness', 1,
         '2026-08-19T00:00:00.000Z');
      INSERT INTO agent_project_links (agent_id, project_id, project_path, linked_at, updated_at)
      VALUES
        ('4061fbad-2152-47bc-9db3-bd70d133f2be',
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '/tmp/legacy/.agent-stack',
         '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z');
      INSERT INTO secret_references
        (id, agent_id, label, keychain_service, keychain_account, created_at)
      VALUES
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
         '4061fbad-2152-47bc-9db3-bd70d133f2be', 'OpenAI API',
         'studio.agentstack.desktop', 'legacy-openai', '2026-08-19T00:00:00.000Z');
    `)

    migrate(database)

    expect(database.prepare('SELECT COUNT(*) FROM secret_references').pluck().get()).toBe(1)
    expect(
      database.prepare('SELECT COUNT(*) FROM provider_credential_bindings').pluck().get(),
    ).toBe(0)
    expect(database.prepare('SELECT COUNT(*) FROM model_verifications').pluck().get()).toBe(0)
    expect(database.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()).toBe(
      CURRENT_SCHEMA_VERSION,
    )
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    database.close()
  })

  it('enforces Provider binding secret semantics and rolls back a conflicting v10 upgrade', async () => {
    const filePath = await databasePath()
    const database = new Database(filePath)
    migrate(database)
    database.exec(`
      DROP TABLE model_verifications;
      DROP TABLE provider_credential_bindings;
      DROP TABLE agent_setup_sessions;
      DELETE FROM schema_migrations WHERE version >= 10;
      CREATE TABLE provider_credential_bindings (conflict TEXT);
    `)

    expect(() => migrate(database)).toThrow()
    expect(database.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()).toBe(9)
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'model_verifications'",
        )
        .get(),
    ).toBeUndefined()

    database.exec('DROP TABLE provider_credential_bindings')
    migrate(database)
    expect(database.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()).toBe(
      CURRENT_SCHEMA_VERSION,
    )
    expect(() =>
      database
        .prepare(
          `INSERT INTO provider_credential_bindings
           (id, agent_id, project_id, harness_id, provider_id, auth_method,
            secret_reference_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'missing-agent',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'pi',
          'openai',
          'api-key',
          null,
          '2026-08-19T00:00:00.000Z',
          '2026-08-19T00:00:00.000Z',
        ),
    ).toThrow()
    database.close()
  })

  it('rolls back a conflicting setup-session migration and can retry through v12 cleanly', async () => {
    const filePath = await databasePath()
    const database = new Database(filePath)
    migrate(database)
    database.exec(`
      DROP TABLE agent_setup_sessions;
      DELETE FROM schema_migrations WHERE version >= 11;
      CREATE TABLE agent_setup_sessions (conflict TEXT);
    `)

    expect(() => migrate(database)).toThrow()
    expect(database.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()).toBe(10)
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get('agent_setup_sessions_status_updated_idx'),
    ).toBeUndefined()

    database.exec('DROP TABLE agent_setup_sessions')
    migrate(database)
    expect(database.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get()).toBe(
      CURRENT_SCHEMA_VERSION,
    )
    expect(database.prepare('SELECT COUNT(*) FROM agent_setup_sessions').pluck().get()).toBe(0)
    expect(
      database
        .prepare('SELECT name FROM pragma_table_info(?) WHERE name = ?')
        .get('agent_setup_sessions', 'capability_selections_json'),
    ).toEqual({ name: 'capability_selections_json' })
    expect(
      database
        .prepare('SELECT name FROM pragma_table_info(?) WHERE name = ?')
        .get('agent_setup_sessions', 'mcp_validations_json'),
    ).toEqual({ name: 'mcp_validations_json' })
    database.close()
  })
})
