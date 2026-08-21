import { describe, expect, it, vi } from 'vitest'
import { MacOsSecureInputPrompt, type SecureInputCommandRunner } from './macos-secure-input'

describe('MacOsSecureInputPrompt', () => {
  it('uses a fixed script and returns the hidden native response only to Main', async () => {
    const run = vi.fn<SecureInputCommandRunner>(() =>
      Promise.resolve({ exitCode: 0, stdout: 'private-value\n', stderr: '' }),
    )
    const prompt = new MacOsSecureInputPrompt({ run, platform: 'darwin' })

    await expect(prompt.request('OpenAI API', 'openai-api')).resolves.toBe('private-value')
    const args = run.mock.calls[0][0]
    expect(args).toContain('OpenAI API')
    expect(args).toContain('openai-api')
    expect(args.join(' ')).not.toContain('private-value')
  })

  it('maps native cancellation without fabricating a configured secret', async () => {
    const run = vi.fn<SecureInputCommandRunner>(() =>
      Promise.resolve({
        exitCode: 1,
        stdout: '',
        stderr: 'execution error: User canceled. (-128)',
      }),
    )
    const prompt = new MacOsSecureInputPrompt({ run, platform: 'darwin' })
    await expect(prompt.request('API', 'api')).resolves.toBeNull()
  })
})
