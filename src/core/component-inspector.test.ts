import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectComponentSource, sanitizeGitRemote } from './component-inspector'

describe('safe component inspection', () => {
  it('reads only allowlisted static evidence and never executes declared project scripts', async () => {
    const inspection = await inspectComponentSource(path.resolve('src/test/fixtures/m7/detected'))

    expect(inspection.safety).toEqual({ executedProjectCode: false, followedSymbolicLinks: false })
    expect(inspection.evidenceLevel).toBe('detected')
    expect(inspection.descriptor.compatibility.level).toBe('unknown')
    expect(inspection.source.files).toContain('should-never-run.js')
    expect(inspection.warnings).toContain(
      '未发现 agent-stack.component.json，已生成机器证据不足的候选 Descriptor；用户编辑不能代替技术验证。',
    )
  })

  it('distinguishes declared evidence from contract-tested or runtime-verified conclusions', async () => {
    const inspection = await inspectComponentSource(path.resolve('src/test/fixtures/m7/harness-x'))
    expect(inspection.evidenceLevel).toBe('declared')
    expect(inspection.descriptor.compatibility.validation).toBe('declared')
    expect(inspection.source.readmePath).toMatch(/README\.md$/)
    expect(inspection.source.licensePath).toMatch(/LICENSE$/)
  })

  it('removes Git credentials and local paths before recording portable source metadata', () => {
    const credentialedRemote = [
      'https://oauth:secret',
      'github.com/example/repo.git?token=value',
    ].join('@')
    expect(sanitizeGitRemote(credentialedRemote)).toBe('https://github.com/example/repo.git')
    expect(sanitizeGitRemote('git@github.com:example/repo.git')).toBe(
      'ssh://github.com/example/repo.git',
    )
    expect(sanitizeGitRemote('/Users/test/repo')).toBeNull()
  })
})
