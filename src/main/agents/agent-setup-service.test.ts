import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudioCore } from '../../core/studio-core'
import { emptyAgentSetupProfile, type AgentSetupView } from '../../shared/agent-setup'
import type {
  KeychainAdapter,
  KeychainLocator,
} from '../../adapters/keychain/macos-keychain-adapter'
import type { ModelAuthGateway } from '../model-auth/model-auth-service'
import { AgentRepository } from '../persistence/agent-repository'
import { AgentSetupRepository } from '../persistence/agent-setup-repository'
import { WorkspaceService } from '../workspace/workspace-service'
import type { StudioProjectService } from '../projects/studio-project-service'
import { AgentSetupService } from './agent-setup-service'

const directories: string[] = []
const timestamp = '2026-08-26T08:00:00.000Z'

afterEach(async () => {
  await Promise.all(directories.splice(0).map((item) => rm(item, { recursive: true, force: true })))
})

class MemoryKeychain implements KeychainAdapter {
  readonly values = new Map<string, string>()

  key(locator: KeychainLocator): string {
    return `${locator.service}\0${locator.account}`
  }

  set(locator: KeychainLocator, secret: string): Promise<void> {
    this.values.set(this.key(locator), secret)
    return Promise.resolve()
  }

  has(locator: KeychainLocator): Promise<boolean> {
    return Promise.resolve(this.values.has(this.key(locator)))
  }

  get(locator: KeychainLocator): Promise<string | null> {
    return Promise.resolve(this.values.get(this.key(locator)) ?? null)
  }

  delete(locator: KeychainLocator): Promise<boolean> {
    return Promise.resolve(this.values.delete(this.key(locator)))
  }
}

const authenticationStatus = vi.fn<ModelAuthGateway['authenticationStatus']>(({ selection }) =>
  Promise.resolve({
    harnessId: selection.harnessId,
    providerId: selection.providerId,
    authMethod: selection.credentialRequirement.method,
    state: 'credential-valid' as const,
    detail: '认证有效。',
    checkedAt: timestamp,
    failure: null,
  }),
)

const gateway: ModelAuthGateway = {
  probe: vi.fn<ModelAuthGateway['probe']>((harnessId) =>
    Promise.resolve({
      id: harnessId,
      label: harnessId === 'pi' ? 'Pi' : harnessId === 'openclaw' ? 'OpenClaw' : 'Codex CLI',
      executable: harnessId,
      status: 'ready' as const,
      version: 'test-version',
      requiredVersion: 'test-version',
      capabilities: {
        prompt: 'native' as const,
        skills: 'native' as const,
        memory: 'native' as const,
        mcp: 'native' as const,
        sessions: 'native' as const,
      },
      detail: '本机 Harness 可用。',
    }),
  ),
  configureAuthentication: vi.fn<ModelAuthGateway['configureAuthentication']>(({ selection }) =>
    Promise.resolve({
      harnessId: selection.harnessId,
      providerId: selection.providerId,
      authMethod: selection.credentialRequirement.method,
      state: 'credential-valid' as const,
      detail: '认证有效。',
      checkedAt: timestamp,
      failure: null,
    }),
  ),
  authenticationStatus,
  verify: vi.fn<ModelAuthGateway['verify']>(() =>
    Promise.resolve({
      state: 'minimal-call-succeeded' as const,
      configurationHash: 'a'.repeat(64),
      checkedAt: timestamp,
      failure: null,
    }),
  ),
}

async function fixture(openFailure?: Error) {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-setup-service-'))
  directories.push(directory)
  const databasePath = path.join(directory, 'studio.sqlite3')
  const setups = new AgentSetupRepository(databasePath)
  const agents = new AgentRepository(databasePath)
  const keychain = new MemoryKeychain()
  const open = vi.fn(() => {
    if (openFailure) return Promise.reject(openFailure)
    return Promise.resolve(undefined)
  })
  const deactivateIfProject = vi.fn()
  const current = vi.fn(() =>
    Promise.resolve({
      projectPath: null,
      localAgentId: null,
      project: null,
      validation: null,
      integrity: null,
      recovered: false,
      changedExternally: false,
      cliPath: '/test/studio',
    }),
  )
  const projects = { open, deactivateIfProject, current } as unknown as StudioProjectService
  const workspaceRoot = path.join(directory, 'workspaces')
  const setupRoot = path.join(directory, 'setup-sessions')
  const service = new AgentSetupService({
    setups,
    agents,
    workspaces: new WorkspaceService(workspaceRoot),
    projects,
    core: new StudioCore(),
    gateway,
    keychain,
    setupRoot,
  })
  return {
    directory,
    workspaceRoot,
    setupRoot,
    setups,
    agents,
    keychain,
    open,
    deactivateIfProject,
    current,
    service,
  }
}

