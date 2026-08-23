import {
  executableVersion,
  resolveExecutable,
  safeHarnessFailure,
  spawnBounded,
  type HarnessHostDriver,
  type HostDriverExecuteInput,
  type HostDriverExecuteResult,
} from './host-driver'
import { harnessProbeSchema, type HarnessProbe } from '../../shared/native-agent'
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

export class OpenClawHostDriver implements HarnessHostDriver {
  readonly id = 'openclaw' as const
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
          mcp: 'adapted',
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
        mcp: 'adapted',
        sessions: 'native',
      },
      detail: supported
        ? this.#simulation
          ? 'OpenClaw 原生 agent 入口可用；测试模型层明确使用 loopback Codex simulation。'
          : versionAtLeast(version, EXEC_VERSION)
            ? 'OpenClaw agent exec 隔离运行入口可用；项目 MCP 仍仅匹配本机配置。'
            : '使用兼容的 agent --local 入口；Prompt/Skill/Memory 以消息上下文适配。'
        : `检测到 ${version ?? '未知版本'}，最低需要 ${MINIMUM_VERSION}。`,
    })
  }

  async execute(input: HostDriverExecuteInput): Promise<HostDriverExecuteResult> {
    const probe = await this.probe()
    if (probe.status !== 'ready') throw new Error(probe.detail)
    // `agent exec` is deliberately one-shot. Chats keep OpenClaw's native session path.
    const modernExec = input.kind === 'run' && versionAtLeast(probe.version, EXEC_VERSION)
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
                  apiKey: this.#simulation.apiKey,
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
    const args = modernExec
      ? [
          'agent',
          'exec',
          message,
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
      ...(this.#simulation
        ? {
            env: {
              ...process.env,
              OPENCLAW_STATE_DIR: simulationStateDirectory,
              OPENCLAW_CONFIG_PATH: simulationConfigPath,
            },
          }
        : {}),
    })
    if (processResult.timedOut) throw new Error('Harness 运行超时并已终止。')
    if (processResult.cancelled) throw new Error('Harness 运行已取消。')
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
        : { kind: 'harness-provider', provider: 'openclaw-configured-provider', model: null },
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
        ...(input.profile.mcpServers.some(
          ({ enabled, approval }) => enabled && approval === 'approved',
        )
          ? ['MCP 使用 OpenClaw 本机已配置的同名服务；Studio 不写入或复制凭证。']
          : []),
        ...(input.profile.mcpServers.some(
          ({ enabled, approval }) => enabled && approval === 'review-required',
        )
          ? ['未批准的 MCP 配置未执行。']
          : []),
      ],
    }
  }
}
