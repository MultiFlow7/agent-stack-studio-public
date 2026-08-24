import { access, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import os from 'node:os'
import type { AgentProfile } from '../../shared/agent-profile'
import type { HarnessId, HarnessProbe } from '../../shared/native-agent'

export interface HostDriverExecuteInput {
  kind: 'chat' | 'run'
  message: string
  sessionId: string
  projectRoot: string
  stateRoot: string
  profile: AgentProfile
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
  probe(): Promise<HarnessProbe>
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
    const baseEnvironment = options.env ?? process.env
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
  const result = await spawnBounded(executable, ['--version'], { cwd, timeoutMs: 10_000 })
  if (result.exitCode !== 0) return null
  return result.stdout.trim().split(/\s+/)[0] ?? null
}

export function safeHarnessFailure(stderr: string): Error {
  const normalized = stderr.toLocaleLowerCase('en-US')
  if (
    normalized.includes('api key') ||
    normalized.includes('authentication') ||
    normalized.includes('auth store') ||
    normalized.includes('credential')
  ) {
    return new Error('Harness 尚未完成模型认证；请先在终端使用该 Harness 完成登录。')
  }
  return new Error('Harness 执行失败；诊断已脱敏，请运行 studio doctor 查看本机状态。')
}
