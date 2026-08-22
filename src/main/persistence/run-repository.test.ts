import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { builtInComponents } from '../components/built-in-components'
import { buildRunManifest } from '../domain/run-manifest'
import { AgentRepository } from './agent-repository'
import { ComponentRepository } from './component-repository'
import { RunRepository } from './run-repository'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function databasePath(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return path.join(directory, 'studio.sqlite3')
}

describe('RunRepository', () => {
  it('applies the M3 migration to an existing M2 database', async () => {
    const file = await databasePath('agent-stack-m3-migration-')
    const initial = new Database(file)
    initial.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, '2026-08-19T00:00:00.000Z');
      INSERT INTO schema_migrations VALUES (2, '2026-08-19T01:00:00.000Z');
      INSERT INTO schema_migrations VALUES (3, '2026-08-19T02:00:00.000Z');
      CREATE TABLE agents (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE agent_versions (id TEXT PRIMARY KEY NOT NULL);
    `)
    initial.close()

    const repository = new RunRepository(file)
    expect(repository.list(null)).toEqual([])
    repository.close()

    const migrated = new Database(file)
    expect(
      migrated.prepare('SELECT version FROM schema_migrations ORDER BY version').all(),
    ).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
    ])
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'run%' ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: 'run_artifacts' }, { name: 'run_events' }, { name: 'runs' }])
    migrated.close()
  })

  it('persists a manifest, ordered events, terminal status, and Artifact metadata', async () => {
    const file = await databasePath('agent-stack-runs-')
    const agents = new AgentRepository(file)
    const components = new ComponentRepository(file)
    const runs = new RunRepository(file)
    const agent = agents.create(
      { name: 'M3 Agent', description: '', executionMode: 'agent-loop' },
      { id: '20000000-0000-4000-8000-000000000001' },
    )
    const component = components.ensure(builtInComponents[0].descriptor, builtInComponents[0].id)
    const stack = components.addToStack(agent.id, component.id)
    expect(stack.compilation.status).toBe('ready')
    if (stack.compilation.status !== 'ready') throw new Error('Expected a ready stack.')
    const version = agents.createVersion(agent.id)
    const manifest = buildRunManifest({
      runId: '40000000-0000-4000-8000-000000000001',
      version,
      plan: stack.compilation.plan,
      components: [component],
      prompt: '验证 SQLite',
      timeoutMs: 5_000,
      electronVersion: '43.4.1',
      architecture: 'arm64',
      createdAt: '2026-08-19T08:00:00.000Z',
    })

    runs.create(manifest)
    runs.addEvent(manifest.runId, { type: 'queued', message: '已排队。', details: {} })
    runs.addEvent(manifest.runId, { type: 'runtime-ready', message: '已启动。', details: {} })
    runs.addArtifact({
      runId: manifest.runId,
      kind: 'output',
      relativePath: `${manifest.runId}/result.json`,
      contentHash: 'b'.repeat(64),
      sizeBytes: 128,
    })
    runs.updateStatus(manifest.runId, 'succeeded', {
      startedAt: '2026-08-19T08:00:01.000Z',
      finishedAt: '2026-08-19T08:00:02.000Z',
    })

    const detail = runs.getDetail(manifest.runId)
    expect(detail.run.status).toBe('succeeded')
    expect(detail.events.map(({ sequence }) => sequence)).toEqual([1, 2])
    expect(detail.artifacts[0]).toMatchObject({ kind: 'output', sizeBytes: 128 })
    expect(runs.list(agent.id)).toHaveLength(1)
    runs.close()
    components.close()
    agents.close()
  })
})
