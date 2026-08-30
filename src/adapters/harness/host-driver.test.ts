import { chmod, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HarnessModelError,
  minimalChildEnvironment,
  resolveExecutable,
  safeHarnessFailure,
  spawnBounded,
} from './host-driver'

async function executableAt(target: string): Promise<string> {
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(target, 0o700)
  return target
}

describe('macOS executable discovery', () => {
  it('prefers PATH and falls back to user-local and NVM bins for GUI launches', async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'studio-executable-home-'))
    const pathDirectory = path.join(homeDirectory, 'path-bin')
    const pathExecutable = await executableAt(path.join(pathDirectory, 'pi'))
    await executableAt(path.join(homeDirectory, '.local', 'bin', 'multica'))
    const nvmExecutable = await executableAt(
      path.join(homeDirectory, '.nvm', 'versions', 'node', 'v24.13.0', 'bin', 'openclaw'),
    )

    await expect(
      resolveExecutable('pi', { environment: { PATH: pathDirectory }, homeDirectory }),
    ).resolves.toBe(pathExecutable)
    await expect(
      resolveExecutable('multica', { environment: { PATH: '' }, homeDirectory }),
    ).resolves.toBe(path.join(homeDirectory, '.local', 'bin', 'multica'))
    await expect(
      resolveExecutable('openclaw', { environment: { PATH: '' }, homeDirectory }),
    ).resolves.toBe(nvmExecutable)
  })

  it('does not search fallbacks for an explicit missing path', async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'studio-executable-explicit-'))
    await expect(
      resolveExecutable(path.join(homeDirectory, 'missing', 'multica'), { homeDirectory }),
    ).resolves.toBeNull()
  })

  it('finds the trusted Codex binary bundled with a macOS application', async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'studio-codex-app-home-'))
    const applicationDirectory = path.join(
      homeDirectory,
      'Applications',
      'ChatGPT.app',
      'Contents',
      'Resources',
    )
    const codexExecutable = await executableAt(path.join(applicationDirectory, 'codex'))

    await expect(
      resolveExecutable('codex', {
        environment: { PATH: '/usr/bin:/bin' },
        homeDirectory,
        applicationDirectories: [applicationDirectory],
      }),
    ).resolves.toBe(codexExecutable)
  })

  it('lets an explicitly resolved Node CLI find its sibling runtime under a packaged PATH', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio-node-cli-bin-'))
    const bin = path.join(root, 'bin')
    await mkdir(bin, { recursive: true })
    await symlink(process.execPath, path.join(bin, 'node'))
    const cli = await executableAt(path.join(bin, 'fixture-cli'))
    await writeFile(
      cli,
      '#!/usr/bin/env node\nprocess.stdout.write(`NODE_CLI_OK:${process.version}`)\n',
      'utf8',
    )

    const result = await spawnBounded(cli, [], {
      cwd: root,
      timeoutMs: 5_000,
      env: { PATH: '/usr/bin:/bin' },
    })
    expect(result).toMatchObject({ exitCode: 0, timedOut: false, cancelled: false })
    expect(result.stdout).toContain('NODE_CLI_OK:')
  })
})

describe('Harness model security boundary', () => {
  it('constructs a minimal child environment without unrelated Provider secrets', () => {
    expect(
      minimalChildEnvironment(
        { OPENAI_API_KEY: 'one-shot' },
        {
          HOME: '/safe/home',
          PATH: '/usr/bin:/bin',
          LANG: 'en_US.UTF-8',
          ANTHROPIC_API_KEY: 'must-not-inherit',
          AWS_SECRET_ACCESS_KEY: 'must-not-inherit',
          GITHUB_TOKEN: 'must-not-inherit',
        },
      ),
    ).toEqual({
      HOME: '/safe/home',
      PATH: '/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      OPENAI_API_KEY: 'one-shot',
    })
  })

  it('uses the minimal environment when a caller does not provide one', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio-minimal-child-env-'))
    const executable = path.join(root, 'environment-check')
    await writeFile(
      executable,
      '#!/bin/sh\nif [ -n "$ANTHROPIC_API_KEY" ]; then printf inherited; else printf isolated; fi\n',
      'utf8',
    )
    await chmod(executable, 0o700)
    const previous = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'unrelated-parent-secret'
    try {
      const result = await spawnBounded(executable, [], { cwd: root, timeoutMs: 5_000 })
      expect(result).toMatchObject({ exitCode: 0, stdout: 'isolated' })
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = previous
    }
  })

  it.each([
    ['expired token', 'credential-expired'],
    ['status 403 model is not available', 'model-forbidden'],
    ['status 401 invalid API key', 'credential-invalid'],
    ['getaddrinfo ENOTFOUND api.openai.com', 'network-failed'],
    ['unexpected exit', 'harness-failed'],
  ] as const)('maps %s to a safe structured failure', (stderr, code) => {
    const error = safeHarnessFailure(stderr)
    expect(error).toBeInstanceOf(HarnessModelError)
    expect(error.failure.code).toBe(code)
    expect(error.message).not.toContain(stderr)
  })
})
