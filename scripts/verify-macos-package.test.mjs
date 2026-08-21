import { describe, expect, it } from 'vitest'
import { hasDeveloperIdSignature, validatePackageMetadata } from './verify-macos-package.mjs'

describe('macOS package metadata policy', () => {
  it('accepts the fixed application identity and supported macOS floor', () => {
    expect(() =>
      validatePackageMetadata({
        bundleId: 'studio.agentstack.desktop',
        minimumSystemVersion: '12.0',
      }),
    ).not.toThrow()
  })

  it('rejects an accidental bundle identity or platform-floor change', () => {
    expect(() =>
      validatePackageMetadata({ bundleId: 'example.changed', minimumSystemVersion: '12.0' }),
    ).toThrow(/Bundle ID/)
    expect(() =>
      validatePackageMetadata({
        bundleId: 'studio.agentstack.desktop',
        minimumSystemVersion: '13.0',
      }),
    ).toThrow(/最低 macOS/)
  })

  it('does not confuse an ad-hoc signature with a Developer ID release signature', () => {
    expect(hasDeveloperIdSignature('Signature=adhoc\nTeamIdentifier=not set')).toBe(false)
    expect(
      hasDeveloperIdSignature(
        'Authority=Developer ID Application: Example Company (ABCDE12345)\nTeamIdentifier=ABCDE12345',
      ),
    ).toBe(true)
  })
})