async function readySetup(
  service: AgentSetupService,
  options: {
    profile?: AgentSetupView['session']['profile']
    capabilitySelectionIds?: string[]
  } = {},
) {
  let view = await service.start()
  view = await service.update({
    id: view.session.id,
    expectedRevision: view.session.revision,
    step: 'harness',
    name: 'Atomic Agent',
    description: 'Created only after readiness succeeds.',
    harnessId: null,
    selection: null,
    profile: view.session.profile,
  })
  const selection = {
    harnessId: 'pi' as const,
    providerId: 'openai',
    modelId: 'gpt-5.1',
    credentialRequirement: { method: 'api-key' as const, credentialKind: 'api-key' as const },
  }
  view = await service.update({
    id: view.session.id,
    expectedRevision: view.session.revision,
    step: 'model',
    name: view.session.name,
    description: view.session.description,
    harnessId: 'pi',
    selection,
    profile: view.session.profile,
  })
  view = await service.configureApiKey(view.session.id, 'private-test-api-key')
  view = await service.verify({
    id: view.session.id,
    requestId: '7f1447cc-6a9c-47e3-9356-dfabd6170900',
    costAcknowledged: true,
    timeoutMs: 30_000,
  })
  view = await service.update({
    id: view.session.id,
    expectedRevision: view.session.revision,
    step: 'capabilities',
    name: view.session.name,
    description: view.session.description,
    harnessId: 'pi',
    selection,
    profile: view.session.profile,
  })
  return service.update({
    id: view.session.id,
    expectedRevision: view.session.revision,
    step: 'review',
    name: view.session.name,
    description: view.session.description,
    harnessId: 'pi',
    selection,
    profile: options.profile ?? {
      ...view.session.profile,
      instructions: 'Answer with local evidence.',
    },
    capabilitySelectionIds: options.capabilitySelectionIds,
  })
}

