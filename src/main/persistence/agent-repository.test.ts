import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentRepository } from './agent-repository'
import { ComponentRepository } from './component-repository'
import { builtInComponents } from '../components/built-in-components'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function createRepository(): Promise<AgentRepository> {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-studio-'))
  temporaryDirectories.push(directory)
  return new AgentRepository(path.join(directory, 'studio.sqlite3'))
}

describe('AgentRepository', () => {
  it('migrates an M0 database and creates missing Stack drafts', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-studio-'))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, 'studio.sqlite3')
    const database = new Database(databasePath)
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
        'M0 Agent',
        '',
        'agent-loop',
        '2026-08-19T00:00:00.000Z',
        '2026-08-19T00:00:00.000Z'
      );
    `)
    database.close()

    const repository = new AgentRepository(databasePath)
    const detail = repository.getDetail('4061fbad-2152-47bc-9db3-bd70d133f2be')

    expect(detail.draft).toMatchObject({ revision: 1, executionMode: 'agent-loop' })
    repository.close()
  })

  it('migrates a new database and reads a created Agent', async () => {
    const repository = await createRepository()

    const created = repository.create({
      name: 'Evaluation Harness',
      description: 'Compares model and prompt candidates.',
      executionMode: 'agent-loop',
    })

    expect(repository.list()).toEqual([created])
    repository.close()
  })

  it('persists records across repository instances', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-studio-'))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, 'studio.sqlite3')
    const first = new AgentRepository(databasePath)
    first.create({ name: 'Local Agent', description: '', executionMode: 'workflow' })
    first.close()

    const second = new AgentRepository(databasePath)
    expect(second.list()).toHaveLength(1)
    expect(second.list()[0]?.name).toBe('Local Agent')
    second.close()
  })

  it('keeps version snapshots immutable when the draft changes', async () => {
    const repository = await createRepository()
    const agent = repository.create({
      name: 'Baseline Agent',
      description: 'Original draft.',
      executionMode: 'agent-loop',
    })
    const version = repository.createVersion(agent.id)

    repository.update({
      id: agent.id,
      name: 'Changed Agent',
      description: 'Updated draft.',
      executionMode: 'workflow',
    })
    const detail = repository.getDetail(agent.id)

    expect(detail.draft.revision).toBe(2)
    expect(detail.agent.name).toBe('Changed Agent')
    expect(detail.versions[0]).toEqual(version)
    expect(detail.versions[0]?.snapshot.agent.name).toBe('Baseline Agent')
    repository.close()
  })

  it('stores Keychain references without accepting secret values', async () => {
    const repository = await createRepository()
    const agent = repository.create({
      name: 'Keychain Agent',
      description: '',
      executionMode: 'agent-loop',
    })

    const reference = repository.saveSecretReference({
      agentId: agent.id,
      label: 'OpenAI API',
      keychainService: 'studio.agentstack.desktop',
      keychainAccount: 'openai-api',
    })

    expect(repository.listSecretReferences(agent.id)).toEqual([reference])
    expect(reference).not.toHaveProperty('value')
    expect(repository.getSecretReference(reference.id)).toEqual(reference)
    repository.deleteSecretReference(reference.id)
    expect(repository.listSecretReferences(agent.id)).toEqual([])
    repository.close()
  })

  it('duplicates the mutable Stack without copying history, then archives and restores it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-studio-'))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, 'studio.sqlite3')
    const repository = new AgentRepository(databasePath)
    const components = new ComponentRepository(databasePath)
    const source = repository.create({
      name: 'Source Agent',
      description: 'Mutable source draft.',
      executionMode: 'agent-loop',
    })
    const builtIn = builtInComponents[0]
    components.ensure(builtIn.descriptor, builtIn.id)
    components.addToStack(source.id, builtIn.id)
    components.selectOwner(source.id, 'execution-controller', builtIn.id)
    repository.createVersion(source.id)

    const duplicate = repository.duplicate(source.id, {
      id: '8d5674b9-d05a-40e8-8321-fb9322937cb1',
      name: 'Source Agent 副本',
      workspacePath: '/tmp/workspaces/duplicate',
    })

    expect(duplicate.versions).toEqual([])
    expect(duplicate.draft.revision).toBe(1)
    expect(components.getStack(duplicate.agent.id).components.map(({ id }) => id)).toEqual([
      builtIn.id,
    ])
    expect(components.getStack(duplicate.agent.id).owners).toMatchObject([
      { capability: 'execution-controller', componentId: builtIn.id },
    ])

    expect(repository.archive(duplicate.agent.id).agent.archivedAt).not.toBeNull()
    expect(repository.list()).toEqual([source])
    expect(repository.list({ scope: 'archived' })).toHaveLength(1)
    expect(repository.restore(duplicate.agent.id).agent.archivedAt).toBeNull()
    expect(repository.list()).toHaveLength(2)
    components.close()
    repository.close()
  })

  it('requires archival and protects every historical reference from permanent deletion', async () => {
    const repository = await createRepository()
    const agent = repository.create({
      name: 'Historical Agent',
      description: '',
      executionMode: 'agent-loop',
    })

    expect(() => repository.delete(agent.id)).toThrow('永久删除前必须先归档')
    repository.createVersion(agent.id)
    repository.archive(agent.id)
    expect(() => repository.delete(agent.id)).toThrow('不可变版本 1 项')
    expect(repository.getDetail(agent.id).agent.archivedAt).not.toBeNull()
    repository.close()
  })

  it('permanently deletes an archived Agent with no history', async () => {
    const repository = await createRepository()
    const agent = repository.create({
      name: 'Disposable Agent',
      description: '',
      executionMode: 'workflow',
    })
    repository.archive(agent.id)
    repository.delete(agent.id)
    expect(repository.list({ scope: 'archived' })).toEqual([])
    expect(() => repository.getDetail(agent.id)).toThrow('不存在')
    repository.close()
  })
})
