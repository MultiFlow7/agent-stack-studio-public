import { chmod, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExecutable, spawnBounded } from './host-driver'

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
