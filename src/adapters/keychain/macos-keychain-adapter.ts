import { spawn } from 'node:child_process'
import { z } from 'zod'
import { StudioCoreError } from '../../core/project-errors'

export const defaultKeychainService = 'studio.agentstack.desktop'

export const keychainLocatorSchema = z.object({
  service: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\0\r\n]+$/),
  account: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\0\r\n]+$/),
})

export const keychainSecretSchema = z
  .string()
  .min(1)
  .max(16_384)
  .regex(/^[^\0\r\n]+$/)

export interface KeychainLocator {
  service: string
  account: string
}

export interface KeychainAdapter {
  set(locator: KeychainLocator, secret: string, label?: string): Promise<void>
  has(locator: KeychainLocator): Promise<boolean>
  get(locator: KeychainLocator): Promise<string | null>
  delete(locator: KeychainLocator): Promise<boolean>
}

export interface SecurityCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type SecurityCommandRunner = (
  args: string[],
  input?: string,
) => Promise<SecurityCommandResult>

function runSecurityCommand(args: string[], input?: string): Promise<SecurityCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr })
    })
    child.stdin.end(input)
  })
}

function isMissingItem(result: SecurityCommandResult): boolean {
  return (
    result.exitCode === 44 ||
    /could not be found|item not found|errSecItemNotFound/i.test(result.stderr)
  )
}

function keychainFailure(action: string, result?: SecurityCommandResult): StudioCoreError {
  return new StudioCoreError('KEYCHAIN_FAILED', `macOS 钥匙串${action}失败。`, {
    details: result ? { exitCode: result.exitCode } : undefined,
    suggestedActions: [{ description: '确认登录钥匙串已解锁，并允许 Agent Stack Studio 访问。' }],
  })
}

export class MacOsKeychainAdapter implements KeychainAdapter {
  readonly #run: SecurityCommandRunner
  readonly #platform: NodeJS.Platform

  constructor(
    options: {
      run?: SecurityCommandRunner
      platform?: NodeJS.Platform
    } = {},
  ) {
    this.#run = options.run ?? runSecurityCommand
    this.#platform = options.platform ?? process.platform
  }

  #assertSupported(): void {
    if (this.#platform !== 'darwin') {
      throw new StudioCoreError('KEYCHAIN_UNAVAILABLE', '系统钥匙串仅在 macOS 上可用。', {
        suggestedActions: [{ description: '请在受支持的 macOS 设备上执行此命令。' }],
      })
    }
  }

  async set(locator: KeychainLocator, secret: string, label?: string): Promise<void> {
    this.#assertSupported()
    const parsed = keychainLocatorSchema.parse(locator)
    const parsedSecret = keychainSecretSchema.parse(secret)
    const args = ['add-generic-password', '-U', '-s', parsed.service, '-a', parsed.account]
    if (label?.trim()) args.push('-l', label.trim().slice(0, 200))
    // Prompt mode keeps the secret out of the process argument list.
    args.push('-w')
    const result = await this.#run(args, `${parsedSecret}\n${parsedSecret}\n`)
    if (result.exitCode !== 0) throw keychainFailure('写入', result)
  }

  async has(locator: KeychainLocator): Promise<boolean> {
    this.#assertSupported()
    const parsed = keychainLocatorSchema.parse(locator)
    const result = await this.#run([
      'find-generic-password',
      '-s',
      parsed.service,
      '-a',
      parsed.account,
    ])
    if (result.exitCode === 0) return true
    if (isMissingItem(result)) return false
    throw keychainFailure('检查', result)
  }

  async get(locator: KeychainLocator): Promise<string | null> {
    this.#assertSupported()
    const parsed = keychainLocatorSchema.parse(locator)
    const result = await this.#run([
      'find-generic-password',
      '-s',
      parsed.service,
      '-a',
      parsed.account,
      '-w',
    ])
    if (result.exitCode === 0) return result.stdout.replace(/\r?\n$/, '')
    if (isMissingItem(result)) return null
    throw keychainFailure('读取', result)
  }

  async delete(locator: KeychainLocator): Promise<boolean> {
    this.#assertSupported()
    const parsed = keychainLocatorSchema.parse(locator)
    const result = await this.#run([
      'delete-generic-password',
      '-s',
      parsed.service,
      '-a',
      parsed.account,
    ])
    if (result.exitCode === 0) return true
    if (isMissingItem(result)) return false
    throw keychainFailure('删除', result)
  }
}
