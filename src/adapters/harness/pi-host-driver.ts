import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
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
import type { CodexSimulationConfig } from './codex-simulation'

const REQUIRED_VERSION = '0.84.2'

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
          mcp: 'unavailable',
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
        mcp: 'unavailable',
        sessions: 'native',
      },
      detail:
        version === REQUIRED_VERSION
          ? this.#simulation
            ? 'Pi JSONL、session 与 Skill 原生入口可用；测试模型层明确使用 loopback Codex simulation。'
            : 'Pi JSONL、session-id 与 Skill 原生入口可用；Markdown Memory 追加到系统上下文。'
          : `检测到 ${version ?? '未知版本'}，需要固定版本 ${REQUIRED_VERSION}。`,
    })
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
            '--api-key',
            this.#simulation.apiKey,
            '--no-tools',
          ]
        : [
            '--tools',
            input.profile.toolPolicy === 'workspace'
              ? 'read,bash,edit,write,grep,find,ls'
              : 'read,grep,find,ls',
          ]),
    ]
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

    const processResult = await spawnBounded(probe.executable, args, {
      cwd: input.projectRoot,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      ...(this.#simulation
        ? { env: { ...process.env, PI_CODING_AGENT_DIR: simulationDirectory } }
        : {}),
    })
    if (processResult.timedOut) throw new Error('Harness 运行超时并已终止。')
    if (processResult.cancelled) throw new Error('Harness 运行已取消。')
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
        : { kind: 'harness-provider', provider: 'pi-configured-provider', model: null },
      degradedFeatures: [
        ...(this.#simulation
          ? [
              '测试模式：Pi 由 loopback Codex simulation 提供模型响应；工具全部禁用，不计作 Pi 原生 Provider 认证。',
            ]
          : []),
        ...(input.profile.mcpServers.some(({ enabled }) => enabled)
          ? ['Pi 0.84.2 没有稳定的原生 MCP 配置入口；MCP 配置未执行。']
          : []),
      ],
    }
  }
}
