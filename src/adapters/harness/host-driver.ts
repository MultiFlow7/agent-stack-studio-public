import { access, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { defaultAgentProfile, type AgentProfile } from '../../shared/agent-profile'
import type { HarnessId, HarnessProbe } from '../../shared/native-agent'
import {
  assertSupportedModelSelection,
  harnessModelCapability,
  modelAuthFailureSchema,
  type HarnessModelCapability,
  type HarnessModelSelection,
  type ModelAuthenticationStatus,
  type ModelAuthFailure,
  type ModelAuthFailureCode,
} from '../../shared/model-auth'

export type HostDriverCredential = { kind: 'api-key'; value: string } | { kind: 'harness-login' }

export interface HostDriverAuthenticationInput {
  selection: HarnessModelSelection
  credential?: HostDriverCredential
  cwd: string
  stateRoot: string
  timeoutMs: number
  signal?: AbortSignal
}

export interface HostDriverExecuteInput {
  kind: 'chat' | 'run'
  message: string
  sessionId: string
  projectRoot: string
  stateRoot: string
  profile: AgentProfile
  model?: HarnessModelSelection
  credential?: HostDriverCredential
  timeoutMs: number
  signal?: AbortSignal
}

export interface HostDriverExecuteResult {
  harnessVersion: string
  responseMarkdown: string
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }
  modelLayer: {
    kind: 'harness-provider' | 'codex-simulation'
    provider: string
    model: string | null
  }
  degradedFeatures: string[]
}

export interface HarnessHostDriver {
  readonly id: HarnessId
  readonly modelCapability: HarnessModelCapability
  probe(): Promise<HarnessProbe>
  authenticationStatus(input: HostDriverAuthenticationInput): Promise<ModelAuthenticationStatus>
  verifyModel(input: HostDriverAuthenticationInput): Promise<HostDriverExecuteResult>
  execute(input: HostDriverExecuteInput): Promise<HostDriverExecuteResult>
}

export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  cancelled: boolean
}

const MAX_STDOUT_BYTES = 12 * 1024 * 1024
const MAX_STDERR_BYTES = 1024 * 1024

const MINIMAL_ENVIRONMENT_KEYS = [
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'PATH',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CODEX_HOME',
  'OPENCLAW_STATE_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
] as const

export function minimalChildEnvironment(
  additions: NodeJS.ProcessEnv = {},
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of MINIMAL_ENVIRONMENT_KEYS) {
    const value = source[key]
    if (value !== undefined) environment[key] = value
  }
  return { ...environment, ...additions }
}

export function defaultModelSelection(harnessId: HarnessId): HarnessModelSelection {
  const capability = harnessModelCapability(harnessId)
  const provider = capability.providers[0]
  const auth =
    provider.authMethods.find(
      ({ method, availability }) => method === 'existing-login' && availability === 'available',
    ) ?? provider.authMethods.find(({ availability }) => availability === 'available')!
  return assertSupportedModelSelection({
    harnessId,
    providerId: provider.id,
    modelId: provider.defaultModelId,
    credentialRequirement: {
      method: auth.method,
      credentialKind: auth.method === 'api-key' ? 'api-key' : 'harness-session',
    },
  })
}

export function resolveModelSelection(
  harnessId: HarnessId,
  selection?: HarnessModelSelection,
): HarnessModelSelection {
  const resolved = selection ?? defaultModelSelection(harnessId)
  if (resolved.harnessId !== harnessId) {
    throw new HarnessModelError(
      'harness-failed',
      `模型配置属于 ${resolved.harnessId}，不能交给 ${harnessId} Driver。`,
      '重新选择与当前 Harness 匹配的 Provider 和模型。',
      false,
    )
  }
  return assertSupportedModelSelection(resolved)
}

