import { resolveExecutable, spawnBounded } from '../../adapters/harness/host-driver'
import {
  multicaCliTargetId,
  multicaRuntimeListSchema,
  publishValidationSchema,
  type PublishPackage,
  type PublishTarget,
  type PublishValidation,
} from '../../shared/publish'
import {
  PublisherError,
  type AgentPublisher,
  type PublisherContext,
  type PublisherOutcome,
  type PublisherValidationContext,
  type RemoteAgentSummary,
} from './agent-publisher'
import type { DoctorMulticaFact } from '../../shared/doctor'

const MINIMUM_MULTICA_VERSION = '0.4.32'
const VERSION_MARKER = /<!-- agent-stack-studio:([0-9a-f-]{36}):([a-f0-9]{64}) -->/

interface MulticaRuntime {
  id: string
  name: string
  provider: string
  status: string
}

interface MulticaAgent {
  id: string
  name: string
  instructions?: string
}

interface CommandResult {
  stdout: string
  stderr: string
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)/.exec(value.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = parseVersion(actual)
  const right = parseVersion(minimum)
  if (!left || !right) return false
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true
    if (left[index] < right[index]) return false
  }
  return true
}

function marker(publishPackage: PublishPackage): string {
  return `<!-- agent-stack-studio:${publishPackage.source.agentVersionId}:${publishPackage.contentHash} -->`
}

export function remoteContentHash(instructions: string | undefined): string | null {
  return VERSION_MARKER.exec(instructions ?? '')?.[2] ?? null
}

function compileInstructions(publishPackage: PublishPackage): string {
  const profile = publishPackage.profile
  const sections = [marker(publishPackage)]
  if (profile?.instructions.trim()) sections.push(profile.instructions.trim())
  if (profile?.memoryMarkdown.trim()) {
    sections.push(`## Studio Memory\n\n${profile.memoryMarkdown.trim()}`)
  }
  for (const skill of profile?.skills ?? []) {
    sections.push(`## Skill: ${skill.name}\n\n${skill.markdown.trim()}`)
  }
  if (publishPackage.stack.components.length) {
    sections.push(
      `## Studio Stack\n\n${publishPackage.stack.components
        .map(({ contractId, version }) => `- ${contractId}@${version}`)
        .join('\n')}`,
    )
  }
  return sections.join('\n\n')
}

function mcpConfig(publishPackage: PublishPackage): Record<string, unknown> | null {
  const servers = publishPackage.profile?.mcpServers ?? []
  if (!servers.length) return null
  return {
    mcpServers: Object.fromEntries(
      servers.map((server) => [
        server.id,
        server.transport === 'stdio'
          ? { command: server.command, args: server.args }
          : { type: 'http', url: server.url },
      ]),
    ),
  }
}

