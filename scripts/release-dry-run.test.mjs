import { describe, expect, it } from 'vitest'
import { buildReleaseDryRunReport, notarizationCredentialMode } from './release-dry-run.mjs'

const compatibility = { contractVersion: 1 }
const packageResult = {
  applicationPath: '/release/Agent Stack Studio.app',
  checksumPath: '/release/SHA256SUMS.txt',
  cliPath: '/release/Agent Stack Studio.app/Contents/Resources/studio.mjs',
  signed: false,
  notarized: false,
}
const localConfig = {
  contractVersion: 1,
  channel: 'local',
  downloadBaseUrl: null,
  updateFeedUrl: null,
  automaticUpdates: false,
  requirements: { developerIdSignature: false, notarization: false, staple: false },
}

describe('release dry-run report', () => {
  it('completes without credentials while reporting every skipped or disabled release step', () => {
    const report = buildReleaseDryRunReport({
      config: localConfig,
      compatibility,
      packageResult,
      applicationVersion: '0.8.0',
      architecture: 'arm64',
      notarizationCredentials: 'none',
      verificationSteps: [{ id: 'quality-checks', status: 'verified' }],
    })
    expect(report.outcome).toBe('complete')
    expect(report.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'developer-id-signature', status: 'skipped' }),
        expect.objectContaining({ id: 'apple-notarization', status: 'skipped' }),
        expect.objectContaining({ id: 'staple-ticket', status: 'skipped' }),
        expect.objectContaining({ id: 'release-channel', status: 'disabled' }),
        expect.objectContaining({ id: 'automatic-updates', status: 'disabled' }),
      ]),
    )
  })

  it('blocks strict release requirements and a non-local channel without a download URL', () => {
    const report = buildReleaseDryRunReport({
      config: {
        ...localConfig,
        channel: 'stable',
        requirements: { developerIdSignature: true, notarization: true, staple: true },
      },
      compatibility,
      packageResult,
      applicationVersion: '0.8.0',
      architecture: 'arm64',
      notarizationCredentials: 'none',
    })
    expect(report.outcome).toBe('blocked')
    expect(report.steps.filter(({ status }) => status === 'blocked')).toHaveLength(4)
  })

  it('reports credential modes without exposing credential values', () => {
    expect(
      notarizationCredentialMode({
        APPLE_API_KEY: 'private',
        APPLE_API_KEY_ID: 'id',
        APPLE_API_ISSUER: 'issuer',
      }),
    ).toBe('app-store-connect-api')
    expect(notarizationCredentialMode({ APPLE_ID: 'partial-only' })).toBe('none')
  })
})
