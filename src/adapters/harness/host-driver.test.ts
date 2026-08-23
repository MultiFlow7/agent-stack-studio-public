import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExecutable } from './host-driver'

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
})
