import { describe, expect, it } from 'vitest'
import { inspectAcceptanceSource, inspectNavigation } from './verify-local-acceptance.mjs'

const contract = {
  approvedPlaceholders: [{ path: 'view.tsx', value: '搜索本机', purpose: '查询提示' }],
  approvedHarnesses: [{ path: 'main.ts', tokens: ['STUDIO_PACKAGED_E2E'], purpose: '最终包验收' }],
  navigation: [{ id: 'agents', label: 'Agent' }],
}

describe('local acceptance verifier', () => {
  it('accepts classified input hints and packaged harness controls', () => {
    expect(
      inspectAcceptanceSource('view.tsx', '<input placeholder="搜索本机" />', contract),
    ).toEqual([])
    expect(inspectAcceptanceSource('main.ts', 'process.env.STUDIO_PACKAGED_E2E', contract)).toEqual(
      [],
    )
  })

  it('rejects unresolved work, dead actions and unclassified harnesses', () => {
    expect(
      inspectAcceptanceSource(
        'view.tsx',
        'TODO\n<button onClick={() => undefined}>稍后提供</button>\nSTUDIO_E2E_BYPASS',
        contract,
      ).map(({ category }) => category),
    ).toEqual(['todo', 'placeholder-copy', 'dead-action', 'unclassified-harness:STUDIO_E2E_BYPASS'])
  })

  it('requires every enabled destination to render and remain searchable', () => {
    const app = "{ id: 'agents', label: 'Agent', icon: Robot, enabled: true }\nview === 'agents'"
    expect(inspectNavigation(app, "['agents', 'Agent'", contract)).toEqual([])
    expect(inspectNavigation(app.replace("view === 'agents'", ''), '', contract)).toEqual([
      { path: 'src/renderer/src/App.tsx', category: 'unrendered-navigation:agents' },
      { path: 'src/core/command-center.ts', category: 'unsearchable-navigation:agents' },
    ])
  })
})
