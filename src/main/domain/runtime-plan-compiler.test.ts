import { describe, expect, it } from 'vitest'
import { builtInComponents } from '../components/built-in-components'
import type { ComponentRecord } from '../../shared/component'
import { compileRuntimePlan } from './runtime-plan-compiler'

const agentId = '20000000-0000-4000-8000-000000000001'
const timestamp = '2026-08-19T08:00:00.000Z'

function records(indices: number[]): ComponentRecord[] {
  return indices.map((index) => ({
    id: builtInComponents[index].id,
    descriptor: structuredClone(builtInComponents[index].descriptor),
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
}

describe('compileRuntimePlan', () => {
  it('blocks the X/Y overlap until C and D each have an explicit owner', () => {
    const components = records([0, 1])
    const blocked = compileRuntimePlan({
      agentId,
      stackRevision: 3,
      executionMode: 'agent-loop',
      components,
      owners: [],
    })

    expect(blocked.status).toBe('blocked')
    if (blocked.status === 'blocked') {
      expect(blocked.issues.filter(({ code }) => code === 'OWNER_REQUIRED')).toHaveLength(2)
      expect(blocked.issues.map(({ capability }) => capability)).toEqual(
        expect.arrayContaining(['prompt-policy', 'context-builder']),
      )
    }

    const ready = compileRuntimePlan({
      agentId,
      stackRevision: 5,
      executionMode: 'agent-loop',
      components,
      owners: [
        { capability: 'prompt-policy', componentId: components[0].id, selectedAt: timestamp },
        { capability: 'context-builder', componentId: components[1].id, selectedAt: timestamp },
      ],
    })

    expect(ready.status).toBe('ready')
    if (ready.status === 'ready') {
      expect(ready.plan.services).toHaveLength(2)
      expect(ready.plan.contentHash).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(ready.plan)).not.toContain('Context')
    }
  })

  it('blocks missing dependencies and an Adapter that has not passed runtime verification', () => {
    const missingDependency = compileRuntimePlan({
      agentId,
      stackRevision: 1,
      executionMode: 'agent-loop',
      components: records([1]),
      owners: [],
    })
    expect(missingDependency.status).toBe('blocked')
    if (missingDependency.status === 'blocked') {
      expect(missingDependency.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'UNSATISFIED_REQUIREMENT' })]),
      )
    }

    const unverifiedAdapter = compileRuntimePlan({
      agentId,
      stackRevision: 2,
      executionMode: 'agent-loop',
      components: records([0, 2]),
      owners: [],
    })
    expect(unverifiedAdapter.status).toBe('blocked')
    if (unverifiedAdapter.status === 'blocked') {
      expect(unverifiedAdapter.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'ADAPTER_UNVERIFIED' })]),
      )
      expect(
        unverifiedAdapter.remediationTasks.map(({ kind, status }) => ({ kind, status })),
      ).toEqual([
        { kind: 'adapter-work', status: 'complete' },
        { kind: 'contract-test', status: 'complete' },
        { kind: 'runtime-validation', status: 'required' },
      ])
    }
  })

  it('blocks an unselected overlapping implementation with always-on side effects', () => {
    const components = records([0, 1])
    components[1].descriptor.provides.find(
      ({ capability }) => capability === 'prompt-policy',
    )!.activation = 'always-active'
    const result = compileRuntimePlan({
      agentId,
      stackRevision: 5,
      executionMode: 'agent-loop',
      components,
      owners: [
        { capability: 'prompt-policy', componentId: components[0].id, selectedAt: timestamp },
        { capability: 'context-builder', componentId: components[1].id, selectedAt: timestamp },
      ],
    })

    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') {
      expect(result.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'UNCONTROLLED_SIDE_EFFECT' })]),
      )
    }
  })

  it.each(['agent-loop', 'hybrid', 'external-harness'] as const)(
    'requires an execution controller for %s',
    (executionMode) => {
      const component = records([1])[0]
      component.descriptor.requires = []
      const result = compileRuntimePlan({
        agentId,
        stackRevision: 1,
        executionMode,
        components: [component],
        owners: [],
      })

      expect(result.status).toBe('blocked')
      if (result.status === 'blocked') {
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'EXECUTION_CONTROLLER_REQUIRED' }),
          ]),
        )
      }
    },
  )

  it('allows a Workflow with trusted services and no execution controller', () => {
    const component = records([1])[0]
    component.descriptor.requires = []
    const result = compileRuntimePlan({
      agentId,
      stackRevision: 1,
      executionMode: 'workflow',
      components: [component],
      owners: [],
    })

    expect(result.status).toBe('ready')
    expect(result.remediationTasks).toEqual([])
  })
})
