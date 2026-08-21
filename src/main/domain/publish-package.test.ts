import { describe, expect, it } from 'vitest'
import { createRunFixture } from '../../test/run-fixture'
import { buildPublishPackage, publishIdempotencyKey } from './publish-package'

describe('publish package', () => {
  it('builds a stable, portable package without local paths or secret values', () => {
    const { component, version } = createRunFixture()
    const publishPackage = buildPublishPackage({ version, components: [component] })
    const serialized = JSON.stringify(publishPackage)

    expect(publishPackage.stack.components[0]).toMatchObject({
      contractId: component.descriptor.id,
      version: component.descriptor.version,
    })
    expect(publishPackage.excludedContent).toEqual([
      'local-paths',
      'keychain-secrets',
      'experiment-data',
      'run-logs',
      'artifacts',
    ])
    expect(serialized).not.toContain('/Users/')
    expect(serialized).not.toContain('workspacePath')
    expect(serialized).not.toContain('secretValue')
    expect(buildPublishPackage({ version, components: [component] }).contentHash).toBe(
      publishPackage.contentHash,
    )
    expect(publishIdempotencyKey('target-a', publishPackage)).toHaveLength(64)
  })

  it('rejects a version when its immutable component identity is unavailable', () => {
    const { version } = createRunFixture()
    expect(() => buildPublishPackage({ version, components: [] })).toThrow('不可用')
  })
})
