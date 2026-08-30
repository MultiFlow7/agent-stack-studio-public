import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { HostDriverRegistry } from '../../adapters/harness/host-driver-registry'
import {
  HarnessModelError,
  minimalChildEnvironment,
  spawnBounded,
  type HostDriverCredential,
} from '../../adapters/harness/host-driver'
import {
  assertSupportedModelSelection,
  modelAuthenticationStatusSchema,
  modelVerificationStatusSchema,
  type ModelAuthFailure,
  type ModelVerificationStatus,
} from '../../shared/model-auth'
import {
  modelAuthConfigurationHash,
  type ModelAuthGateway,
  type ModelAuthGatewayRequest,
} from './model-auth-service'

export interface OfficialHarnessLoginLauncher {
  launch(input: {
    harnessId: ModelAuthGatewayRequest['selection']['harnessId']
    providerId: string
    executable: string
  }): Promise<void>
}

export function officialHarnessLoginArguments(input: {
  harnessId: ModelAuthGatewayRequest['selection']['harnessId']
  providerId: string
}): string[] {
  if (input.harnessId === 'codex') return ['login', '--device-auth']
  if (input.harnessId === 'openclaw') {
    return ['models', 'auth', 'login', '--provider', input.providerId]
  }
  return ['/login', input.providerId]
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export class MacOsTerminalLoginLauncher implements OfficialHarnessLoginLauncher {
  async launch(input: {
    harnessId: ModelAuthGatewayRequest['selection']['harnessId']
    providerId: string
    executable: string
  }): Promise<void> {
    const fixedArguments = officialHarnessLoginArguments(input)
    const command = [input.executable, ...fixedArguments].map(shellQuote).join(' ')
    const script = [
      'on run argv',
      'tell application "Terminal"',
      'activate',
      'do script (item 1 of argv)',
      'end tell',
      'end run',
    ].join('\n')
    const result = await spawnBounded('/usr/bin/osascript', ['-e', script, '--', command], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
      env: minimalChildEnvironment(),
    })
    if (result.exitCode !== 0 || result.timedOut || result.cancelled) {
      throw new HarnessModelError(
        'harness-failed',
        '无法启动 Harness 官方登录入口。',
        '检查 Terminal 自动化权限后重试。',
        true,
      )
    }
  }
}

function driverCredential(request: ModelAuthGatewayRequest): HostDriverCredential {
  return request.credential.kind === 'api-key'
    ? { kind: 'api-key', value: request.credential.value }
    : { kind: 'harness-login' }
}

function verificationFailure(
  state: Exclude<
    ModelVerificationStatus['state'],
    'not-run' | 'verifying' | 'minimal-call-succeeded'
  >,
  failure: ModelAuthFailure,
  configurationHash: string,
): ModelVerificationStatus {
  return modelVerificationStatusSchema.parse({
    state,
    configurationHash,
    checkedAt: new Date().toISOString(),
    failure,
  })
}

export class NativeModelAuthGateway implements ModelAuthGateway {
  readonly #drivers: HostDriverRegistry
  readonly #loginLauncher: OfficialHarnessLoginLauncher

  constructor(options: {
    drivers: HostDriverRegistry
    loginLauncher?: OfficialHarnessLoginLauncher
  }) {
    this.#drivers = options.drivers
    this.#loginLauncher = options.loginLauncher ?? new MacOsTerminalLoginLauncher()
  }

  probe(harnessId: ModelAuthGatewayRequest['selection']['harnessId']) {
    return this.#drivers.get(harnessId).probe()
  }

  async configureAuthentication(request: ModelAuthGatewayRequest) {
    assertSupportedModelSelection(request.selection)
    if (request.selection.credentialRequirement.method !== 'official-login') {
      return this.authenticationStatus(request)
    }
    const probe = await this.#drivers.get(request.selection.harnessId).probe()
    if (probe.status !== 'ready') {
      return this.authenticationStatus(request)
    }
    await this.#loginLauncher.launch({
      harnessId: request.selection.harnessId,
      providerId: request.selection.providerId,
      executable: probe.executable,
    })
    return modelAuthenticationStatusSchema.parse({
      harnessId: request.selection.harnessId,
      providerId: request.selection.providerId,
      authMethod: request.selection.credentialRequirement.method,
      state: 'checking',
      detail: '已启动 Harness 官方登录入口；完成后返回 Studio 检查状态。',
      checkedAt: new Date().toISOString(),
      failure: null,
    })
  }

  async authenticationStatus(request: ModelAuthGatewayRequest) {
    assertSupportedModelSelection(request.selection)
    const stateRoot = path.join(request.cwd, '.agent-stack-local')
    await mkdir(stateRoot, { recursive: true, mode: 0o700 })
    return this.#drivers.get(request.selection.harnessId).authenticationStatus({
      selection: request.selection,
      credential: driverCredential(request),
      cwd: request.cwd,
      stateRoot,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
    })
  }

  async verify(request: ModelAuthGatewayRequest): Promise<ModelVerificationStatus> {
    assertSupportedModelSelection(request.selection)
    const configurationHash = modelAuthConfigurationHash(request.selection)
    const stateRoot = path.join(request.cwd, '.agent-stack-local')
    await mkdir(stateRoot, { recursive: true, mode: 0o700 })
    try {
      await this.#drivers.get(request.selection.harnessId).verifyModel({
        selection: request.selection,
        credential: driverCredential(request),
        cwd: request.cwd,
        stateRoot,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      })
      return modelVerificationStatusSchema.parse({
        state: 'minimal-call-succeeded',
        configurationHash,
        checkedAt: new Date().toISOString(),
        failure: null,
      })
    } catch (error) {
      const failure =
        error instanceof HarnessModelError
          ? error.failure
          : {
              code: 'harness-failed' as const,
              message: 'Harness 最小模型调用失败。',
              recoveryAction: '检查 Harness 后重试。',
              retryable: true,
            }
      const state =
        failure.code === 'credential-invalid'
          ? 'credential-invalid'
          : failure.code === 'authentication-required'
            ? 'credential-invalid'
            : failure.code === 'credential-expired'
              ? 'credential-expired'
              : failure.code === 'model-forbidden'
                ? 'model-forbidden'
                : failure.code === 'operation-cancelled'
                  ? 'cancelled'
                  : failure.code === 'network-failed' || failure.code === 'operation-timed-out'
                    ? 'network-failed'
                    : null
      if (!state) throw error
      return verificationFailure(state, failure, configurationHash)
    }
  }
}
