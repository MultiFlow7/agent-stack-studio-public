import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createRunFixture } from '../../test/run-fixture'
import { describeExecution } from './run-manifest'

describe('Run Manifest', () => {
  it('freezes the Agent version, Runtime Plan, component hashes, permissions, and content hash', () => {
    const { manifest } = createRunFixture()
    const { contentHash, ...withoutHash } = manifest

    expect(contentHash).toBe(createHash('sha256').update(JSON.stringify(withoutHash)).digest('hex'))
    expect(manifest.execution).toMatchObject({ kind: 'agent-loop', maxTurns: 3 })
    expect(manifest.permissions).toEqual({ network: 'denied', filesystem: 'artifacts-only' })
    expect(manifest.components[0]?.descriptorHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(manifest)).not.toContain('secret')
  })

  it.each(['agent-loop', 'workflow', 'hybrid', 'external-harness'] as const)(
    'binds an immutable trusted execution description for %s',
    (executionMode) => {
      const { manifest } = createRunFixture(executionMode)
      expect(manifest.execution.kind).toBe(executionMode)
      expect(manifest.executionMode).toBe(executionMode)
      if (manifest.execution.kind === 'workflow' || manifest.execution.kind === 'hybrid') {
        expect(manifest.execution.workflowVersionId).toMatch(/^[0-9a-f-]{36}$/)
      }
      if (manifest.execution.kind === 'hybrid') {
        expect(manifest.execution.handoff).toBe('workflow-to-agent')
      }
      if (manifest.execution.kind === 'external-harness') {
        expect(manifest.execution.trustedExecution).toBe(true)
        expect(manifest.execution.harnessComponentId).toBeTruthy()
      }
    },
  )

  it('rejects a Runtime Plan that points outside the explicit Adapter allowlist', () => {
    const { manifest } = createRunFixture()
    const plan = structuredClone(manifest.runtimePlan)
    const service = plan.services[0]
    if (!service) throw new Error('Expected a service fixture.')
    service.adapterRef = 'studio://runtime/not-registered'

    expect(() => describeExecution(plan)).toThrow('白名单')
  })
})
