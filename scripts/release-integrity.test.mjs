import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checksumManifestName,
  formatChecksumManifest,
  parseChecksumManifest,
  sha256File,
  verifyReleaseChecksums,
} from './release-integrity.mjs'

describe('release integrity', () => {
  it('uses an architecture- and version-specific manifest name', () => {
    expect(checksumManifestName({ version: '0.5.0', architecture: 'arm64' })).toBe(
      'SHA256SUMS-0.5.0-arm64.txt',
    )
  })

  it('formats a stable manifest and rejects unsafe or duplicate entries', () => {
    const hashA = 'a'.repeat(64)
    const hashB = 'b'.repeat(64)
    expect(
      formatChecksumManifest([
        { fileName: 'Studio.zip', sha256: hashB },
        { fileName: 'Studio.dmg', sha256: hashA },
      ]),
    ).toBe(`${hashA}  Studio.dmg\n${hashB}  Studio.zip\n`)
    expect(() => parseChecksumManifest(`${hashA}  ../Studio.dmg\n`)).toThrow(/无效/)
    expect(() => parseChecksumManifest(`${hashA}  Studio.dmg\n${hashB}  Studio.dmg\n`)).toThrow(
      /重复/,
    )
  })

  it('verifies each artifact and detects tampering', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'studio-release-integrity-'))
    const artifactPath = path.join(directory, 'Studio.zip')
    const checksumPath = path.join(directory, 'SHA256SUMS.txt')
    await writeFile(artifactPath, 'trusted release')
    const sha256 = await sha256File(artifactPath)
    await writeFile(checksumPath, formatChecksumManifest([{ fileName: 'Studio.zip', sha256 }]))

    await expect(
      verifyReleaseChecksums({ checksumPath, artifactPaths: [artifactPath] }),
    ).resolves.toBeUndefined()
    await writeFile(artifactPath, 'tampered release')
    await expect(
      verifyReleaseChecksums({ checksumPath, artifactPaths: [artifactPath] }),
    ).rejects.toThrow(/校验失败/)
  })
})
