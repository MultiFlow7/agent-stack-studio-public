import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { ExperimentRepository } from './experiment-repository'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('ExperimentRepository migration', () => {
  it('applies SQLite v5 to an existing M3 database', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-m4-migration-'))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, 'studio.sqlite3')
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, '2026-08-19T00:00:00.000Z');
      INSERT INTO schema_migrations VALUES (2, '2026-08-19T01:00:00.000Z');
      INSERT INTO schema_migrations VALUES (3, '2026-08-19T02:00:00.000Z');
      INSERT INTO schema_migrations VALUES (4, '2026-08-19T03:00:00.000Z');
      CREATE TABLE agents (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE agent_versions (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY NOT NULL);
    `)
    database.close()

    const repository = new ExperimentRepository(databasePath)
    expect(repository.list(null)).toEqual([])
    repository.close()

    const migrated = new Database(databasePath)
    expect(
      migrated.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get(),
    ).toEqual({ version: 9 })
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'experiment%' ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: 'experiment_cells' }, { name: 'experiments' }])
    migrated.close()
  })
})