export function assertCredentialMatchesSelection(
  selection: HarnessModelSelection,
  credential?: HostDriverCredential,
): void {
  if (selection.credentialRequirement.credentialKind === 'api-key') {
    if (credential?.kind !== 'api-key' || !credential.value) {
      throw new HarnessModelError(
        'authentication-required',
        '当前 Provider 需要 API Key。',
        '使用 macOS 原生安全输入保存 API Key。',
        true,
      )
    }
    return
  }
  if (credential?.kind === 'api-key') {
    throw new HarnessModelError(
      'harness-failed',
      'Harness 登录认证不能接收 API Key 凭证。',
      '重新选择与本机登录状态匹配的认证方式。',
      false,
    )
  }
}

export class HarnessModelError extends Error {
  readonly failure: ModelAuthFailure

  constructor(
    code: ModelAuthFailureCode,
    message: string,
    recoveryAction: string,
    retryable: boolean,
  ) {
    super(message)
    this.name = 'HarnessModelError'
    this.failure = modelAuthFailureSchema.parse({ code, message, recoveryAction, retryable })
  }
}

export function assertNoSecretLeak(
  secret: string | undefined,
  observable: { args?: string[]; stdout?: string; stderr?: string },
): void {
  if (!secret) return
  if (
    observable.args?.some((argument) => argument.includes(secret)) ||
    observable.stdout?.includes(secret) ||
    observable.stderr?.includes(secret)
  ) {
    throw new HarnessModelError(
      'secret-leak-detected',
      'Harness 输出触发凭证泄漏保护，本次结果已拒绝。',
      '更新 API Key 后重试；若问题持续，请停止使用该 Provider 并检查 Harness。',
      false,
    )
  }
}

export function executeMinimumModelCall(
  driver: HarnessHostDriver,
  input: HostDriverAuthenticationInput,
): Promise<HostDriverExecuteResult> {
  return driver.execute({
    kind: 'run',
    message: 'Reply with exactly MODEL_CONNECTION_OK. Do not use tools.',
    sessionId: randomUUID(),
    projectRoot: input.cwd,
    stateRoot: input.stateRoot,
    profile: { ...defaultAgentProfile, toolPolicy: 'read-only' },
    model: input.selection,
    credential: input.credential,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  })
}

export async function resolveExecutable(
  name: string,
  options: {
    environment?: NodeJS.ProcessEnv
    homeDirectory?: string
    applicationDirectories?: string[]
  } = {},
): Promise<string | null> {
  if (name.includes(path.sep)) {
    try {
      await access(name, constants.X_OK)
      return path.resolve(name)
    } catch {
      return null
    }
  }
  const environment = options.environment ?? process.env
  const homeDirectory = options.homeDirectory ?? os.homedir()
  const searchDirectories = (environment.PATH ?? '').split(path.delimiter).filter(Boolean)
  searchDirectories.push(
    path.join(homeDirectory, '.local', 'bin'),
    path.join(homeDirectory, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(options.applicationDirectories ?? [
      '/Applications/Codex.app/Contents/Resources',
      '/Applications/ChatGPT.app/Contents/Resources',
      path.join(homeDirectory, 'Applications', 'Codex.app', 'Contents', 'Resources'),
      path.join(homeDirectory, 'Applications', 'ChatGPT.app', 'Contents', 'Resources'),
    ]),
  )
  const nvmVersionsRoot = path.join(homeDirectory, '.nvm', 'versions', 'node')
  try {
    const versions = await readdir(nvmVersionsRoot, { withFileTypes: true })
    searchDirectories.push(
      ...versions
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left, 'en', { numeric: true }))
        .map((version) => path.join(nvmVersionsRoot, version, 'bin')),
    )
  } catch {
    // NVM is optional; packaged macOS apps still search the standard user locations above.
  }
  for (const directory of new Set(searchDirectories)) {
    if (!directory) continue
    const candidate = path.join(directory, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue through PATH without invoking a shell.
    }
  }
  return null
}

