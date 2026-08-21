import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { builtInComponents } from '../components/built-in-components'
import { AgentRepository } from './agent-repository'
import { ComponentRepository } from './component-repository'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function createRepositories(): Promise<{
  agents: AgentRepository
  components: ComponentRepository
}> {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-components-'))
  temporaryDirectories.push(directory)
  const databasePath = path.join(directory, 'studio.sqlite3')
  return {
    agents: new AgentRepository(databasePath),
    components: new ComponentRepository(databasePath),
  }
}

describe('ComponentRepository', () => {
  it('applies the M2 database migration to an existing M1 schema', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-migration-'))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, 'studio.sqlite3')
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, '2026-08-19T00:00:00.000Z');
      INSERT INTO schema_migrations VALUES (2, '2026-08-19T01:00:00.000Z');
      CREATE TABLE agents (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
        execution_mode TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_stack_drafts (
        agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        execution_mode TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL
      );
    `)
    database.close()

    const repository = new ComponentRepository(databasePath)
    expect(repository.list()).toEqual([])
    repository.close()

    const migrated = new Database(databasePath)
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
    ])
    expect(
      migrated
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capability_owners'",
        )
        .get(),
    ).toEqual({ name: 'capability_owners' })
    migrated.close()
  })

  it('persists components, owner decisions, conflicts, and the Runtime Plan boundary', async () => {
    const { agents, components } = await createRepositories()
    const agent = agents.create({ name: 'M2 Agent', description: '', executionMode: 'agent-loop' })
    const [x, y] = builtInComponents
      .slice(0, 2)
      .map((component) => components.ensure(component.descriptor, component.id))

    components.addToStack(agent.id, x.id)
    const overlapping = components.addToStack(agent.id, y.id)
    expect(overlapping.compilation.status).toBe('blocked')
    if (overlapping.compilation.status === 'blocked') {
      expect(
        overlapping.compilation.issues.filter(({ code }) => code === 'OWNER_REQUIRED'),
      ).toHaveLength(2)
    }

    components.selectOwner(agent.id, 'prompt-policy', x.id)
    const resolved = components.selectOwner(agent.id, 'context-builder', y.id)
    expect(resolved.compilation.status).toBe('ready')

    const version = agents.createVersion(agent.id)
    expect(version.snapshot.stack.components).toHaveLength(2)
    expect(version.snapshot.stack.capabilityOwners).toEqual(
      expect.arrayContaining([
        { capability: 'prompt-policy', componentId: x.id },
        { capability: 'context-builder', componentId: y.id },
      ]),
    )
    components.close()
    agents.close()
  })
})
