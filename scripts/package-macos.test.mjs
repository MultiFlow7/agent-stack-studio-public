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
})