export function spawnBounded(
  executable: string,
  args: string[],
  options: {
    cwd: string
    timeoutMs: number
    signal?: AbortSignal
    env?: NodeJS.ProcessEnv
    stdin?: string
  },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const baseEnvironment = options.env ?? minimalChildEnvironment()
    const executableDirectory = path.dirname(path.resolve(executable))
    const environmentPath = baseEnvironment.PATH ?? ''
    const childEnvironment = {
      ...baseEnvironment,
      PATH: [executableDirectory, environmentPath].filter(Boolean).join(path.delimiter),
    }
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: childEnvironment,
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
    })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let timedOut = false
    let cancelled = false
    let settled = false
    let hardKill: NodeJS.Timeout | undefined

    if (options.stdin !== undefined) child.stdin?.end(options.stdin)

    const terminate = (reason: 'timeout' | 'cancel') => {
      if (child.exitCode !== null || child.signalCode !== null) return
      timedOut ||= reason === 'timeout'
      cancelled ||= reason === 'cancel'
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
      }
      hardKill = setTimeout(() => {
        if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }, 1_500)
    }
    const timeout = setTimeout(() => terminate('timeout'), options.timeoutMs)
    const abort = () => terminate('cancel')
    options.signal?.addEventListener('abort', abort, { once: true })

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]).subarray(-MAX_STDOUT_BYTES)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]).subarray(-MAX_STDERR_BYTES)
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (hardKill) clearTimeout(hardKill)
      options.signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.once('exit', (exitCode, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (hardKill) clearTimeout(hardKill)
      options.signal?.removeEventListener('abort', abort)
      resolve({
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        exitCode,
        signal,
        timedOut,
        cancelled,
      })
    })
  })
}

export async function executableVersion(executable: string, cwd: string): Promise<string | null> {
  const result = await spawnBounded(executable, ['--version'], {
    cwd,
    timeoutMs: 10_000,
    env: minimalChildEnvironment(),
  })
  if (result.exitCode !== 0) return null
  return result.stdout.trim().split(/\s+/)[0] ?? null
}

export function safeHarnessFailure(stderr: string): HarnessModelError {
  const normalized = stderr.toLocaleLowerCase('en-US')
  if (normalized.includes('expired') || normalized.includes('token_expired')) {
    return new HarnessModelError(
      'credential-expired',
      '模型凭证已过期。',
      '重新登录 Harness 或更新 API Key。',
      true,
    )
  }
  if (
    normalized.includes('model not found') ||
    normalized.includes('model_not_found') ||
    normalized.includes('model is not available') ||
    normalized.includes('permission denied') ||
    normalized.includes('forbidden') ||
    normalized.includes('status 403') ||
    normalized.includes('status: 403')
  ) {
    return new HarnessModelError(
      'model-forbidden',
      '当前账号无权使用所选模型。',
      '选择有权限的模型，或调整 Provider 账号权限。',
      false,
    )
  }
  if (
    normalized.includes('invalid api key') ||
    normalized.includes('incorrect api key') ||
    normalized.includes('unauthorized') ||
    normalized.includes('status 401') ||
    normalized.includes('status: 401') ||
    normalized.includes('authentication failed') ||
    normalized.includes('invalid credential')
  ) {
    return new HarnessModelError(
      'credential-invalid',
      'Provider 拒绝了当前模型凭证。',
      '重新输入 API Key 或重新登录 Harness。',
      true,
    )
  }
  if (
    normalized.includes('api key') ||
    normalized.includes('authentication') ||
    normalized.includes('auth store') ||
    normalized.includes('credential') ||
    normalized.includes('not logged in')
  ) {
    return new HarnessModelError(
      'authentication-required',
      'Harness 尚未完成模型认证。',
      '在当前 Agent 的模型与认证区完成配置。',
      true,
    )
  }
  if (
    normalized.includes('enotfound') ||
    normalized.includes('econnreset') ||
    normalized.includes('econnrefused') ||
    normalized.includes('network') ||
    normalized.includes('fetch failed') ||
    normalized.includes('connection') ||
    normalized.includes('dns')
  ) {
    return new HarnessModelError(
      'network-failed',
      '无法连接模型 Provider。',
      '检查网络连接后重试。',
      true,
    )
  }
  return new HarnessModelError(
    'harness-failed',
    'Harness 执行失败；诊断信息已脱敏。',
    '重试；若问题持续，运行 Studio Doctor 检查本机 Harness。',
    true,
  )
}
