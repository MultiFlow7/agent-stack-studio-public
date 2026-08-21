import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadReleaseConfiguration } from './release-config.mjs'

const directories = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  )
})

async function configFile(config) {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-release-config-'))
  directories.push(directory)
  const filePath = path.join(directory, 'release.json')
  await writeFile(filePath, JSON.stringify(config))
  return filePath
}

const baseConfig = {
  $schema: '../schemas/release-config-v1.schema.json',
  contractVersion: 1,
  channel: 'local',
  downloadBaseUrl: null,
  updateFeedUrl: null,
  automaticUpdates: false,
  requirements: { developerIdSignature: false, notarization: false, staple: false },
}

describe('release configuration', () => {
  it('loads the no-credential local default without inventing distribution URLs', async () => {
    await expect(loadReleaseConfiguration({ environment: {} })).resolves.toMatchObject({
      configPath: path.resolve('config/release.default.json'),
      config: baseConfig,
    })
  })

  it('injects channel, URLs, and strict Apple requirements without accepting credentials', async () => {
    const configPath = await configFile(baseConfig)
    const result = await loadReleaseConfiguration({
      configPath,
      environment: {
        STUDIO_RELEASE_CHANNEL: 'stable',
        STUDIO_RELEASE_DOWNLOAD_BASE_URL: 'https://downloads.example.com/studio/',
        STUDIO_RELEASE_UPDATE_FEED_URL: 'https://updates.example.com/studio/feed.json',
        STUDIO_RELEASE_REQUIRE_SIGNED: '1',
        STUDIO_RELEASE_REQUIRE_NOTARIZED: '1',
        STUDIO_RELEASE_REQUIRE_STAPLED: '1',
      },
    })
    expect(result.config).toMatchObject({
      channel: 'stable',
      downloadBaseUrl: 'https://downloads.example.com/studio/',
      updateFeedUrl: 'https://updates.example.com/studio/feed.json',
      automaticUpdates: false,
      requirements: { developerIdSignature: true, notarization: true, staple: true },
    })
  })

  it('rejects insecure URLs and impossible Apple requirement ordering', async () => {
    const configPath = await configFile(baseConfig)
    await expect(
      loadReleaseConfiguration({
        configPath,
        environment: { STUDIO_RELEASE_DOWNLOAD_BASE_URL: 'http://downloads.example.com' },
      }),
    ).rejects.toThrow(/HTTPS/)
    await expect(
      loadReleaseConfiguration({
        configPath,
        environment: { STUDIO_RELEASE_REQUIRE_NOTARIZED: '1' },
      }),
    ).rejects.toThrow(/Developer ID/)
  })
})
