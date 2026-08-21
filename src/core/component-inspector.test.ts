import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectComponentSource } from './component-inspector'

describe('safe component inspection', () => {
  it('reads only allowlisted static evidence and never executes declared project scripts', async () => {
    const inspection = await inspectComponentSource(path.resolve('src/test/fixtures/m7/detected'))

    expect(inspection.safety).toEqual({ executedProjectCode: false, followedSymbolicLinks: false })
    expect(inspection.evidenceLevel).toBe('detected')
    expect(inspection.descriptor.compatibility.level).toBe('unknown')
    expect(inspection.source.files).toContain('should-never-run.js')
    expect(inspection.warnings).toContain(
      '未发现 agent-stack.component.json，已生成需要用户确认的候选 Descriptor。',
    )
  })

  it('distinguishes declared evidence from contract-tested or runtime-verified conclusions', async () => {
    const inspection = await inspectComponentSource(path.resolve('src/test/fixtures/m7/harness-x'))
    expect(inspection.evidenceLevel).toBe('declared')
    expect(inspection.descriptor.compatibility.validation).toBe('declared')
    expect(inspection.source.readmePath).toMatch(/README\.md$/)
    expect(inspection.source.licensePath).toMatch(/LICENSE$/)
  })
})
