import { describe, expect, it, vi } from 'vitest'
import { MacOsKeychainAdapter, type SecurityCommandRunner } from './macos-keychain-adapter'

const locator = { service: 'studio.agentstack.desktop', account: 'openai-api' }

describe('MacOsKeychainAdapter', () => {
  it('writes through prompt stdin and never places the secret in argv', async () => {
    const run = vi.fn<SecurityCommandRunner>().mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: 'password data for new item:',
    })
    const adapter = new MacOsKeychainAdapter({ run, platform: 'darwin' })

    await adapter.set(locator, 'private-value', 'OpenAI API')

    const [args, input] = run.mock.calls[0]
    expect(args).toEqual([
      'add-generic-password',
      '-U',
      '-s',
      locator.service,
      '-a',
      locator.account,
      '-l',
      'OpenAI API',
      '-w',
    ])
    expect(args).not.toContain('private-value')
    expect(input).toBe('private-value\nprivate-value\n')
  })

  it('distinguishes missing items and returns values only to trusted callers', async () => {
    const run = vi
      .fn<SecurityCommandRunner>()
      .mockResolvedValueOnce({ exitCode: 44, stdout: '', stderr: 'could not be found' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'private-value\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 44, stdout: '', stderr: 'could not be found' })
    const adapter = new MacOsKeychainAdapter({ run, platform: 'darwin' })

    await expect(adapter.has(locator)).resolves.toBe(false)
    await expect(adapter.get(locator)).resolves.toBe('private-value')
    await expect(adapter.delete(locator)).resolves.toBe(false)
  })

  it('rejects unsupported platforms and line-breaking secrets', async () => {
    const adapter = new MacOsKeychainAdapter({
      run: vi.fn<SecurityCommandRunner>(),
      platform: 'linux',
    })
    await expect(adapter.has(locator)).rejects.toMatchObject({ code: 'KEYCHAIN_UNAVAILABLE' })

    const macAdapter = new MacOsKeychainAdapter({
      run: vi.fn<SecurityCommandRunner>(),
      platform: 'darwin',
    })
    await expect(macAdapter.set(locator, 'line one\nline two')).rejects.toThrow()
  })
})
