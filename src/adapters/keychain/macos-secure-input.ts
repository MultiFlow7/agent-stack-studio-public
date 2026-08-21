import { spawn } from 'node:child_process'
import { StudioCoreError } from '../../core/project-errors'

const promptScript = `on run argv
  set secretLabel to item 1 of argv
  set secretAccount to item 2 of argv
  set promptText to "请输入“" & secretLabel & "”的密钥。账户标识：" & secretAccount
  set promptResult to display dialog promptText default answer "" with hidden answer buttons {"取消", "写入钥匙串"} default button "写入钥匙串" cancel button "取消" with title "Agent Stack Studio"
  return text returned of promptResult
end run`

export interface SecureInputPrompt {
  request(label: string, account: string): Promise<string | null>
}

export interface SecureInputCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type SecureInputCommandRunner = (args: string[]) => Promise<SecureInputCommandResult>

function runOsascript(args: string[]): Promise<SecureInputCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
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
  })
}

export class MacOsSecureInputPrompt implements SecureInputPrompt {
  readonly #run: SecureInputCommandRunner
  readonly #platform: NodeJS.Platform

  constructor(
    options: {
      run?: SecureInputCommandRunner
      platform?: NodeJS.Platform
    } = {},
  ) {
    this.#run = options.run ?? runOsascript
    this.#platform = options.platform ?? process.platform
  }

  async request(label: string, account: string): Promise<string | null> {
    if (this.#platform !== 'darwin') {
      throw new StudioCoreError('KEYCHAIN_UNAVAILABLE', '系统安全输入仅在 macOS 上可用。')
    }
    const result = await this.#run(['-e', promptScript, '--', label, account])
    if (result.exitCode === 0) {
      const secret = result.stdout.replace(/\r?\n$/, '')
      return secret || null
    }
    if (/User canceled|用户已取消|-128/i.test(result.stderr)) return null
    throw new StudioCoreError('KEYCHAIN_FAILED', '无法打开 macOS 安全输入对话框。', {
      details: { exitCode: result.exitCode },
      suggestedActions: [{ description: '确认当前图形会话允许 Agent Stack Studio 显示对话框。' }],
    })
  }
}
