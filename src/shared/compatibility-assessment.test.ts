import { describe, expect, it } from 'vitest'
import { builtInComponents } from '../main/components/built-in-components'
import { assessComponentCompatibility } from './compatibility-assessment'

const componentId = '10000000-0000-4000-8000-000000000001'
const checkedAt = '2026-08-22T08:00:00.000Z'
const base = builtInComponents[0].descriptor

function assess(descriptor = base) {
  return assessComponentCompatibility({
    componentId,
    descriptor,
    checkedAt,
    platform: 'darwin-arm64',
  })
}

describe('compatibility assessment', () => {
  it('maps static, configuration, adapter, runtime and incompatible evidence explicitly', () => {
    const staticDescriptor = {
      ...base,
      compatibility: {
        level: 'native' as const,
        validation: 'contract-tested' as const,
        detail: '静态契约通过。',
      },
    }
    expect(assess({ ...staticDescriptor, configSchema: null }).status).toBe('static-passed')
    expect(assess(staticDescriptor).status).toBe('configuration-required')
    expect(
      assess({
        ...base,
        configSchema: null,
        compatibility: {
          level: 'adapter',
          validation: 'contract-tested',
          detail: 'Adapter 契约通过。',
        },
      }).status,
    ).toBe('adapter-required')
    expect(
      assess({
        ...base,
        configSchema: null,
        compatibility: {
          level: 'native',
          validation: 'runtime-verified',
          detail: '受信 Profile 验证通过。',
        },
      }),
    ).toMatchObject({ status: 'runtime-verified', method: 'trusted-runtime-v1' })
    expect(assess({ ...base, platforms: ['darwin-x64'] }).status).toBe('incompatible')
  })

  it('gives unknown components a machine-actionable path without treating edits as confirmation', () => {
    const result = assess({
      ...base,
      runtimeAdapter: null,
      evidence: [],
      compatibility: { level: 'unknown', validation: 'declared', detail: '待检查。' },
    })
    expect(result.status).toBe('unchecked')
    expect(result.blockers.join('')).toContain('运行入口契约')
    expect(result.suggestedActions.join('')).toContain('Adapter 契约')
    expect(result.evidence.some(({ kind }) => kind === 'entrypoint')).toBe(true)
  })
})
