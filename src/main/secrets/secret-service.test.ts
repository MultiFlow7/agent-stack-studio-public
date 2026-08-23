import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KeychainAdapter } from '../../adapters/keychain/macos-keychain-adapter'
import { AgentRepository } from '../persistence/agent-repository'
import { SecretService } from './secret-service'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  )
})

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-secret-service-'))
  directories.push(directory)
  const repository = new AgentRepository(path.join(directory, 'studio.sqlite3'))
  const agent = repository.create({
    name: 'Secret Agent',
    description: '',
    executionMode: 'agent-loop',
  })
  const values = new Map<string, string>()
  const set = vi.fn<KeychainAdapter['set']>(({ service, account }, value) => {
    values.set(`${service}:${account}`, value)
    return Promise.resolve()
  })
  const has = vi.fn<KeychainAdapter['has']>(({ service, account }) =>
    Promise.resolve(values.has(`${service}:${account}`)),
  )
  const get = vi.fn<KeychainAdapter['get']>(({ service, account }) =>
    Promise.resolve(values.get(`${service}:${account}`) ?? null),
  )
  const remove = vi.fn<KeychainAdapter['delete']>(({ service, account }) =>
    Promise.resolve(values.delete(`${service}:${account}`)),
  )
  const keychain: KeychainAdapter = {
    set,
    has,
    get,
    delete: remove,
  }
  return {
    repository,
    agent,
    mocks: { set, has, get, remove },
    service: new SecretService({ repository, keychain }),
  }
}

describe('SecretService', () => {
  it('stores only references in SQLite and replaces a matching Keychain item idempotently', async () => {
    const { repository, agent, mocks, service } = await fixture()
    const first = await service.configure({
      agentId: agent.id,
      label: 'OpenAI API',
      keychainAccount: 'openai-api',
      secret: 'first-value',
    })
    const second = await service.configure({
      agentId: agent.id,
      label: 'OpenAI API changed',
      keychainAccount: 'openai-api',
      secret: 'second-value',
    })

    expect(second.id).toBe(first.id)
    expect(second.label).toBe('OpenAI API changed')
    expect(repository.listSecretReferences(agent.id)).toHaveLength(1)
    expect(JSON.stringify(repository.listSecretReferences(agent.id))).not.toContain('second-value')
    await expect(service.readForRuntime(first.id)).resolves.toBe('second-value')
    expect(mocks.set).toHaveBeenCalledTimes(2)
    repository.close()
  })

  it('reports missing local values after restore and deletes references idempotently at Keychain level', async () => {
    const { repository, agent, mocks, service } = await fixture()
    const reference = repository.saveSecretReference({
      agentId: agent.id,
      label: 'Restored secret',
      keychainService: 'studio.agentstack.desktop',
      keychainAccount: 'restored',
    })

    await expect(service.list(agent.id)).resolves.toMatchObject([
      { id: reference.id, configured: false },
    ])
    await expect(service.delete(reference.id)).resolves.toEqual({
      referenceId: reference.id,
      deleted: false,
    })
    expect(mocks.remove).toHaveBeenCalledOnce()
    expect(repository.listSecretReferences(agent.id)).toEqual([])
    repository.close()
  })

  it('serializes concurrent operations for the same Keychain locator', async () => {
    const { repository, agent, mocks, service } = await fixture()
    let active = 0
    let maximumActive = 0
    mocks.set.mockImplementation(async () => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
    })

    const [first, second] = await Promise.all([
      service.configure({
        agentId: agent.id,
        label: 'First',
        keychainAccount: 'shared-account',
        secret: 'first-value',
      }),
      service.configure({
        agentId: agent.id,
        label: 'Second',
        keychainAccount: 'shared-account',
        secret: 'second-value',
      }),
    ])

    expect(maximumActive).toBe(1)
    expect(second.id).toBe(first.id)
    expect(repository.listSecretReferences(agent.id)).toHaveLength(1)
    repository.close()
  })
})
