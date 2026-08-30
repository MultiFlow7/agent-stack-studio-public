import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HarnessModelError,
  type HarnessHostDriver,
  type HostDriverAuthenticationInput,
} from '../../adapters/harness/host-driver'
import { HostDriverRegistry } from '../../adapters/harness/host-driver-registry'
import {
  harnessModelCapability,
  modelAuthenticationStatusSchema,
  type HarnessModelSelection,
  type ModelAuthFailureCode,
} from '../../shared/model-auth'
import type { HarnessId } from '../../shared/native-agent'
import { modelAuthConfigurationHash, type ModelAuthGatewayRequest } from './model-auth-service'
import {
  NativeModelAuthGateway,
  officialHarnessLoginArguments,
  type OfficialHarnessLoginLauncher,
} from './native-model-auth-gateway'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const openClawSelection: HarnessModelSelection = {
  harnessId: 'openclaw',
  providerId: 'openai-codex',
  modelId: 'gpt-5.1-codex',
  credentialRequirement: { method: 'official-login', credentialKind: 'harness-session' },
}

function driverFixture(id: HarnessId = 'openclaw') {
  const authenticationStatus = vi.fn((input: HostDriverAuthenticationInput) =>
    Promise.resolve(
      modelAuthenticationStatusSchema.parse({
        harnessId: input.selection.harnessId,
        providerId: input.selection.providerId,
        authMethod: input.selection.credentialRequirement.method,
        state: 'credential-valid',
        detail: '已登录。',
        checkedAt: '2026-08-26T05:00:00.000Z',
        failure: null,
      }),
    ),
  )
  const verifyModel = vi.fn<HarnessHostDriver['verifyModel']>(() =>
    Promise.resolve({
      harnessVersion: '2026.1.30',
      responseMarkdown: 'MODEL_CONNECTION_OK',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      modelLayer: { kind: 'harness-provider', provider: 'openai-codex', model: 'gpt-5.1-codex' },
      degradedFeatures: [],
    }),
  )
  const executable = `/Applications/Agent Stack Studio.app/Contents/Resources/${id}`
  const driver: HarnessHostDriver = {
    id,
    modelCapability: harnessModelCapability(id),
    probe: () =>
      Promise.resolve({
        id,
        label: id,
        executable,
        status: 'ready',
        version: id === 'openclaw' ? '2026.1.30' : '0.148.0-alpha.9',
        requiredVersion: id === 'openclaw' ? '>=2026.1.30' : '0.148.0-alpha.9',
        capabilities: {
          prompt: 'native',
          skills: 'native',
          memory: 'adapted',
          mcp: 'adapted',
          sessions: 'native',
        },
        detail: '已就绪。',
      }),
    authenticationStatus,
    verifyModel,
    execute: () => Promise.reject(new Error('not used')),
  }
  return { driver, executable, authenticationStatus, verifyModel }
}

async function request(
  selection: HarnessModelSelection = openClawSelection,
): Promise<ModelAuthGatewayRequest> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'native-model-auth-gateway-'))
  directories.push(cwd)
  return {
    selection,
    cwd,
    timeoutMs: 5_000,
    credential: { kind: 'harness-login' },
  }
}

describe('NativeModelAuthGateway', () => {
  it('launches only a catalog-approved official login with a probed executable and fixed args', async () => {
    const { driver, executable, authenticationStatus } = driverFixture()
    const launch = vi.fn<OfficialHarnessLoginLauncher['launch']>(() => Promise.resolve())
    const gateway = new NativeModelAuthGateway({
      drivers: new HostDriverRegistry([driver]),
      loginLauncher: { launch },
    })

    const status = await gateway.configureAuthentication(await request())

    expect(status.state).toBe('checking')
    expect(launch).toHaveBeenCalledWith({
      harnessId: 'openclaw',
      providerId: 'openai-codex',
      executable,
    })
    expect(authenticationStatus).not.toHaveBeenCalled()
    expect(officialHarnessLoginArguments(openClawSelection)).toEqual([
      'models',
      'auth',
      'login',
      '--provider',
      'openai-codex',
    ])
    expect(officialHarnessLoginArguments({ harnessId: 'codex', providerId: 'openai' })).toEqual([
      'login',
      '--device-auth',
    ])
    expect(JSON.stringify(launch.mock.calls)).not.toMatch(/token|secret|api[-_]?key/i)

    await expect(
      gateway.configureAuthentication(
        await request({ ...openClawSelection, providerId: 'unlisted-provider' }),
      ),
    ).rejects.toThrow('不支持 Provider')
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('checks an existing Harness login without reading or returning a token', async () => {
    const { driver, authenticationStatus } = driverFixture()
    const gateway = new NativeModelAuthGateway({ drivers: new HostDriverRegistry([driver]) })
    const selection: HarnessModelSelection = {
      ...openClawSelection,
      credentialRequirement: { method: 'existing-login', credentialKind: 'harness-session' },
    }
    const input = await request(selection)

    await expect(gateway.authenticationStatus(input)).resolves.toMatchObject({
      state: 'credential-valid',
      authMethod: 'existing-login',
    })
    expect(authenticationStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        selection,
        credential: { kind: 'harness-login' },
        cwd: input.cwd,
        stateRoot: path.join(input.cwd, '.agent-stack-local'),
      }),
    )
    expect(JSON.stringify(authenticationStatus.mock.calls)).not.toMatch(/token|secret|api[-_]?key/i)
  })

  it.each([
    ['credential-invalid', 'credential-invalid'],
    ['credential-expired', 'credential-expired'],
    ['model-forbidden', 'model-forbidden'],
    ['network-failed', 'network-failed'],
    ['operation-cancelled', 'cancelled'],
  ] as const)('maps %s verification failures to %s', async (failureCode, expectedState) => {
    const { driver, verifyModel } = driverFixture()
    verifyModel.mockRejectedValueOnce(
      new HarnessModelError(
        failureCode as ModelAuthFailureCode,
        `failure: ${failureCode}`,
        '修复后重试。',
        true,
      ),
    )
    const gateway = new NativeModelAuthGateway({ drivers: new HostDriverRegistry([driver]) })

    const result = await gateway.verify(await request())

    expect(result).toMatchObject({
      state: expectedState,
      configurationHash: modelAuthConfigurationHash(openClawSelection),
      failure: { code: failureCode },
    })
  })
})
