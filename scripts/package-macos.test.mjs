import { access, constants, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { macosApplicationDirectory, macosArtifactNames } from './package-macos.mjs'

describe('macOS artifact naming', () => {
  it('keeps architecture and version explicit for DMG and ZIP artifacts', () => {
    expect(
      macosArtifactNames({
        productName: 'Agent Stack Studio',
        version: '0.2.0',
        architecture: 'arm64',
      }),
    ).toEqual({
      dmg: 'Agent Stack Studio-0.2.0-arm64.dmg',
      zip: 'Agent Stack Studio-0.2.0-arm64.zip',
    })
  })

  it('matches electron-builder output directories on Intel and Apple Silicon', () => {
    expect(macosApplicationDirectory('x64')).toBe('mac')
    expect(macosApplicationDirectory('arm64')).toBe('mac-arm64')
  })

  it('ships an executable CLI launcher that uses the app runtime instead of system Node', async () => {
    const projectPath = path.resolve('.')
    const packageJson = JSON.parse(await readFile(path.join(projectPath, 'package.json'), 'utf8'))
    const launcherPath = path.join(projectPath, 'build', 'studio-app-cli.sh')
    const launcher = await readFile(launcherPath, 'utf8')

    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/studio-app-cli.sh',
      to: 'bin/studio',
    })
    await expect(access(launcherPath, constants.X_OK)).resolves.toBeUndefined()
    expect(launcher).toContain('ELECTRON_RUN_AS_NODE=1 exec')
    expect(launcher).toContain('STUDIO_USER_DATA_PATH=')
    expect(launcher).toContain('app.asar.unpacked/dist/cli/studio.mjs')
    expect(launcher).not.toMatch(/exec\s+(?:node|npm)\b/)
  })
})