function containsUnsafeLocalData(publishPackage: PublishPackage): boolean {
  const serialized = JSON.stringify(publishPackage)
  return (
    /(?:^|["\s])\/(?:Users|private|tmp|var|Volumes|home)\//.test(serialized) ||
    /file:\/\//i.test(serialized) ||
    /(?:token|password|api[_-]?key)["']?\s*[:=]/i.test(serialized)
  )
}

function parseJson<T>(stdout: string, code: string): T {
  try {
    return JSON.parse(stdout) as T
  } catch {
    throw new PublisherError(code, 'Multica CLI 返回了无法识别的结构化响应。', true)
  }
}

function safeCommandFailure(stderr: string): PublisherError {
  const normalized = stderr.toLocaleLowerCase('en-US')
  if (
    normalized.includes('not authenticated') ||
    normalized.includes("run 'multica login'") ||
    normalized.includes('unauthorized') ||
    normalized.includes('token is invalid')
  ) {
    return new PublisherError(
      'MULTICA_AUTHENTICATION_REQUIRED',
      'Multica 尚未登录或凭证已失效；请先运行 multica login。',
      false,
    )
  }
  if (normalized.includes('conflict') || normalized.includes('already exists')) {
    return new PublisherError(
      'MULTICA_REMOTE_CONFLICT',
      'Multica 中存在同名但不属于该 Studio Version 的 Agent。',
      false,
    )
  }
  return new PublisherError(
    'MULTICA_CLI_FAILED',
    'Multica 请求失败；远端细节已脱敏，可以安全重试。',
    true,
  )
}

export class MulticaCliPublisher implements AgentPublisher {
  readonly #executableName: string
  readonly #cwd: string

  constructor(options: { executable?: string; cwd?: string } = {}) {
    this.#executableName = options.executable ?? process.env.STUDIO_MULTICA_PATH ?? 'multica'
    this.#cwd = options.cwd ?? process.cwd()
  }

  async readiness(signal?: AbortSignal): Promise<DoctorMulticaFact> {
    const executable = await resolveExecutable(this.#executableName)
    if (!executable) {
      throw new PublisherError('MULTICA_CLI_NOT_INSTALLED', '未找到 Multica CLI。', false)
    }
    const version = parseJson<{ version?: string }>(
      (await this.#command(executable, ['version', '--output', 'json'], signal)).stdout,
      'MULTICA_CLI_UNSUPPORTED',
    ).version
    if (!version || !versionAtLeast(version, MINIMUM_MULTICA_VERSION)) {
      return {
        status: 'unavailable',
        runtimeCount: 0,
        onlineRuntimeCount: 0,
        message: `Multica CLI 版本 ${version ?? '未知'} 低于最低要求 ${MINIMUM_MULTICA_VERSION}。`,
      }
    }
    const runtimes = await this.runtimes(signal)
    const onlineRuntimeCount = runtimes.filter(({ status }) => status === 'online').length
    return {
      status: onlineRuntimeCount > 0 ? 'ready' : 'unavailable',
      runtimeCount: runtimes.length,
      onlineRuntimeCount,
      message:
        onlineRuntimeCount > 0
          ? `Multica CLI ${version} 已认证，${onlineRuntimeCount} 个 Runtime 在线。`
          : `Multica CLI ${version} 已认证，但 ${runtimes.length} 个 Runtime 中没有在线项。`,
    }
  }

  async runtimes(signal?: AbortSignal) {
    const executable = await resolveExecutable(this.#executableName)
    if (!executable) {
      throw new PublisherError('MULTICA_CLI_NOT_INSTALLED', '未找到 Multica CLI。', false)
    }
    const runtimes = parseJson<MulticaRuntime[]>(
      (await this.#command(executable, ['runtime', 'list', '--output', 'json'], signal)).stdout,
      'MULTICA_CLI_FAILED',
    )
    return multicaRuntimeListSchema.parse(
      runtimes.map((runtime) => ({
        id: runtime.id,
        label: runtime.name || `${runtime.provider} Runtime`,
        provider: runtime.provider,
        status: runtime.status,
      })),
    )
  }

  async validate(
    target: PublishTarget,
    publishPackage: PublishPackage,
    context: PublisherValidationContext = { remoteAgentId: null, runtimeId: null },
  ): Promise<PublishValidation> {
    const issues: PublishValidation['issues'] = []
    if (target.id !== multicaCliTargetId || target.transport !== 'cli') {
      issues.push({
        field: 'target',
        severity: 'blocking',
        code: 'TARGET_UNAVAILABLE',
        message: '该目标不是真实 Multica CLI Transport。',
      })
    }
    if (containsUnsafeLocalData(publishPackage)) {
      issues.push({
        field: 'package',
        severity: 'blocking',
        code: 'SENSITIVE_CONTENT',
        message: '发布 payload 包含本地路径或疑似密钥字段。',
      })
    }
    if (compileInstructions(publishPackage).length > 100_000) {
      issues.push({
        field: 'profile',
        severity: 'blocking',
        code: 'UNSUPPORTED_COMPONENT',
        message: '编译后的 Multica instructions 超过 100000 字符，请精简 Memory 或 Skill。',
      })
    }
    const executable = await resolveExecutable(this.#executableName)
    if (!executable) {
      issues.push({
        field: 'multica.cli',
        severity: 'blocking',
        code: 'MULTICA_CLI_NOT_INSTALLED',
        message: '未找到 Multica CLI；请先安装官方 v0.4.32 或更高版本。',
      })
      return this.#validation(issues)
    }
    try {
      const version = parseJson<{ version?: string }>(
        (await this.#command(executable, ['version', '--output', 'json'], context.signal)).stdout,
        'MULTICA_CLI_UNSUPPORTED',
      ).version
      if (!version || !versionAtLeast(version, MINIMUM_MULTICA_VERSION)) {
        issues.push({
          field: 'multica.cli.version',
          severity: 'blocking',
          code: 'MULTICA_CLI_UNSUPPORTED',
          message: `Multica CLI 最低需要 ${MINIMUM_MULTICA_VERSION}。`,
        })
        return this.#validation(issues)
      }
      const runtimes = parseJson<MulticaRuntime[]>(
        (await this.#command(executable, ['runtime', 'list', '--output', 'json'], context.signal))
          .stdout,
        'MULTICA_CLI_FAILED',
      )
      if (!context.remoteAgentId && !context.runtimeId) {
        issues.push({
          field: 'runtimeId',
          severity: 'blocking',
          code: 'MULTICA_RUNTIME_REQUIRED',
          message: '首次发布需要选择一个已连接的 Multica Runtime。',
        })
      }
      if (context.runtimeId) {
        const runtime = runtimes.find(({ id }) => id === context.runtimeId)
        if (
          !runtime ||
          runtime.provider !== publishPackage.harness?.id ||
          runtime.status !== 'online'
        ) {
          issues.push({
            field: 'runtimeId',
            severity: 'blocking',
            code: 'MULTICA_RUNTIME_MISMATCH',
            message: `所选 Runtime 必须在线并提供 ${publishPackage.harness?.id ?? '当前 Harness'}。`,
          })
        }
      }
    } catch (error) {
      const failure = error instanceof PublisherError ? error : safeCommandFailure('')
      issues.push({
        field: 'multica.authentication',
        severity: 'blocking',
        code:
          failure.code === 'MULTICA_AUTHENTICATION_REQUIRED'
            ? 'MULTICA_AUTHENTICATION_REQUIRED'
            : 'TARGET_UNAVAILABLE',
        message: failure.message,
      })
    }
    if (publishPackage.profile?.skills.length || publishPackage.profile?.memoryMarkdown) {
      issues.push({
        field: 'profile',
        severity: 'warning',
        code: 'CAPABILITY_DEGRADED',
        message: 'Markdown Memory 与 Skill 将确定性编译进 Multica Agent instructions。',
      })
    }
    if (publishPackage.profile?.toolPolicy) {
      issues.push({
        field: 'profile.toolPolicy',
        severity: 'warning',
        code: 'CAPABILITY_DEGRADED',
        message: 'Multica 不提供 Studio toolPolicy 字段；实际工具权限由所选 Runtime 管理。',
      })
    }
    return this.#validation(issues)
  }

  async publish(
    target: PublishTarget,
    publishPackage: PublishPackage,
    context: PublisherContext,
  ): Promise<PublisherOutcome> {
    const validation = await this.validate(target, publishPackage, context)
    if (validation.status === 'blocked') {
      const issue = validation.issues.find(({ severity }) => severity === 'blocking')!
      throw new PublisherError(issue.code, issue.message, issue.code === 'TARGET_UNAVAILABLE')
    }
    const executable = await resolveExecutable(this.#executableName)
    if (!executable) {
      throw new PublisherError('MULTICA_CLI_NOT_INSTALLED', '未找到 Multica CLI。', false)
    }
    const instructions = compileInstructions(publishPackage)
    const config = mcpConfig(publishPackage)
    if (context.remoteAgentId) {
      const current = await this.#getAgent(executable, context.remoteAgentId, context.signal)
      if (!current) {
        throw new PublisherError(
          'MULTICA_MAPPING_STALE',
          '本地映射指向的 Multica Agent 不存在；已拒绝自动创建重复身份。',
          false,
        )
      }
      const args = [
        'agent',
        'update',
        context.remoteAgentId,
        '--name',
        publishPackage.agent.name,
        '--description',
        publishPackage.agent.description.slice(0, 255),
        '--instructions',
        instructions,
        '--output',
        'json',
      ]
      if (context.runtimeId) args.push('--runtime-id', context.runtimeId)
      const result = await this.#agentMutation(executable, args, config, context.signal)
      return this.#outcome(result, publishPackage, false)
    }

    const agents = await this.#listAgents(executable, context.signal)
    const recovered = agents.find(
      (agent) => remoteContentHash(agent.instructions) === publishPackage.contentHash,
    )
    if (recovered) return this.#outcome(recovered, publishPackage, true)
    if (agents.some(({ name }) => name === publishPackage.agent.name)) {
      throw new PublisherError(
        'MULTICA_REMOTE_CONFLICT',
        'Multica 中存在同名但内容哈希不同的 Agent；请先改名或明确迁移远端身份。',
        false,
      )
    }
    if (!context.runtimeId) {
      throw new PublisherError('MULTICA_RUNTIME_REQUIRED', '首次发布需要 Runtime ID。', false)
    }
    const args = [
      'agent',
      'create',
      '--name',
      publishPackage.agent.name,
      '--description',
      publishPackage.agent.description.slice(0, 255),
      '--instructions',
      instructions,
      '--runtime-id',
      context.runtimeId,
      '--permission-mode',
      'private',
      '--output',
      'json',
    ]
    try {
      const result = await this.#agentMutation(executable, args, config, context.signal)
      return this.#outcome(result, publishPackage, false)
    } catch (error) {
      if (!(error instanceof PublisherError) || error.code !== 'MULTICA_REMOTE_CONFLICT')
        throw error
      const afterConflict = (await this.#listAgents(executable, context.signal)).find(
        (agent) => remoteContentHash(agent.instructions) === publishPackage.contentHash,
      )
      if (afterConflict) return this.#outcome(afterConflict, publishPackage, true)
      throw error
    }
  }

  async inspect(
    _target: PublishTarget,
    remoteAgentId: string,
    signal?: AbortSignal,
  ): Promise<RemoteAgentSummary | null> {
    const executable = await resolveExecutable(this.#executableName)
    if (!executable) {
      throw new PublisherError('MULTICA_CLI_NOT_INSTALLED', '未找到 Multica CLI。', false)
    }
    const agent = await this.#getAgent(executable, remoteAgentId, signal)
    if (!agent) return null
    return {
      remoteAgentId: agent.id,
      latestRemoteVersionId: remoteContentHash(agent.instructions) ?? 'untracked',
      displayName: agent.name,
    }
  }

  #validation(issues: PublishValidation['issues']): PublishValidation {
    return publishValidationSchema.parse({
      status: issues.some(({ severity }) => severity === 'blocking') ? 'blocked' : 'ready',
      issues,
      checkedAt: new Date().toISOString(),
    })
  }

  async #command(
    executable: string,
    args: string[],
    signal?: AbortSignal,
    stdin?: string,
  ): Promise<CommandResult> {
    const result = await spawnBounded(executable, args, {
      cwd: this.#cwd,
      timeoutMs: 60_000,
      signal,
      stdin,
    })
    if (result.cancelled) throw new DOMException('Publishing aborted.', 'AbortError')
    if (result.timedOut) {
      throw new PublisherError('MULTICA_CLI_TIMEOUT', 'Multica CLI 响应超时。', true)
    }
    if (result.exitCode !== 0) throw safeCommandFailure(result.stderr)
    return { stdout: result.stdout, stderr: result.stderr }
  }

  async #agentMutation(
    executable: string,
    args: string[],
    config: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<MulticaAgent> {
    const finalArgs = [...args]
    let stdin: string | undefined
    if (config) {
      const outputIndex = finalArgs.lastIndexOf('--output')
      finalArgs.splice(outputIndex < 0 ? finalArgs.length : outputIndex, 0, '--mcp-config-stdin')
      stdin = JSON.stringify(config)
    }
    return parseJson<MulticaAgent>(
      (await this.#command(executable, finalArgs, signal, stdin)).stdout,
      'MULTICA_CLI_FAILED',
    )
  }

  async #listAgents(executable: string, signal?: AbortSignal): Promise<MulticaAgent[]> {
    return parseJson<MulticaAgent[]>(
      (await this.#command(executable, ['agent', 'list', '--output', 'json'], signal)).stdout,
      'MULTICA_CLI_FAILED',
    )
  }

  async #getAgent(
    executable: string,
    remoteAgentId: string,
    signal?: AbortSignal,
  ): Promise<MulticaAgent | null> {
    try {
      return parseJson<MulticaAgent>(
        (
          await this.#command(
            executable,
            ['agent', 'get', remoteAgentId, '--output', 'json'],
            signal,
          )
        ).stdout,
        'MULTICA_CLI_FAILED',
      )
    } catch (error) {
      if (error instanceof PublisherError && error.code === 'MULTICA_CLI_FAILED') return null
      throw error
    }
  }

  #outcome(
    agent: MulticaAgent,
    publishPackage: PublishPackage,
    recovered: boolean,
  ): PublisherOutcome {
    if (!agent.id || !agent.name) {
      throw new PublisherError('MULTICA_CLI_FAILED', 'Multica Agent 响应缺少稳定身份。', true)
    }
    return {
      remoteAgentId: agent.id,
      remoteVersionId: publishPackage.contentHash,
      message: recovered
        ? '已通过内容哈希找回先前创建的 Multica Agent，未重复创建。'
        : 'Multica Agent 已创建或更新，并经真实响应确认。',
      publishedFields: ['name', 'description', 'instructions', 'runtime', 'mcp_config'],
      testOnly: false,
    }
  }
}
