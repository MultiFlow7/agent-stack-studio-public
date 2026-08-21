import { describe, expect, it } from 'vitest'
import { inspectPublicSnapshotFile } from './verify-public-snapshot.mjs'

describe('public snapshot privacy verifier', () => {
  it('accepts documented fixture identities and generic local paths', () => {
    const content = [
      'publisher@example.test',
      '204380030+MultiFlow7@users.noreply.github.com',
      '/Users/tester/workspace',
      'C:\\Users\\researcher\\workspace',
    ].join('\n')
    expect(inspectPublicSnapshotFile('fixture.txt', content)).toEqual([])
  })

  it('rejects provider credentials without storing a credential-shaped fixture', () => {
    const githubToken = ['gh', 'p_', 'A'.repeat(30)].join('')
    const openAiKey = ['sk', '-', 'B'.repeat(30)].join('')
    expect(inspectPublicSnapshotFile('source.txt', `${githubToken}\n${openAiKey}`)).toEqual([
      { path: 'source.txt', category: 'github-token' },
      { path: 'source.txt', category: 'openai-key' },
    ])
  })

  it('rejects real email domains, personal user paths and sensitive file names', () => {
    const email = ['person', '@example.com'].join('')
    const personalPath = ['/Users/', 'alice', '/private'].join('')
    const issues = inspectPublicSnapshotFile('.env.production', `${email}\n${personalPath}`)
    expect(issues).toEqual([
      { path: '.env.production', category: 'sensitive-file-name' },
      { path: '.env.production', category: 'non-fixture-email' },
      { path: '.env.production', category: 'personal-user-path' },
    ])
  })
})
