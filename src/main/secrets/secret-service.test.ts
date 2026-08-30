import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KeychainAdapter } from '../../adapters/keychain/macos-keychain-adapter'
import { AgentRepository } from '../persistence/agent-repository'
import { SecretService } from './secret-service'
import { StudioCore } from '../../core/studio-core'

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
    values,
    mocks: { set, has, get, remove },
    service: new SecretService({ repository, keychain }),
  }
}

async function providerFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-provider-secret-service-'))
  directories.push(directory)
  const repository = new AgentRepository(path.join(directory, 'studio.sqlite3'))
  const projectRoot = path.join(directory, 'project')
  const initialized = await new StudioCore().initProject(projectRoot, { name: 'Provider Agent' })
  const link = repository.ensureProjectAgent(
    initialized.project,
    path.join(projectRoot, '.agent-stack'),
  )
  const values = new Map<string, string>()
  const keychain: KeychainAdapter = {
    set: ({ service, account }, value) => {
      values.set(`${service}:${account}`, value)
      return Promise.resolve()
    },
    has: ({ service, account }) => Promise.resolve(values.has(`${service}:${account}`)),
    get: ({ service, account }) => Promise.resolve(values.get(`${service}:${account}`) ?? null),
    delete: ({ service, account }) => Promise.resolve(values.delete(`${service}:${account}`)),
  }
  return {
    repository,
    project: initialized.project,
    link,
    values,
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

  it('creates a project-scoped Provider binding and resolves its Key only inside a trusted lease', async () => {
    const { repository, project, link, values, service } = await providerFixture()
    const canary = 'opaque-provider-canary-38dc1b5d'
    const status = await service.configureProviderApiKey({
      agentId: link.agentId,
      projectId: project.id,
      harnessId: 'pi',
      providerId: 'openai',
      secret: canary,
    })

    expect(status.secretConfigured).toBe(true)
    expect(status.binding).toMatchObject({
      agentId: link.agentId,
      projectId: project.id,
      harnessId: 'pi',
      providerId: 'openai',
      authMethod: 'api-key',
    })
    expect(status.binding.secretReferenceId).not.toBeNull()
    expect([...values.values()]).toEqual([canary])
    expect(JSON.stringify(repository.listProviderCredentialBindings(project.id))).not.toContain(
      canary,
    )
    await expect(service.providerBindingStatus(status.binding.id)).resolves.toMatchObject({
      secretConfigured: true,
    })
    await expect(
      service.withProviderCredential(
        {
          bindingId: status.binding.id,
          projectId: project.id,
          harnessId: 'pi',
          providerId: 'openai',
        },
        (secret) => Promise.resolve({ accepted: secret === canary }),
      ),
    ).resolves.toEqual({ accepted: true })
    repository.close()
  })

  it('fails closed when a trusted credential consumer attempts to return the raw value', async () => {
    const { repository, project, link, service } = await providerFixture()
    const canary = 'opaque-provider-canary-1b7a3f2c'
    const { binding } = await service.configureProviderApiKey({
      agentId: link.agentId,
      projectId: project.id,
      harnessId: 'pi',
      providerId: 'openai',
      secret: canary,
    })

    await expect(
      service.withProviderCredential(
        {
          bindingId: binding.id,
          projectId: project.id,
          harnessId: 'pi',
          providerId: 'openai',
        },
        (secret) => Promise.resolve({ stderr: `provider echoed ${secret}` }),
      ),
    ).rejects.toMatchObject({ code: 'HARNESS_FAILED' })
    repository.close()
  })

  it('replaces a rejected consumer error when it contains the raw credential', async () => {
    const { repository, project, link, service } = await providerFixture()
    const canary = 'opaque-provider-canary-88f1a4c2'
    const { binding } = await service.configureProviderApiKey({
      agentId: link.agentId,
      projectId: project.id,
      harnessId: 'pi',
      providerId: 'openai',
      secret: canary,
    })

    const rejection = service.withProviderCredential(
      {
        bindingId: binding.id,
        projectId: project.id,
        harnessId: 'pi',
        providerId: 'openai',
      },
      (secret) => Promise.reject(new Error(`provider stderr echoed ${secret}`)),
    )

    await expect(rejection).rejects.toMatchObject({ code: 'HARNESS_FAILED' })
    await expect(rejection).rejects.not.toThrow(canary)
    repository.close()
  })

  it('removes a newly created Keychain item when local binding persistence fails', async () => {
    const { repository, project, link, values, service } = await providerFixture()
    vi.spyOn(repository, 'saveProviderCredentialBinding').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })

    await expect(
      service.configureProviderApiKey({
        agentId: link.agentId,
        projectId: project.id,
        harnessId: 'pi',
        providerId: 'openai',
        secret: 'rollback-canary',
      }),
    ).rejects.toThrow('database unavailable')
    expect(values.size).toBe(0)
    expect(repository.listSecretReferences(link.agentId)).toEqual([])
    repository.close()
  })

  it('restores the previous project-scoped Keychain value when a binding update fails', async () => {
    const { repository, project, link, values, service } = await providerFixture()
    await service.configureProviderApiKey({
      agentId: link.agentId,
      projectId: project.id,
      harnessId: 'pi',
      providerId: 'openai',
      secret: 'previous-provider-key',
    })
    vi.spyOn(repository, 'saveProviderCredentialBinding').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })

    await expect(
      service.configureProviderApiKey({
        agentId: link.agentId,
        projectId: project.id,
        harnessId: 'pi',
        providerId: 'openai',
        secret: 'replacement-provider-key',
      }),
    ).rejects.toThrow('database unavailable')
    expect([...values.values()]).toEqual(['previous-provider-key'])
    repository.close()
  })
})
