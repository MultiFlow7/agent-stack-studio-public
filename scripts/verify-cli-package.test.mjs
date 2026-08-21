import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyCliPackage } from './verify-cli-package.mjs'

const roots = []

async function fixture(contents, executable = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-cli-package-'))
  roots.push(root)
  await mkdir(path.join(root, 'dist', 'cli'), { recursive: true })
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ version: '0.4.0', bin: { studio: 'dist/cli/studio.mjs' } }),
  )
  const cliPath = path.join(root, 'dist', 'cli', 'studio.mjs')
  await writeFile(cliPath, contents)
  await chmod(cliPath, executable ? 0o755 : 0o644)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('verifyCliPackage', () => {
  it('accepts an executable CLI that enables standard environment proxies', async () => {
    const root = await fixture('#!/usr/bin/env -S node --use-env-proxy\nconsole.log("0.4.0")\n')
    await expect(verifyCliPackage({ projectPath: root })).resolves.toMatchObject({
      version: '0.4.0',
    })
  })

  it('rejects a non-executable or legacy CLI entrypoint', async () => {
    const legacy = await fixture('#!/usr/bin/env node\nconsole.log("0.4.0")\n')
    await expect(verifyCliPackage({ projectPath: legacy })).rejects.toThrow('环境代理支持')
    const nonExecutable = await fixture(
      '#!/usr/bin/env -S node --use-env-proxy\nconsole.log("0.4.0")\n',
      false,
    )
    await expect(verifyCliPackage({ projectPath: nonExecutable })).rejects.toThrow()
  })
})
