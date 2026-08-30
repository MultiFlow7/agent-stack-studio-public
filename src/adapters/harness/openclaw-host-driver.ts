import {
  assertCredentialMatchesSelection,
  executableVersion,
  executeMinimumModelCall,
  HarnessModelError,
  minimalChildEnvironment,
  resolveExecutable,
  resolveModelSelection,
  safeHarnessFailure,
  spawnBounded,
  type HarnessHostDriver,
  type HostDriverAuthenticationInput,
  type HostDriverExecuteInput,
  type HostDriverExecuteResult,
} from './host-driver'
import { harnessProbeSchema, type HarnessProbe } from '../../shared/native-agent'
import {
  harnessModelCapability,
  modelAuthenticationStatusSchema,
  type HarnessModelSelection,
  type ModelAuthenticationStatus,
} from '../../shared/model-auth'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CodexSimulationConfig } from './codex-simulation'

const MINIMUM_VERSION = '2026.1.30'
const EXEC_VERSION = '2026.7.1'

function versionParts(version: string | null): number[] {
  return (
    (version ?? '')
      .match(/^\d+(?:\.\d+){2}/)?.[0]
      .split('.')
      .map(Number) ?? []
  )
}

function versionAtLeast(version: string | null, minimum: string): boolean {
  const left = versionParts(version)
  const right = versionParts(minimum)
  if (left.length !== 3) return false
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true
    if (left[index] < right[index]) return false
  }
  return true
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function writeModelConfig(
  configPath: string,
  input: { projectRoot: string; selection: HarnessModelSelection; readOnly: boolean },
): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 })
  const modelRef = `${input.selection.providerId}/${input.selection.modelId}`
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        agents: {
          defaults: {
            workspace: input.projectRoot,
            model: { primary: modelRef },
            models: { [modelRef]: {} },
          },
        },
        ...(input.readOnly ? { tools: { allow: ['read'], deny: ['write', 'edit', 'bash'] } } : {}),
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
}

export class OpenClawHostDriver implements HarnessHostDriver {
  readonly id = 'openclaw' as const
  readonly modelCapability = harnessModelCapability(this.id)
  readonly #executable: string
  readonly #simulation: CodexSimulationConfig | null

  constructor(options: { executable?: string; simulation?: CodexSimulationConfig | null } = {}) {
    this.#executable = options.executable ?? 'openclaw'
    this.#simulation = options.simulation ?? null
  }