describe('AgentSetupService', () => {
  it('enforces adjacent, gated setup transitions', async () => {
    const context = await fixture()
    const view = await context.service.start()

    await expect(
      context.service.update({
        id: view.session.id,
        expectedRevision: view.session.revision,
        step: 'model',
        name: 'Skipped setup',
        description: '',
        harnessId: 'pi',
        selection: null,
        profile: view.session.profile,
      }),
    ).rejects.toThrow('按顺序')
    await expect(
      context.service.update({
        id: view.session.id,
        expectedRevision: view.session.revision,
        step: 'harness',
        name: '   ',
        description: '',
        harnessId: null,
        selection: null,
        profile: view.session.profile,
      }),
    ).rejects.toThrow('有效')
    expect(context.agents.list()).toEqual([])
    context.setups.close()
    context.agents.close()
  })

  it('creates exactly one Agent only after readiness and keeps the secret out of project facts', async () => {
    const context = await fixture()
    const view = await readySetup(context.service)

    expect(view.readiness.ready).toBe(true)
    expect(context.agents.list()).toEqual([])
    const result = await context.service.complete(view.session.id)
    const duplicate = await context.service.complete(view.session.id)

    expect(duplicate).toEqual(result)
    expect(context.agents.list()).toHaveLength(1)
    expect(context.open).toHaveBeenCalledTimes(1)
    expect(await readdir(context.workspaceRoot)).toEqual([result.agentId])
    expect(() => context.setups.get(view.session.id)).toThrow('找不到')
    const projectText = await readFile(
      path.join(context.workspaceRoot, result.agentId, '.agent-stack'),
      'utf8',
    )
    expect(projectText).toContain('Answer with local evidence.')
    expect(projectText).not.toContain('private-test-api-key')
    expect(JSON.stringify(context.agents.getDetail(result.agentId))).not.toContain(
      'private-test-api-key',
    )
    context.setups.close()
    context.agents.close()
  })

  it('completes exactly one verified Agent when optional capabilities are empty', async () => {
    const context = await fixture()
    const view = await readySetup(context.service, { profile: emptyAgentSetupProfile })

    expect(view.readiness.ready).toBe(true)
    expect(view.readiness.hasCapability).toBe(false)
    expect(view.session.capabilitySelections).toEqual([])
    const result = await context.service.complete(view.session.id)
    const duplicate = await context.service.complete(view.session.id)

    expect(duplicate).toEqual(result)
    expect(context.agents.list()).toHaveLength(1)
    expect(await readdir(context.workspaceRoot)).toEqual([result.agentId])
    context.setups.close()
    context.agents.close()
  })

  it('restores a catalog selection from the saved setup and materializes it at finalize', async () => {
    const context = await fixture()
    let view = await readySetup(context.service, {
      profile: emptyAgentSetupProfile,
      capabilitySelectionIds: ['prompt:clear-assistant'],
    })

    expect(view.capabilityCatalog.projectComponents).toEqual({
      state: 'empty',
      message: '当前项目组件目录为空。',
    })
    expect(view.capabilityCatalog.items.some(({ kind }) => kind === 'skill')).toBe(true)
    expect(view.session.capabilitySelections.map(({ id }) => id)).toEqual([
      'prompt:clear-assistant',
    ])
    view = await context.service.save(view.session.id, view.session.revision)
    const restored = await context.service.get(view.session.id)
    expect(restored.session.capabilitySelections).toEqual(view.session.capabilitySelections)

    const result = await context.service.complete(view.session.id)
    const projectText = await readFile(
      path.join(context.workspaceRoot, result.agentId, '.agent-stack'),
      'utf8',
    )
    expect(projectText).toContain('你是一位清晰、可靠的助手')
    context.setups.close()
    context.agents.close()
  })

  it('compensates finalize when a selected fixed Skill cannot be installed', async () => {
    const context = await fixture()
    const view = await readySetup(context.service, {
      profile: emptyAgentSetupProfile,
      capabilitySelectionIds: ['skill:anthropic-algorithmic-art'],
    })

    await expect(context.service.complete(view.session.id)).rejects.toThrow(
      '固定 Skill 安装边界不可用',
    )
    expect(context.agents.list()).toEqual([])
    expect(await readdir(context.workspaceRoot)).toEqual([])
    expect(context.setups.get(view.session.id).capabilitySelections).toHaveLength(1)
    context.setups.close()
    context.agents.close()
  })

  it('blocks an approved local MCP until a real handshake and tool discovery succeed', async () => {
    const context = await fixture()
    const mcpServer = {
      id: 'fixture-mcp',
      name: 'Fixture MCP',
      transport: 'stdio' as const,
      command: process.execPath,
      args: [path.resolve('src/test/fixtures/mcp/stdio-server.mjs')],
      url: null,
      secretReferences: [],
      enabled: true,
      approval: 'approved' as const,
    }
    let view = await readySetup(context.service, {
      profile: { ...emptyAgentSetupProfile, mcpServers: [mcpServer] },
    })

    expect(view.readiness.ready).toBe(false)
    expect(view.readiness.blockers).toContainEqual(
      expect.objectContaining({ id: 'capability', step: 'capabilities' }),
    )
    view = await context.service.validateMcp({
      id: view.session.id,
      serverId: mcpServer.id,
      requestId: '2e5ef480-bbfa-4a5d-a7e9-895906d08ff8',
      timeoutMs: 5_000,
    })

    expect(view.session.mcpValidations).toEqual([
      expect.objectContaining({
        serverId: mcpServer.id,
        state: 'succeeded',
        executable: process.execPath,
        toolNames: ['fixture_echo'],
      }),
    ])
    expect(view.readiness.ready).toBe(true)
    const result = await context.service.complete(view.session.id)
    const projectText = await readFile(
      path.join(context.workspaceRoot, result.agentId, '.agent-stack'),
      'utf8',
    )
    expect(projectText).toContain('fixture-mcp')
    expect(projectText).toContain(process.execPath)
    context.setups.close()
    context.agents.close()
  })

  it('keeps a catalog-selected MCP validation across save and atomically projects it', async () => {
    const context = await fixture()
    const mcpServer = {
      id: 'fixture-mcp',
      name: 'Fixture MCP',
      transport: 'stdio' as const,
      command: process.execPath,
      args: [path.resolve('src/test/fixtures/mcp/stdio-server.mjs')],
      url: null,
      secretReferences: [],
      enabled: true,
      approval: 'approved' as const,
    }
    context.current.mockResolvedValue({
      projectPath: '/catalog/.agent-stack',
      localAgentId: null,
      project: {
        name: 'Catalog Project',
        components: [],
        profile: { ...emptyAgentSetupProfile, mcpServers: [mcpServer] },
      },
      validation: null,
      integrity: null,
      recovered: false,
      changedExternally: false,
      cliPath: '/test/studio',
    } as never)
    let view = await readySetup(context.service, {
      profile: emptyAgentSetupProfile,
      capabilitySelectionIds: ['mcp:fixture-mcp'],
    })

    view = await context.service.validateMcp({
      id: view.session.id,
      serverId: mcpServer.id,
      requestId: '637fa0f5-c6c7-4836-bf82-03183a83e5d6',
      timeoutMs: 5_000,
    })
    view = await context.service.update({
      id: view.session.id,
      expectedRevision: view.session.revision,
      step: 'review',
      name: view.session.name,
      description: view.session.description,
      harnessId: view.session.harnessId,
      selection: view.session.selection,
      profile: view.session.profile,
      capabilitySelectionIds: ['mcp:fixture-mcp'],
    })

    expect(view.session.mcpValidations).toHaveLength(1)
    expect(
      (await context.service.save(view.session.id, view.session.revision)).session.mcpValidations,
    ).toHaveLength(1)
    const result = await context.service.complete(view.session.id)
    const projectText = await readFile(
      path.join(context.workspaceRoot, result.agentId, '.agent-stack'),
      'utf8',
    )
    expect(projectText).toContain('fixture-mcp')
    expect(context.agents.list()).toHaveLength(1)
    context.setups.close()
    context.agents.close()
  })

  it('retains a securely-located API Key when the first auth check is unavailable', async () => {
    const context = await fixture()
    let view = await context.service.start()
    view = await context.service.update({
      id: view.session.id,
      expectedRevision: view.session.revision,
      step: 'harness',
      name: 'Recoverable auth',
      description: '',
      harnessId: null,
      selection: null,
      profile: view.session.profile,
    })
    view = await context.service.update({
      id: view.session.id,
      expectedRevision: view.session.revision,
      step: 'model',
      name: view.session.name,
      description: '',
      harnessId: 'pi',
      selection: {
        harnessId: 'pi',
        providerId: 'openai',
        modelId: 'gpt-5.1',
        credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
      },
      profile: view.session.profile,
    })
    authenticationStatus.mockRejectedValueOnce(new Error('driver failed'))

    view = await context.service.configureApiKey(view.session.id, 'private-test-api-key')

    expect(view.session.authentication?.state).toBe('unavailable')
    expect(view.session.hasKeychainCredential).toBe(true)
    expect(context.keychain.values.size).toBe(1)
    await context.service.discard(view.session.id)
    expect(context.keychain.values.size).toBe(0)
    context.setups.close()
    context.agents.close()
  })

  it('refreshes non-billing authentication at completion and blocks an expired credential', async () => {
    const context = await fixture()
    const view = await readySetup(context.service)
    authenticationStatus.mockResolvedValueOnce({
      harnessId: 'pi',
      providerId: 'openai',
      authMethod: 'api-key',
      state: 'credential-expired',
      detail: '认证已过期。',
      checkedAt: timestamp,
      failure: {
        code: 'credential-expired',
        message: '认证已过期。',
        recoveryAction: '重新保存 API Key。',
        retryable: true,
      },
    })

    await expect(context.service.complete(view.session.id)).rejects.toThrow('认证')

    expect(context.agents.list()).toEqual([])
    expect(context.setups.get(view.session.id).authentication?.state).toBe('credential-expired')
    expect(await readdir(context.workspaceRoot).catch(() => [])).toEqual([])
    context.setups.close()
    context.agents.close()
  })

  it('compensates a final open failure without deleting the resumable setup or Keychain fact', async () => {
    const context = await fixture(new Error('simulated final open failure'))
    const view = await readySetup(context.service)

    await expect(context.service.complete(view.session.id)).rejects.toThrow(
      'simulated final open failure',
    )

    expect(context.agents.list()).toEqual([])
    expect(await readdir(context.workspaceRoot)).toEqual([])
    expect(context.setups.get(view.session.id).step).toBe('review')
    expect(context.keychain.values.size).toBe(1)
    expect(context.deactivateIfProject).toHaveBeenCalledTimes(1)
    context.setups.close()
    context.agents.close()
  })
})
