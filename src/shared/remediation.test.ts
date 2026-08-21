import { describe, expect, it } from 'vitest'
import { buildCompatibilityRemediationTasks } from './remediation'

const componentId = '30000000-0000-4000-8000-000000000001'

describe('compatibility remediation tasks', () => {
  it('derives a deterministic Adapter work, contract-test, and runtime-validation chain', () => {
    const tasks = buildCompatibilityRemediationTasks({
      componentId,
      componentName: 'Legacy Adapter',
      compatibility: {
        level: 'adapter',
        validation: 'contract-tested',
        detail: 'Adapter 已通过契约测试。',
      },
    })

    expect(tasks.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: 'adapter-work', status: 'complete' },
      { kind: 'contract-test', status: 'complete' },
      { kind: 'runtime-validation', status: 'required' },
    ])
    expect(tasks.every(({ id }) => id.startsWith(componentId))).toBe(true)
  })

  it('requires the full Fork chain when only a declaration exists', () => {
    const tasks = buildCompatibilityRemediationTasks({
      componentId,
      componentName: 'Legacy Fork',
      compatibility: { level: 'fork', validation: 'declared', detail: '需要维护补丁。' },
    })

    expect(tasks.map(({ kind }) => kind)).toEqual([
      'fork-work',
      'contract-test',
      'runtime-validation',
    ])
    expect(tasks.every(({ status }) => status === 'required')).toBe(true)
  })

  it('does not create work for native, blocked, or runtime-verified compatibility', () => {
    expect(
      buildCompatibilityRemediationTasks({
        componentId,
        componentName: 'Native',
        compatibility: { level: 'native', validation: 'declared', detail: '原生契约。' },
      }),
    ).toEqual([])
    expect(
      buildCompatibilityRemediationTasks({
        componentId,
        componentName: 'Verified Adapter',
        compatibility: {
          level: 'adapter',
          validation: 'runtime-verified',
          detail: '完成最小运行验证。',
        },
      }),
    ).toEqual([])
  })
})
