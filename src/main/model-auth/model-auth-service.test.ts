import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KeychainAdapter } from '../../adapters/keychain/macos-keychain-adapter'
import { StudioCore } from '../../core/studio-core'
import {
  modelAuthenticationStatusSchema,
  modelVerificationStatusSchema,
  type HarnessModelSelection,
  type ModelAuthenticationStatus,
  type ModelVerificationStatus,
} from '../../shared/model-auth'
import { studioProjectStateSchema, type StudioProjectState } from '../../shared/studio-project'
import { AgentRepository } from '../persistence/agent-repository'
import { SecretService } from '../secrets/secret-service'
import {
  ModelAuthService,
  modelAuthConfigurationHash,
  type ModelAuthGateway,
  type ModelAuthGatewayRequest,
  type ModelAuthProjectGateway,
} from './model-auth-service'

const directories: string[] = []
const checkedAt = '2026-08-26T05:00:00.000Z'

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

function authentication(
  selection: HarnessModelSelection,
  state: ModelAuthenticationStatus['state'] = 'credential-valid',
): ModelAuthenticationStatus {
  return modelAuthenticationStatusSchema.parse({
    harnessId: selection.harnessId,
    providerId: selection.providerId,
    authMethod: selection.credentialRequirement.method,
    state,
    detail: state === 'credential-valid' ? '凭证有效。' : '凭证不可用。',
    checkedAt,
    failure:
      state === 'credential-valid'
        ? null
        : {
            code: state === 'credential-expired' ? 'credential-expired' : 'credential-invalid',
            message: '凭证不可用。',
            recoveryAction: '重新配置凭证。',
            retryable: true,
          },
  })
}

function verification(
  selection: HarnessModelSelection,
  state: ModelVerificationStatus['state'] = 'minimal-call-succeeded',
): ModelVerificationStatus {
  return modelVerificationStatusSchema.parse({
    state,
    configurationHash: modelAuthConfigurationHash(selection),
    checkedAt,
    failure:
      state === 'minimal-call-succeeded'
        ? null
        : {
            code: state === 'cancelled' ? 'operation-cancelled' : state,
            message: '验证未通过。',
            recoveryAction: '修复后重试。',
            retryable: true,
          },
  })
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-model-auth-service-'))
  directories.push(directory)
  const root = path.join(directory, 'project')
  const core = new StudioCore()
  await core.initProject(root, { name: 'Model Auth Agent' })
  await core.selectKnownHarness(root, 'pi')
  const repository = new AgentRepository(path.join(directory, 'studio.sqlite3'))
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
  const secrets = new SecretService({ repository, keychain })

  const current = async (): Promise<StudioProjectState> => {
    const inspected = await core.inspectProject(root)
    const link = repository.ensureProjectAgent(inspected.project, inspected.path)
    return studioProjectStateSchema.parse({
      projectPath: inspected.path,
      localAgentId: link.agentId,
      project: inspected.project,
      validation: core.validate(inspected.project),
      integrity: inspected.integrity,
      recovered: false,
      changedExternally: false,
      cliPath: '/Applications/Agent Stack Studio.app/Contents/MacOS/studio-cli',
    })
  }
  const projects: ModelAuthProjectGateway = {
    current,
    updateModelConfiguration: async (configuration, expectedRevision) => {
      await core.updateModelConfiguration(root, configuration, { expectedRevision })
      return current()
    },
  }

  let selected: HarnessModelSelection | null = null
  const configureAuthentication = vi.fn(
    (request: ModelAuthGatewayRequest): Promise<ModelAuthenticationStatus> => {
      selected = request.selection
      return Promise.resolve(authentication(request.selection))
    },
  )
  const authenticationStatus = vi.fn(
    (request: ModelAuthGatewayRequest): Promise<ModelAuthenticationStatus> =>
      Promise.resolve(authentication(request.selection)),
  )
  const verifyModel = vi.fn(
    (request: ModelAuthGatewayRequest): Promise<ModelVerificationStatus> =>
      Promise.resolve(verification(request.selection)),
  )
  const gateway: ModelAuthGateway = {
    probe: (harnessId) =>
      Promise.resolve({
        id: harnessId,
        label: 'Pi',
        executable: '/opt/homebrew/bin/pi',
        status: 'ready',
        version: '0.84.2',
        requiredVersion: '0.84.2',
        capabilities: {
          prompt: 'native',
          skills: 'native',
          memory: 'adapted',
          mcp: 'adapted',
          sessions: 'native',
        },
        detail: '已就绪。',
      }),
    configureAuthentication,
    authenticationStatus,
    verify: verifyModel,
  }
  const service = new ModelAuthService({
    repository,
    secrets,
    projects,
    gateway,
    now: () => new Date(checkedAt),
  })
  return {
    directory,
    root,
    repository,
    values,
    projects,
    gateway,
    service,
    calls: { configureAuthentication, authenticationStatus, verifyModel },
    selected: () => selected,
  }
}

const piSelection: HarnessModelSelection = {
  harnessId: 'pi',
  providerId: 'openai',
  modelId: 'gpt-5.1',
  credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
}

