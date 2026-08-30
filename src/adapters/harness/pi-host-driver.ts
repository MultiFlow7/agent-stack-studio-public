import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  executableVersion,
  executeMinimumModelCall,
  assertCredentialMatchesSelection,
  assertNoSecretLeak,
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
  type ModelAuthenticationStatus,
} from '../../shared/model-auth'
import type { CodexSimulationConfig } from './codex-simulation'

const REQUIRED_VERSION = '0.84.2'
const API_KEY_ENVIRONMENT = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
} as const

function textFromMessage(message: unknown): string {
  if (!message || typeof message !== 'object' || !('content' in message)) return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((item) =>
      item && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
        ? [
            typeof (item as { text?: unknown }).text === 'string'
              ? (item as { text: string }).text
              : '',
          ]
        : [],
    )
    .join('')
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export class PiHostDriver implements HarnessHostDriver {
  readonly id = 'pi' as const
  readonly modelCapability = harnessModelCapability(this.id)
  readonly #executable: string
  readonly #simulation: CodexSimulationConfig | null

  constructor(options: { executable?: string; simulation?: CodexSimulationConfig | null } = {}) {
    this.#executable = options.executable ?? 'pi'
    this.#simulation = options.simulation ?? null
  }

  async probe(): Promise<HarnessProbe> {
    const executable = await resolveExecutable(this.#executable)
    if (!executable) {
      return harnessProbeSchema.parse({
        id: this.id,
        label: 'Pi',
        executable: this.#executable,
        status: 'not-installed',
        version: null,
        requiredVersion: REQUIRED_VERSION,
        capabilities: {
          prompt: 'native',
          skills: 'native',
          memory: 'adapted',
          mcp: 'adapted',
          sessions: 'native',
        },
        detail: `未找到 pi；固定安装版本为 ${REQUIRED_VERSION}。`,
      })
    }
    const version = await executableVersion(executable, process.cwd())
    return harnessProbeSchema.parse({
      id: this.id,
      label: 'Pi',
      executable,
      status: version === REQUIRED_VERSION ? 'ready' : 'unsupported-version',
      version,
      requiredVersion: REQUIRED_VERSION,
      capabilities: {
        prompt: 'native',
        skills: 'native',
        memory: 'adapted',
        mcp: 'adapted',
        sessions: 'native',
      },
      detail:
        version === REQUIRED_VERSION
          ? this.#simulation
            ? 'Pi JSONL、session 与 Skill 原生入口可用；测试模型层明确使用 loopback Codex simulation。'
            : 'Pi JSONL、session-id 与 Skill 原生入口可用；MCP 由 Studio Native Runtime 受控适配 stdio/HTTP。'
          : `检测到 ${version ?? '未知版本'}，需要固定版本 ${REQUIRED_VERSION}。`,
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
          ? `安装 Pi ${REQUIRED_VERSION}。`
          : `切换到固定支持的 Pi ${REQUIRED_VERSION}。`,
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
    const apiKey = input.credential?.kind === 'api-key' ? input.credential.value : undefined
    const apiKeyEnvironment =
      API_KEY_ENVIRONMENT[selection.providerId as keyof typeof API_KEY_ENVIRONMENT]
    if (apiKey && !apiKeyEnvironment) {
      throw new HarnessModelError(
        'harness-failed',
        'Pi Provider 没有受控的 API Key 环境变量映射。',
        '选择 Studio allowlist 中支持 API Key 的 Provider。',
        false,
      )
    }
    const isolatedAuthDirectory = path.join(input.stateRoot, 'pi-model-auth')
    if (apiKey) await mkdir(isolatedAuthDirectory, { recursive: true, mode: 0o700 })
    const args = [
      'auth',
      'check',
      '--provider',
      selection.providerId,
      '--model',
      selection.modelId,
      '--json',
      '--no-refresh',
    ]
    assertNoSecretLeak(apiKey, { args })
    const processResult = await spawnBounded(probe.executable, args, {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      env: minimalChildEnvironment({
        ...(apiKeyEnvironment && apiKey ? { [apiKeyEnvironment]: apiKey } : {}),
        ...(apiKey ? { PI_CODING_AGENT_DIR: isolatedAuthDirectory } : {}),
      }),
    })
    assertNoSecretLeak(apiKey, processResult)
    if (processResult.cancelled) {
      return modelAuthenticationStatusSchema.parse({
        harnessId: this.id,
        providerId: selection.providerId,
        authMethod: selection.credentialRequirement.method,
        state: 'cancelled',
        detail: 'Pi 认证状态检查已取消。',
        checkedAt,
        failure: new HarnessModelError(
          'operation-cancelled',
          'Pi 认证状态检查已取消。',
          '准备好后重新检查认证状态。',
          true,
        ).failure,
      })
    }
    if (processResult.timedOut || processResult.exitCode !== 0) {
      const failure = processResult.timedOut
        ? new HarnessModelError(
            'operation-timed-out',
            'Pi 认证状态检查超时。',
            '检查本机 Pi 后重试。',
            true,
          )
        : safeHarnessFailure(processResult.stderr)
      return modelAuthenticationStatusSchema.parse({
        harnessId: this.id,
        providerId: selection.providerId,
        authMethod: selection.credentialRequirement.method,
        state:
          failure.failure.code === 'credential-expired'
            ? 'credential-expired'
            : failure.failure.code === 'credential-invalid'
              ? 'credential-invalid'
              : 'unavailable',
        detail: failure.message,
        checkedAt,
        failure: failure.failure,
      })
    }
    let status: { status?: unknown; reason?: unknown }
    try {
      status = JSON.parse(processResult.stdout) as { status?: unknown; reason?: unknown }
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
    const ready = status.status === 'ready'
    return modelAuthenticationStatusSchema.parse({
      harnessId: this.id,
      providerId: selection.providerId,
      authMethod: selection.credentialRequirement.method,
      state: ready
        ? 'credential-valid'
        : status.status === 'invalid'
          ? 'credential-invalid'
          : 'not-configured',
      detail: ready
        ? 'Pi 已确认所选 Provider 的凭证可解析。'
        : status.reason === 'credentials_not_configured'
          ? 'Pi 未找到所选 Provider 的凭证。'
          : 'Pi 无法确认所选 Provider 的凭证状态。',
      checkedAt,
      failure: ready
        ? null
        : new HarnessModelError(
            status.status === 'invalid' ? 'credential-invalid' : 'authentication-required',
            status.status === 'invalid' ? 'Pi 无法解析当前凭证。' : 'Pi 尚未配置当前 Provider。',
            status.status === 'invalid'
              ? '更新 API Key 或重新登录 Pi。'
              : '配置 API Key 或复用 Pi 登录。',
            true,
          ).failure,
    })
  }

  verifyModel(input: HostDriverAuthenticationInput): Promise<HostDriverExecuteResult> {
    return executeMinimumModelCall(this, input)
  }

  async execute(input: HostDriverExecuteInput): Promise<HostDriverExecuteResult> {
    const probe = await this.probe()
    if (probe.status !== 'ready') throw new Error(probe.detail)
    const sessionDirectory = path.join(input.stateRoot, 'pi-sessions')
    const profileDirectory = path.join(input.stateRoot, 'pi-profile')
    await mkdir(sessionDirectory, { recursive: true, mode: 0o700 })
    await mkdir(profileDirectory, { recursive: true, mode: 0o700 })

    const simulationDirectory = path.join(input.stateRoot, 'codex-simulation', 'pi-agent')
    if (this.#simulation) {
      await mkdir(simulationDirectory, { recursive: true, mode: 0o700 })
      await writeFile(
        path.join(simulationDirectory, 'models.json'),
        `${JSON.stringify(
          {
            providers: {
              [this.#simulation.providerId]: {
                baseUrl: this.#simulation.endpoint,
                api: 'openai-completions',
                apiKey: '$STUDIO_CODEX_SIMULATION_KEY',
                models: [
                  {
                    id: this.#simulation.modelId,
                    name: 'Codex simulation (test only)',
                    reasoning: false,
                    input: ['text'],
                    contextWindow: 128_000,
                    maxTokens: 8_192,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
                  },
                ],
              },
            },
          },
          null,
          2,
        )}\n`,
        { encoding: 'utf8', mode: 0o600 },
      )
    }

    const args = [
      '--mode',
      'json',
      '--print',
      '--session-id',
      input.sessionId,
      '--session-dir',
      sessionDirectory,
      '--no-extensions',
      '--no-prompt-templates',
      '--no-context-files',
      '--no-approve',
      ...(this.#simulation
        ? [
            '--provider',
            this.#simulation.providerId,
            '--model',
            this.#simulation.modelId,
            '--no-tools',
          ]
        : [
            '--tools',
            input.profile.toolPolicy === 'workspace'
              ? 'read,bash,edit,write,grep,find,ls'
              : 'read,grep,find,ls',
          ]),
    ]
    const selection = this.#simulation ? null : resolveModelSelection(this.id, input.model)
    if (selection) {
      assertCredentialMatchesSelection(selection, input.credential)
      args.push('--provider', selection.providerId, '--model', selection.modelId)
    }
    if (input.profile.instructions) args.push('--system-prompt', input.profile.instructions)
    if (input.profile.memoryMarkdown) {
      const memoryPath = path.join(profileDirectory, 'MEMORY.md')
      await writeFile(memoryPath, input.profile.memoryMarkdown, { encoding: 'utf8', mode: 0o600 })
      args.push('--append-system-prompt', memoryPath)
    }
    for (const skill of input.profile.skills.filter(({ enabled }) => enabled)) {
      const skillDirectory = path.join(profileDirectory, 'skills', skill.id)
      await mkdir(skillDirectory, { recursive: true, mode: 0o700 })
      const skillPath = path.join(skillDirectory, 'SKILL.md')
      await writeFile(skillPath, skill.markdown, { encoding: 'utf8', mode: 0o600 })
      args.push('--skill', skillPath)
    }
    args.push(input.message)

    const apiKey = input.credential?.kind === 'api-key' ? input.credential.value : undefined
    const apiKeyEnvironment = selection
      ? API_KEY_ENVIRONMENT[selection.providerId as keyof typeof API_KEY_ENVIRONMENT]
      : undefined
    if (apiKey && !apiKeyEnvironment) {
      throw new HarnessModelError(
        'harness-failed',
        'Pi Provider 没有受控的 API Key 环境变量映射。',
        '选择 Studio allowlist 中支持 API Key 的 Provider。',
        false,
      )
    }
    const isolatedAuthDirectory = path.join(input.stateRoot, 'pi-model-auth')
    if (apiKey) await mkdir(isolatedAuthDirectory, { recursive: true, mode: 0o700 })
    assertNoSecretLeak(apiKey, { args })
    const processResult = await spawnBounded(probe.executable, args, {
      cwd: input.projectRoot,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      env: minimalChildEnvironment(
        this.#simulation
          ? {
              PI_CODING_AGENT_DIR: simulationDirectory,
              STUDIO_CODEX_SIMULATION_KEY: this.#simulation.apiKey,
            }
          : {
              ...(apiKeyEnvironment && apiKey ? { [apiKeyEnvironment]: apiKey } : {}),
              ...(apiKey ? { PI_CODING_AGENT_DIR: isolatedAuthDirectory } : {}),
            },
      ),
    })
    assertNoSecretLeak(apiKey, processResult)
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
    const events = processResult.stdout
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>]
        } catch {
          return []
        }
      })
    const messageEvents = events.filter(({ type }) => type === 'message_end')
    const finalEvent = [...messageEvents].reverse().find(({ message }) => textFromMessage(message))
    if (processResult.exitCode !== 0 || !finalEvent) throw safeHarnessFailure(processResult.stderr)
    const usageSource =
      [...events].reverse().find(({ usage }) => usage && typeof usage === 'object')?.usage ?? {}
    const usage = usageSource as Record<string, unknown>
    const inputTokens = numberOrNull(usage.input ?? usage.inputTokens)
    const outputTokens = numberOrNull(usage.output ?? usage.outputTokens)
    return {
      harnessVersion: probe.version!,
      responseMarkdown: textFromMessage(finalEvent.message),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          numberOrNull(usage.total ?? usage.totalTokens) ??
          (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
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
              '测试模式：Pi 由 loopback Codex simulation 提供模型响应；工具全部禁用，不计作 Pi 原生 Provider 认证。',
            ]
          : []),
      ],
    }
  }
}
