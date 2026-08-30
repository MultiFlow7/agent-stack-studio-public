import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyAgentSetupProfile } from '../../shared/agent-setup'
import { AgentSetupRepository } from './agent-setup-repository'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((item) => rm(item, { recursive: true, force: true })))
})

async function repository() {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-setup-repository-'))
  directories.push(directory)
  const databasePath = path.join(directory, 'studio.sqlite3')
  return { databasePath, value: new AgentSetupRepository(databasePath) }
}

describe('AgentSetupRepository', () => {
  it('keeps transient work out of the resumable list until explicit save', async () => {
    const { value } = await repository()
    const created = value.create()

    expect(value.listSaved()).toEqual([])
    const updated = value.update({
      id: created.id,
      expectedRevision: created.revision,
      step: 'basics',
      name: 'Local setup',
      description: 'Not an Agent yet.',
      harnessId: null,
      selection: null,
      profile: emptyAgentSetupProfile,
    })
    const saved = value.save(updated.id, updated.revision)

    expect(saved.status).toBe('saved')
    expect(value.listSaved()).toEqual([saved])
    expect(value.save(saved.id, saved.revision)).toEqual(saved)
    value.close()
  })

  it('preserves only a Keychain locator and rejects stale revisions', async () => {
    const { databasePath, value } = await repository()
    const created = value.create()
    const selected = value.update({
      id: created.id,
      expectedRevision: created.revision,
      step: 'model',
      name: 'Secure setup',
      description: '',
      harnessId: 'pi',
      selection: {
        harnessId: 'pi',
        providerId: 'openai',
        modelId: 'gpt-5.1',
        credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
      },
      profile: emptyAgentSetupProfile,
    })
    const authentication = {
      harnessId: 'pi' as const,
      providerId: 'openai',
      authMethod: 'api-key' as const,
      state: 'credential-valid' as const,
      detail: '凭证有效。',
      checkedAt: '2026-08-26T08:00:00.000Z',
      failure: null,
    }
    const current = value.setAuthentication({
      id: selected.id,
      authentication,
      locator: { service: 'studio.agentstack.desktop', account: 'setup:opaque-locator' },
    })

    expect(current.hasKeychainCredential).toBe(true)
    expect(current).not.toHaveProperty('apiKey')
    expect(() =>
      value.update({
        id: created.id,
        expectedRevision: created.revision,
        step: 'basics',
        name: 'Stale',
        description: '',
        harnessId: null,
        selection: null,
        profile: emptyAgentSetupProfile,
      }),
    ).toThrow('其他窗口')
    value.close()

    const database = new Database(databasePath, { readonly: true })
    const serialized = JSON.stringify(
      database.prepare('SELECT * FROM agent_setup_sessions WHERE id = ?').get(created.id),
    )
    expect(serialized).toContain('setup:opaque-locator')
    expect(serialized).not.toContain('secret-value')
    database.close()
  })
})
