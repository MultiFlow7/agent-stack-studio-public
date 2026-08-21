import { describe, expect, it } from 'vitest'
import type { ExperimentCell } from '../../shared/experiment'
import type { StackState } from '../../shared/runtime-plan'
import { createRunFixture } from '../../test/run-fixture'
import {
  buildControlSnapshot,
  checkDrift,
  compareExperimentCells,
  expandExperimentMatrix,
} from './experiment-domain'

const timestamp = '2026-08-19T08:00:00.000Z'

function readyStack(): StackState {
  const { manifest, component } = createRunFixture()
  return {
    agentId: manifest.agentId,
    components: [component],
    owners: [],
    revision: manifest.runtimePlan.stackRevision,
    compilation: { status: 'ready', issues: [], remediationTasks: [], plan: manifest.runtimePlan },
  }
}

describe('experiment domain', () => {
  it('locks at least five controls and detects non-variable Drift', () => {
    const { version } = createRunFixture()
    const baseline = buildControlSnapshot({
      version,
      stack: readyStack(),
      architecture: 'arm64',
      electronVersion: '43.4.1',
    })
    expect(Object.keys(baseline)).toHaveLength(7)
    expect(checkDrift(baseline, baseline, timestamp)).toMatchObject({ status: 'clean', issues: [] })

    const changed = structuredClone(baseline)
    changed.stack.revision += 1
    const component = changed.components[0]
    if (!component) throw new Error('Expected a component fixture.')
    component.descriptorHash = 'b'.repeat(64)
    const drift = checkDrift(baseline, changed, timestamp)
    expect(drift.status).toBe('blocked')
    expect(drift.issues.map(({ control }) => control)).toEqual(
      expect.arrayContaining(['stack', 'component']),
    )
  })

  it('expands Prompt F × seed G × repetitions and compares completed cells', () => {
    const cells = expandExperimentMatrix({
      experimentId: '60000000-0000-4000-8000-000000000001',
      promptVariants: ['基准', '候选'],
      randomSeeds: [17, 29],
      repetitions: 2,
      createdAt: timestamp,
    })
    expect(cells).toHaveLength(8)
    const completed: ExperimentCell[] = cells.map((cell, index) => ({
      ...cell,
      status: 'succeeded',
      durationMs: 100 + index * 10,
    }))
    const comparison = compareExperimentCells(completed)
    expect(comparison).toHaveLength(4)
    expect(comparison[0]).toMatchObject({
      successRate: 1,
      averageDurationMs: 105,
      deltaFromBaselineMs: 0,
    })
    expect(comparison[1]?.deltaFromBaselineMs).toBe(20)
  })
})
