import { describe, expect, it, vi } from 'vitest'
import type { RuntimeRunEvent } from '../shared/run'
import { createRunFixture } from '../test/run-fixture'
import { executeBuiltInRun } from './run-executor'

describe('executeBuiltInRun', () => {
  it.each([
    ['agent-loop', 3],
    ['workflow', 3],
    ['hybrid', 4],
    ['external-harness', 3],
  ] as const)('executes the trusted built-in %s profile', async (executionMode, steps) => {
    const { manifest } = createRunFixture(executionMode)
    const emit = vi.fn()
    const result = await executeBuiltInRun(manifest, new AbortController().signal, emit, 0)

    expect(result.stepsCompleted).toBe(steps)
    expect(result.summary).toContain('执行本地样例')
    expect(emit).toHaveBeenCalledTimes(steps * 2 + 1)
    const lastEvent = emit.mock.lastCall?.[0] as RuntimeRunEvent | undefined
    expect(lastEvent).toMatchObject({
      type: 'output',
      details: { deterministic: true, executionMode },
    })
  })

  it('cancels cooperatively while a step is running', async () => {
    const { manifest } = createRunFixture()
    const abort = new AbortController()
    const execution = executeBuiltInRun(manifest, abort.signal, vi.fn(), 100)
    abort.abort()
    await expect(execution).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses an Adapter outside the explicit trusted allowlist', async () => {
    const { manifest } = createRunFixture()
    const untrusted = structuredClone(manifest)
    const service = untrusted.runtimePlan.services[0]
    if (!service) throw new Error('Expected a service fixture.')
    service.adapterRef = 'studio://runtime/not-registered'
    await expect(
      executeBuiltInRun(untrusted, new AbortController().signal, vi.fn(), 0),
    ).rejects.toThrow('未授信')
  })

  it('refuses an External Harness without an explicit trusted binding', async () => {
    const { manifest } = createRunFixture('external-harness')
    const untrusted = structuredClone(manifest)
    if (untrusted.execution.kind !== 'external-harness') throw new Error('Expected harness.')
    untrusted.execution.trustedExecution = false

    await expect(
      executeBuiltInRun(untrusted, new AbortController().signal, vi.fn(), 0),
    ).rejects.toThrow('可信执行绑定')
  })

  it('refuses a Workflow Version that is not the registered immutable profile', async () => {
    const { manifest } = createRunFixture('workflow')
    const tampered = structuredClone(manifest)
    if (tampered.execution.kind !== 'workflow') throw new Error('Expected workflow.')
    tampered.execution.workflowVersionId = '70000000-0000-4000-8000-000000000099'

    await expect(
      executeBuiltInRun(tampered, new AbortController().signal, vi.fn(), 0),
    ).rejects.toThrow('内置可信版本')
  })

  it('refuses a mode and execution binding mismatch', async () => {
    const { manifest } = createRunFixture('hybrid')
    const tampered = structuredClone(manifest)
    tampered.executionMode = 'workflow'

    await expect(
      executeBuiltInRun(tampered, new AbortController().signal, vi.fn(), 0),
    ).rejects.toThrow('不一致')
  })
})
