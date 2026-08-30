import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assertCredentialMatchesSelection,
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
  type ModelAuthenticationStatus,
} from '../../shared/model-auth'

const REQUIRED_VERSION = '0.148.0-alpha.9'

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function parseEvents(output: string): Array<Record<string, unknown>> {
  return output
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line) as unknown
        return event && typeof event === 'object' ? [event as Record<string, unknown>] : []
      } catch {
        return []
      }
    })
}

function responseFromEvents(events: Array<Record<string, unknown>>): string {
  return (
    events
      .flatMap((event) => {
        if (event.type !== 'item.completed' || !event.item || typeof event.item !== 'object')
          return []
        const item = event.item as { type?: unknown; text?: unknown }
        return item.type === 'agent_message' && typeof item.text === 'string' ? [item.text] : []
      })
      .at(-1) ?? ''
  )
}

async function readThreadId(mappingPath: string): Promise<string> {
  try {
    return (await readFile(mappingPath, 'utf8')).trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

export class CodexHostDriver implements HarnessHostDriver {
  readonly id = 'codex' as const
  readonly modelCapability = harnessModelCapability(this.id)
  readonly #executable: string

  constructor(options: { executable?: string } = {}) {
    this.#executable = options.executable ?? 'codex'
  }

  async probe(): Promise<HarnessProbe> {
    const executable = await resolveExecutable(this.#executable)
    if (!executable) {
      return harnessProbeSchema.parse({
        id: this.id,
        label: 'Codex CLI',
        executable: this.#executable,
        status: 'not-installed',
        version: null,
        requiredVersion: REQUIRED_VERSION,
        capabilities: {
          prompt: 'native',
          skills: 'adapted',
          memory: 'adapted',
          mcp: 'unavailable',
          sessions: 'native',
        },
        detail: `未找到 codex；固定验证版本为 ${REQUIRED_VERSION}。`,
      })
    }
    const result = await spawnBounded(executable, ['--version'], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
      env: minimalChildEnvironment(),
    })
    const version = result.stdout.match(/codex-cli\s+(\S+)/)?.[1] ?? null
    return harnessProbeSchema.parse({
      id: this.id,
      label: 'Codex CLI',
      executable,
      status: version === REQUIRED_VERSION ? 'ready' : 'unsupported-version',
      version,
      requiredVersion: REQUIRED_VERSION,
      capabilities: {
        prompt: 'native',
        skills: 'adapted',
        memory: 'adapted',
        mcp: 'unavailable',
        sessions: 'native',
      },
      detail:
        version === REQUIRED_VERSION
          ? 'Codex exec JSONL、resume 与 read-only/workspace-write 沙箱入口可用。'
          : `检测到 ${version ?? '未知版本'}，需要固定版本 ${REQUIRED_VERSION}。`,
    })
  }

  async authenticationStatus(
    input: HostDriverAuthenticationInput,
  ): Promise<ModelAuthenticationStatus> {
    const selection = resolveModelSelection(this.id, input.selection)
    assertCredentialMatchesSelection(selection, input.credential)
    const checkedAt = new Date().toISOString()
    const executable = await resolveExecutable(this.#executable)
    if (!executable) {
      const failure = new HarnessModelError(
        'harness-not-installed',
        '未找到 Codex CLI。',
        `安装固定支持的 Codex CLI ${REQUIRED_VERSION}。`,
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
    const processResult = await spawnBounded(executable, ['login', 'status'], {
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      env: minimalChildEnvironment(),
    })
    if (processResult.cancelled) {
      const failure = new HarnessModelError(
        'operation-cancelled',
        'Codex 登录状态检查已取消。',
        '准备好后重新检查登录状态。',
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
    if (processResult.timedOut) {
      const failure = new HarnessModelError(
        'operation-timed-out',
        'Codex 登录状态检查超时。',
        '检查本机 Codex 后重试。',
        true,
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
    const loggedIn =
      processResult.exitCode === 0 &&
      /\blogged in (?:using|with)\b/i.test(`${processResult.stdout}\n${processResult.stderr}`)
    const failure = loggedIn
      ? null
      : new HarnessModelError(
          'authentication-required',
          'Codex 尚未登录 ChatGPT。',
          '启动 Codex 官方登录，或复用已有 Codex 登录。',
          true,
        ).failure
    return modelAuthenticationStatusSchema.parse({
      harnessId: this.id,
      providerId: selection.providerId,
      authMethod: selection.credentialRequirement.method,
      state: loggedIn ? 'credential-valid' : 'not-configured',
      detail: loggedIn ? 'Codex 官方状态命令确认本机已登录。' : failure!.message,
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
    const selection = resolveModelSelection(this.id, input.model)
    assertCredentialMatchesSelection(selection, input.credential)
    const enabledSkills = input.profile.skills.filter(({ enabled }) => enabled)
    const profileContext = [
      input.profile.instructions ? `# Agent instructions\n${input.profile.instructions}` : '',
      input.profile.memoryMarkdown ? `# Markdown memory\n${input.profile.memoryMarkdown}` : '',
      ...enabledSkills.map(({ name, markdown }) => `# Skill: ${name}\n${markdown}`),
    ]
      .filter(Boolean)
      .join('\n\n')
    const prompt = profileContext
      ? `${profileContext}\n\n# User message\n${input.message}`
      : input.message
    const sessionsRoot = path.join(input.stateRoot, 'codex-sessions')
    const mappingPath = path.join(sessionsRoot, `${input.sessionId}.thread`)
    await mkdir(sessionsRoot, { recursive: true, mode: 0o700 })
    const threadId = input.kind === 'chat' ? await readThreadId(mappingPath) : ''
    const common = [
      '--json',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ignore-rules',
      '--model',
      selection.modelId,
    ]
    const args = threadId
      ? ['exec', 'resume', ...common, threadId, prompt]
      : [
          'exec',
          ...common,
          '--color',
          'never',
          '--sandbox',
          input.profile.toolPolicy === 'workspace' ? 'workspace-write' : 'read-only',
          ...(input.kind === 'run' ? ['--ephemeral'] : []),
          '-C',
          input.projectRoot,
          prompt,
        ]
    const processResult = await spawnBounded(probe.executable, args, {
      cwd: input.projectRoot,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      env: minimalChildEnvironment(),
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
    const events = parseEvents(processResult.stdout)
    if (processResult.exitCode !== 0) throw safeHarnessFailure(processResult.stderr)
    const responseMarkdown = responseFromEvents(events)
    if (!responseMarkdown) throw new Error('Codex CLI 未返回可显示的 agent_message。')
    const startedThread = events.find(({ type }) => type === 'thread.started')?.thread_id
    if (input.kind === 'chat' && typeof startedThread === 'string') {
      await writeFile(mappingPath, `${startedThread}\n`, { encoding: 'utf8', mode: 0o600 })
    }
    const usageEvent = [...events].reverse().find(({ type }) => type === 'turn.completed')
    const usage =
      usageEvent?.usage && typeof usageEvent.usage === 'object'
        ? (usageEvent.usage as Record<string, unknown>)
        : {}
    const inputTokens = numberOrNull(usage.input_tokens)
    const outputTokens = numberOrNull(usage.output_tokens)
    return {
      harnessVersion: probe.version!,
      responseMarkdown,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          numberOrNull(usage.total_tokens) ??
          (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
      },
      modelLayer: {
        kind: 'harness-provider',
        provider: selection.providerId,
        model: selection.modelId,
      },
      degradedFeatures: [
        ...(profileContext
          ? ['Studio Profile 以显式 Prompt 上下文适配；不读取用户或项目规则文件。']
          : []),
        ...(input.profile.mcpServers.some(({ enabled }) => enabled)
          ? ['Codex Driver 使用 --ignore-user-config 隔离执行；MCP 配置未执行。']
          : []),
      ],
    }
  }
}