  async probe(): Promise<HarnessProbe> {
    const executable = await resolveExecutable(this.#executable)
    if (!executable) {
      return harnessProbeSchema.parse({
        id: this.id,
        label: 'OpenClaw',
        executable: this.#executable,
        status: 'not-installed',
        version: null,
        requiredVersion: `>=${MINIMUM_VERSION}`,
        capabilities: {
          prompt: 'adapted',
          skills: 'adapted',
          memory: 'adapted',
          mcp: 'unavailable',
          sessions: 'native',
        },
        detail: '未找到 openclaw。',
      })
    }
    const version = await executableVersion(executable, process.cwd())
    const supported = versionAtLeast(version, MINIMUM_VERSION)
    return harnessProbeSchema.parse({
      id: this.id,
      label: 'OpenClaw',
      executable,
      status: supported ? 'ready' : 'unsupported-version',
      version,
      requiredVersion: `>=${MINIMUM_VERSION}`,
      capabilities: {
        prompt: versionAtLeast(version, EXEC_VERSION) ? 'native' : 'adapted',
        skills: versionAtLeast(version, EXEC_VERSION) ? 'native' : 'adapted',
        memory: versionAtLeast(version, EXEC_VERSION) ? 'native' : 'adapted',
        mcp: 'unavailable',
        sessions: 'native',
      },
      detail: supported
        ? this.#simulation
          ? 'OpenClaw 原生 agent 入口可用；测试模型层明确使用 loopback Codex simulation。'
          : versionAtLeast(version, EXEC_VERSION)
            ? 'OpenClaw agent exec 隔离运行入口可用；当前 Driver 不消费 Profile MCP 配置。'
            : '使用兼容的 agent --local 入口；Prompt/Skill/Memory 以消息上下文适配。'
        : `检测到 ${version ?? '未知版本'}，最低需要 ${MINIMUM_VERSION}。`,
    })
  }

  async authenticationStatus(
    input: HostDriverAuthenticationInput,
  ): Promise<ModelAuthenticationStatus> {
    const selection = resolveModelSelection(this.id, input.selection)
    assertCredentialMatchesSelection(selection, input.credential)
    const checkedAt = new Date().toISOString()
    const probe = await this.probe()
    if (probe.status !== 'ready') {
      const notInstalled = probe.status === 'not-installed'
      const failure = new HarnessModelError(
        notInstalled ? 'harness-not-installed' : 'harness-version-unsupported',
        probe.detail,
        notInstalled
          ? `安装 OpenClaw ${MINIMUM_VERSION} 或更高的受支持版本。`
          : `切换到 OpenClaw ${MINIMUM_VERSION} 或更高的受支持版本。`,
        false,
      ).failure
      return modelAuthenticationStatusSchema.parse({
        harnessId: this.id,
        providerId: selection.providerId,
        authMethod: selection.credentialRequirement.method,
        state: 'unavailable',
        detail: failure.message,
        checkedAt,
        failure,
      })
    }
    const configPath = path.join(input.stateRoot, 'openclaw-model-auth', 'status.json')
    await writeModelConfig(configPath, {
      projectRoot: input.cwd,
      selection,
      readOnly: true,
    })
    const processResult = await spawnBounded(probe.executable, ['models', 'status', '--json'], {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      env: minimalChildEnvironment({ OPENCLAW_CONFIG_PATH: configPath }),
    })
    if (processResult.cancelled) {
      const failure = new HarnessModelError(
        'operation-cancelled',
        'OpenClaw 认证状态检查已取消。',
        '准备好后重新检查认证状态。',
        true,
      ).failure
      return modelAuthenticationStatusSchema.parse({
        harnessId: this.id,
        providerId: selection.providerId,
        authMethod: selection.credentialRequirement.method,
        state: 'cancelled',
        detail: failure.message,
        checkedAt,
        failure,
      })
    }
    if (processResult.timedOut || processResult.exitCode !== 0) {
      const failure = processResult.timedOut
        ? new HarnessModelError(
            'operation-timed-out',
            'OpenClaw 认证状态检查超时。',
            '检查本机 OpenClaw 后重试。',
            true,
          )
        : safeHarnessFailure(processResult.stderr)
      return modelAuthenticationStatusSchema.parse({
        harnessId: this.id,
        providerId: selection.providerId,
        authMethod: selection.credentialRequirement.method,
        state: 'unavailable',
        detail: failure.message,
        checkedAt,
        failure: failure.failure,
      })
    }
    let envelope: {
      auth?: {
        providers?: Array<{ provider?: unknown; id?: unknown }>
        providersWithOAuth?: unknown[]
        missingProvidersInUse?: unknown[]
        unusableProfiles?: Array<{ provider?: unknown; reason?: unknown }>
        oauth?: { providers?: Array<{ provider?: unknown; status?: unknown }> }
      }
    }
    try {
      envelope = JSON.parse(processResult.stdout) as typeof envelope
    } catch {
      const failure = safeHarnessFailure(processResult.stderr)
      return modelAuthenticationStatusSchema.parse({
        harnessId: this.id,
        providerId: selection.providerId,
        authMethod: selection.credentialRequirement.method,
        state: 'unavailable',
        detail: failure.message,
        checkedAt,
        failure: failure.failure,
      })
    }
    const auth = envelope.auth
    const oauthProvider = auth?.oauth?.providers?.find(
      ({ provider }) => provider === selection.providerId,
    )
    const unusable = auth?.unusableProfiles?.find(
      ({ provider }) => provider === selection.providerId,
    )
    const missing =
      auth?.missingProvidersInUse?.includes(selection.providerId) ||
      oauthProvider?.status === 'missing'
    const expired =
      oauthProvider?.status === 'expired' ||
      stringOrEmpty(unusable?.reason).toLocaleLowerCase('en-US').includes('expired')
    const valid =
      !missing &&
      !unusable &&
      (auth?.providers?.some(
        ({ provider, id }) => provider === selection.providerId || id === selection.providerId,
      ) ||
        auth?.providersWithOAuth?.includes(selection.providerId) ||
        ['ready', 'valid', 'ok'].includes(stringOrEmpty(oauthProvider?.status)))
    const state = valid
      ? 'credential-valid'
      : expired
        ? 'credential-expired'
        : unusable
          ? 'credential-invalid'
          : 'not-configured'
    const failure = valid
      ? null
      : new HarnessModelError(
          expired
            ? 'credential-expired'
            : unusable
              ? 'credential-invalid'
              : 'authentication-required',
          expired
            ? 'OpenClaw 登录已过期。'
            : unusable
              ? 'OpenClaw 无法使用当前登录。'
              : 'OpenClaw 尚未登录所选 Provider。',
          '重新运行该 Provider 的 OpenClaw 官方登录流程。',
          true,
        ).failure
    return modelAuthenticationStatusSchema.parse({
      harnessId: this.id,
      providerId: selection.providerId,
      authMethod: selection.credentialRequirement.method,
      state,
      detail: valid ? 'OpenClaw 已识别所选 Provider 的本机登录。' : failure!.message,
      checkedAt,
      failure,
    })
  }

  verifyModel(input: HostDriverAuthenticationInput): Promise<HostDriverExecuteResult> {
    return executeMinimumModelCall(this, input)
  }

  async execute(input: HostDriverExecuteInput): Promise<HostDriverExecuteResult> {
    const probe = await this.probe()
    if (probe.status !== 'ready') throw new Error(probe.detail)
    // `agent exec` is deliberately one-shot. Chats keep OpenClaw's native session path.
    const modernExec = input.kind === 'run' && versionAtLeast(probe.version, EXEC_VERSION)
    const selection = this.#simulation ? null : resolveModelSelection(this.id, input.model)
    if (selection) assertCredentialMatchesSelection(selection, input.credential)
    const enabledSkills = input.profile.skills.filter(({ enabled }) => enabled)
    const profileContext = [
      input.profile.instructions ? `# Agent instructions\n${input.profile.instructions}` : '',
      input.profile.memoryMarkdown ? `# Markdown memory\n${input.profile.memoryMarkdown}` : '',
      ...enabledSkills.map(({ name, markdown }) => `# Skill: ${name}\n${markdown}`),
    ]
      .filter(Boolean)
      .join('\n\n')
    const message = profileContext
      ? `${profileContext}\n\n# User message\n${input.message}`
      : input.message
    const timeoutSeconds = Math.max(1, Math.ceil(input.timeoutMs / 1_000))
    const simulationStateDirectory = path.join(
      input.stateRoot,
      'codex-simulation',
      'openclaw-state',
    )
    const simulationConfigPath = path.join(simulationStateDirectory, 'openclaw.json')
    if (this.#simulation) {
      await mkdir(simulationStateDirectory, { recursive: true, mode: 0o700 })
      await writeFile(
        simulationConfigPath,
        `${JSON.stringify(
          {
            agents: {
              defaults: {
                workspace: input.projectRoot,
                model: {
                  primary: `${this.#simulation.providerId}/${this.#simulation.modelId}`,
                },
                models: {
                  [`${this.#simulation.providerId}/${this.#simulation.modelId}`]: {},
                },
              },
            },
            models: {
              mode: 'replace',
              providers: {
                [this.#simulation.providerId]: {
                  baseUrl: this.#simulation.endpoint,
                  apiKey: '$STUDIO_CODEX_SIMULATION_KEY',
                  api: 'openai-completions',
                  models: [
                    {
                      id: this.#simulation.modelId,
                      name: 'Codex simulation (test only)',
                      reasoning: false,
                      input: ['text'],
                      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                      contextWindow: 128_000,
                      maxTokens: 8_192,
                    },
                  ],
                },
              },
            },
            tools: { allow: [], deny: ['*'] },
          },
          null,
          2,
        )}\n`,
        { encoding: 'utf8', mode: 0o600 },
      )
    }
    const modelConfigPath = path.join(input.stateRoot, 'openclaw-model-auth', 'openclaw.json')
    if (selection) {
      await writeModelConfig(modelConfigPath, {
        projectRoot: input.projectRoot,
        selection,
        readOnly: input.profile.toolPolicy !== 'workspace',
      })
    }
    const modelRef = selection ? `${selection.providerId}/${selection.modelId}` : null
    const args = modernExec
      ? [
          'agent',
          'exec',
          message,
          ...(modelRef ? ['--model', modelRef] : []),
          '--cwd',
          input.projectRoot,
          '--timeout',
          String(timeoutSeconds),
          '--json',
        ]
      : [
          'agent',
          '--local',
          '--session-id',
          input.sessionId,
          '--message',
          message,
          '--timeout',
          String(timeoutSeconds),
          '--json',
        ]
    const processResult = await spawnBounded(probe.executable, args, {
      cwd: input.projectRoot,
      timeoutMs: input.timeoutMs + 2_000,
      signal: input.signal,
      env: minimalChildEnvironment(
        this.#simulation
          ? {
              OPENCLAW_STATE_DIR: simulationStateDirectory,
              OPENCLAW_CONFIG_PATH: simulationConfigPath,
              STUDIO_CODEX_SIMULATION_KEY: this.#simulation.apiKey,
            }
          : { OPENCLAW_CONFIG_PATH: modelConfigPath },
      ),
    })
    if (processResult.timedOut) {
      throw new HarnessModelError(
        'operation-timed-out',
        'Harness 运行超时并已终止。',
        '检查网络后重试。',
        true,
      )
    }
    if (processResult.cancelled) {
      throw new HarnessModelError(
        'operation-cancelled',
        'Harness 运行已取消。',
        '准备好后重新运行。',
        true,
      )
    }
    let envelope: Record<string, unknown>
    try {
      envelope = JSON.parse(processResult.stdout) as Record<string, unknown>
    } catch {
      throw safeHarnessFailure(processResult.stderr)
    }
    if (processResult.exitCode !== 0) {
      const error = envelope.error as { message?: unknown } | undefined
      throw safeHarnessFailure(`${stringOrEmpty(error?.message)}\n${processResult.stderr}`)
    }
    const payloads = Array.isArray(envelope.payloads)
      ? envelope.payloads
      : Array.isArray((envelope.result as { payloads?: unknown } | undefined)?.payloads)
        ? ((envelope.result as { payloads: unknown[] }).payloads ?? [])
        : []
    const responseMarkdown =
      typeof envelope.final === 'string'
        ? envelope.final
        : payloads
            .flatMap((payload) =>
              payload && typeof payload === 'object' && 'text' in payload
                ? [stringOrEmpty((payload as { text?: unknown }).text)]
                : [],
            )
            .join('\n')
    if (!responseMarkdown) throw new Error('OpenClaw 未返回可显示的回复。')
    const usage = (envelope.usage ?? {}) as Record<string, unknown>
    return {
      harnessVersion: probe.version!,
      responseMarkdown,
      usage: {
        inputTokens: numberOrNull(usage.input ?? usage.inputTokens),
        outputTokens: numberOrNull(usage.output ?? usage.outputTokens),
        totalTokens: numberOrNull(usage.total ?? usage.totalTokens),
      },
      modelLayer: this.#simulation
        ? {
            kind: 'codex-simulation',
            provider: this.#simulation.providerId,
            model: this.#simulation.modelId,
          }
        : {
            kind: 'harness-provider',
            provider: selection!.providerId,
            model: selection!.modelId,
          },
      degradedFeatures: [
        ...(this.#simulation
          ? [
              '测试模式：OpenClaw 由 loopback Codex simulation 提供模型响应；工具全部禁用，不计作 OpenClaw 原生 Provider 认证。',
            ]
          : []),
        ...(!this.#simulation &&
        !modernExec &&
        (profileContext || input.profile.toolPolicy === 'read-only')
          ? [
              '当前 OpenClaw 版本使用兼容入口；Profile 通过 Prompt 适配，工具权限沿用本机 OpenClaw 配置。',
            ]
          : []),
        ...(input.profile.mcpServers.some(({ enabled }) => enabled)
          ? ['当前 OpenClaw Driver 不消费 Profile MCP 配置；请移除或切换 Pi。']
          : []),
      ],
    }
  }
}