describe('ModelAuthService', () => {
  it('keeps portable model requirements separate from the project-scoped Keychain binding', async () => {
    const { directory, root, repository, values, projects, service, calls } = await fixture()
    const initial = await projects.current()
    const selectedReadiness = await service.select({
      selection: piSelection,
      expectedRevision: initial.project!.revision,
    })
    expect(selectedReadiness.state).toBe('unauthenticated')

    const canary = 'opaque-model-auth-canary-b5271f'
    const configured = await service.configure({ method: 'api-key', secret: canary })
    expect(configured.state).toBe('credential-valid')
    expect([...values.values()]).toEqual([canary])
    expect(calls.configureAuthentication).toHaveBeenCalledOnce()
    expect(calls.configureAuthentication.mock.calls[0]?.[0].credential).toEqual({
      kind: 'api-key',
      value: canary,
    })

    const projectText = await readFile(path.join(root, '.agent-stack'), 'utf8')
    expect(projectText).toContain('"providerId": "openai"')
    expect(projectText).not.toContain(canary)
    const databaseFiles = (await readdir(directory)).filter((entry) =>
      entry.startsWith('studio.sqlite3'),
    )
    for (const databaseFile of databaseFiles) {
      expect(await readFile(path.join(directory, databaseFile), 'utf8')).not.toContain(canary)
    }
    expect(
      JSON.stringify(
        repository.listProviderCredentialBindings((await projects.current()).project!.id),
      ),
    ).not.toContain(canary)
    repository.close()
  })

  it('requires an explicit cost acknowledgement and persists only a matching terminal verification', async () => {
    const { repository, projects, service, calls } = await fixture()
    const initial = await projects.current()
    await service.select({ selection: piSelection, expectedRevision: initial.project!.revision })
    await service.configure({ method: 'api-key', secret: 'provider-key' })

    await expect(service.verify({ costAcknowledged: false })).rejects.toMatchObject({
      code: 'USAGE_ERROR',
    })
    expect(calls.verifyModel).not.toHaveBeenCalled()

    const readiness = await service.verify({ costAcknowledged: true })
    expect(readiness).toMatchObject({ state: 'minimal-call-succeeded', ready: true })
    const state = await projects.current()
    const binding = repository.findProviderCredentialBinding(state.project!.id, 'pi', 'openai')!
    expect(
      repository.getModelVerification(binding.id, modelAuthConfigurationHash(piSelection)),
    ).toMatchObject({
      status: 'minimal-call-succeeded',
      failureCode: null,
    })
    await expect(service.assertReadyForFreeze()).resolves.toMatchObject({ ready: true })

    await expect(
      service.configure({ method: 'api-key', secret: 'replacement-provider-key' }),
    ).resolves.toMatchObject({ state: 'credential-valid', ready: false })
    expect(
      repository.getModelVerification(binding.id, modelAuthConfigurationHash(piSelection)),
    ).toMatchObject({ status: 'credential-valid' })
    repository.close()
  })

  it('invalidates readiness when the portable model changes and rejects credential echoes', async () => {
    const { repository, projects, service, gateway } = await fixture()
    const initial = await projects.current()
    await service.select({ selection: piSelection, expectedRevision: initial.project!.revision })
    await service.configure({ method: 'api-key', secret: 'provider-key' })
    await service.verify({ costAcknowledged: true })

    const current = await projects.current()
    const changedSelection: HarnessModelSelection = { ...piSelection, modelId: 'gpt-5.6-sol' }
    const changed = await service.select({
      selection: changedSelection,
      expectedRevision: current.project!.revision,
    })
    expect(changed).toMatchObject({ state: 'unauthenticated', ready: false })
    expect((await projects.current()).project?.modelConfiguration?.modelId).toBe('gpt-5.6-sol')

    gateway.authenticationStatus = (request) => {
      if (request.credential.kind !== 'api-key') {
        return Promise.reject(new Error('expected API Key'))
      }
      return Promise.reject(new Error(`provider stderr: ${request.credential.value}`))
    }
    await expect(service.inspect()).rejects.toMatchObject({ code: 'HARNESS_FAILED' })
    await expect(service.assertReadyForFreeze()).rejects.toMatchObject({
      code: 'STACK_INVALID',
    })
    repository.close()
  })

  it('retains an in-progress Harness login observation for the following GUI status read', async () => {
    const { repository, projects, service, gateway } = await fixture()
    const initial = await projects.current()
    const loginSelection: HarnessModelSelection = {
      ...piSelection,
      credentialRequirement: { method: 'existing-login', credentialKind: 'harness-session' },
    }
    await service.select({
      selection: loginSelection,
      expectedRevision: initial.project!.revision,
    })
    gateway.configureAuthentication = (request) =>
      Promise.resolve(
        modelAuthenticationStatusSchema.parse({
          harnessId: request.selection.harnessId,
          providerId: request.selection.providerId,
          authMethod: request.selection.credentialRequirement.method,
          state: 'checking',
          detail: '已启动 Harness 登录流程。',
          checkedAt,
          failure: null,
        }),
      )

    await expect(service.configure({ method: 'existing-login' })).resolves.toMatchObject({
      state: 'configuring',
    })
    await expect(service.status()).resolves.toMatchObject({ state: 'configuring' })
    repository.close()
  })
})
