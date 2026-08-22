import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createRunFixture } from '../../test/run-fixture'
import { buildPublishPackage, publishIdempotencyKey } from '../domain/publish-package'
import { localContractTestTargetId } from '../../shared/publish'
import { PublishRepository } from './publish-repository'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('PublishRepository', () => {
  it('migrates SQLite v5 and persists Receipt plus identity mapping', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-m5-publish-'))
    directories.push(directory)
    const databasePath = path.join(directory, 'studio.sqlite3')
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, '2026-08-19T00:00:00.000Z');
      INSERT INTO schema_migrations VALUES (2, '2026-08-19T01:00:00.000Z');
      INSERT INTO schema_migrations VALUES (3, '2026-08-19T02:00:00.000Z');
      INSERT INTO schema_migrations VALUES (4, '2026-08-19T03:00:00.000Z');
      INSERT INTO schema_migrations VALUES (5, '2026-08-19T04:00:00.000Z');
      CREATE TABLE agents (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE agent_versions (id TEXT PRIMARY KEY NOT NULL);
    `)
    const { component, version } = createRunFixture()
    database.prepare('INSERT INTO agents (id) VALUES (?)').run(version.agentId)
    database.prepare('INSERT INTO agent_versions (id) VALUES (?)').run(version.id)
    database.close()

    const repository = new PublishRepository(databasePath)
    const publishPackage = buildPublishPackage({ version, components: [component] })
    const idempotencyKey = publishIdempotencyKey(localContractTestTargetId, publishPackage)
    const pending = repository.createPending({
      targetId: localContractTestTargetId,
      agentId: version.agentId,
      agentVersionId: version.id,
      publishPackage,
      idempotencyKey,
    })
    const succeeded = repository.completeSuccess(pending.id, {
      remoteAgentId: 'test-agent-1',
      remoteVersionId: 'test-version-1',
      message: '契约验证通过。',
      publishedFields: ['agent', 'stack'],
      testOnly: true,
    })

    expect(succeeded.status).toBe('succeeded')
    expect(
      repository.findSucceeded(localContractTestTargetId, version.id, publishPackage.contentHash)
        ?.id,
    ).toBe(pending.id)
    expect(repository.history(localContractTestTargetId, version.agentId)).toMatchObject({
      mapping: { remoteAgentId: 'test-agent-1' },
      receipts: [{ status: 'succeeded' }],
    })
    repository.close()

    const migrated = new Database(databasePath)
    expect(migrated.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual(
      {
        version: 9,
      },
    )
    migrated.close()
  })
})
