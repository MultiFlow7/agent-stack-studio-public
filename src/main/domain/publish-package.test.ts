import { describe, expect, it } from 'vitest'
import { knownHarnesses } from '../../core/known-harnesses'
import { createRunFixture } from '../../test/run-fixture'
import { buildPublishPackage, canonicalJson, publishIdempotencyKey } from './publish-package'

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
      'chat-history',
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

  it('materializes a native Harness profile without Cordis or secret references', () => {
    const { component, version } = createRunFixture()
    component.id = knownHarnesses.openclaw.id
    component.descriptor = structuredClone(knownHarnesses.openclaw.descriptor)
    version.snapshot.stack.components = [
      {
        componentId: component.id,
        contractId: component.descriptor.id,
        version: component.descriptor.version,
      },
    ]
    version.snapshot.profile = {
      instructions: '只使用已批准的工具。',
      memoryMarkdown: '# Memory\n\n不要泄露秘密。',
      skills: [
        { id: 'enabled-skill', name: '已启用', markdown: '# Skill', enabled: true },
        { id: 'disabled-skill', name: '已禁用', markdown: '# Hidden', enabled: false },
      ],
      mcpServers: [
        {
          id: 'approved-mcp',
          name: '已批准 MCP',
          transport: 'stdio',
          command: 'approved-mcp',
          args: ['serve'],
          url: null,
          secretReferences: ['DEEPSEEK_API_KEY'],
          enabled: true,
          approval: 'approved',
        },
        {
          id: 'pending-mcp',
          name: '待审批 MCP',
          transport: 'http',
          command: null,
          args: [],
          url: 'https://example.com/mcp',
          secretReferences: [],
          enabled: true,
          approval: 'review-required',
        },
      ],
      toolPolicy: 'read-only',
    }

    const publishPackage = buildPublishPackage({ version, components: [component] })
    const serialized = JSON.stringify(publishPackage)

    expect(publishPackage.harness).toEqual({
      id: 'openclaw',
      contractId: component.descriptor.id,
      version: component.descriptor.version,
    })
    expect(publishPackage.requirements).toEqual({
      platforms: ['darwin-arm64', 'darwin-x64'],
      nativeHost: true,
      network: 'runtime-managed',
    })
    expect(publishPackage.profile?.skills.map(({ id }) => id)).toEqual(['enabled-skill'])
    expect(publishPackage.profile?.mcpServers.map(({ id }) => id)).toEqual(['approved-mcp'])
    expect(serialized).not.toContain('DEEPSEEK_API_KEY')
    expect(serialized).not.toContain('pending-mcp')
  })

  it('canonicalizes object key order before hashing', () => {
    expect(canonicalJson({ b: 1, nested: { z: 2, a: 3 }, a: 4 })).toBe(
      canonicalJson({ a: 4, nested: { a: 3, z: 2 }, b: 1 }),
    )
  })
})
