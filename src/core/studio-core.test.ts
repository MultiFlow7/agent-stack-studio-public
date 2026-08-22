import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StudioCoreError } from './project-errors'
import { StudioCore } from './studio-core'
import type { ComponentDescriptor } from '../shared/component'
import type { TrustedCompatibilityRuntimeGateway } from './trusted-compatibility-runtime'

const roots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-core-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('StudioCore local Coding Agent workflow', () => {
  it('finds missing requirements and overlaps, records Owner decisions, and freezes an immutable version', async () => {
    const root = await createRoot()
    const core = new StudioCore()
    await core.initProject(root, { name: 'CLI and GUI shared project' })
    let state = await core.importComponent(root, path.resolve('src/test/fixtures/m7/research-y'))
    const researchY = state.project.components[0]
    state = await core.addStackComponent(root, researchY.id)
    expect(core.validate(state.project).issues.map(({ code }) => code)).toContain(
      'UNSATISFIED_REQUIREMENT',
    )

    state = await core.importComponent(root, path.resolve('src/test/fixtures/m7/harness-x'))
    const harnessX = state.project.components.find(
      ({ descriptor }) => descriptor.id === 'fixture.harness-x',
    )
    if (!harnessX) throw new Error('Harness X fixture was not imported.')
    state = await core.addStackComponent(root, harnessX.id)
    expect(
      core.validate(state.project).issues.filter(({ code }) => code === 'OWNER_REQUIRED'),
    ).toHaveLength(2)

    state = await core.setOwner(root, 'prompt-policy', harnessX.id)
    state = await core.setOwner(root, 'context-builder', researchY.id)
    const ready = core.validate(state.project)
    expect(ready.status).toBe('ready')
    expect(ready.issues.every(({ severity }) => severity === 'warning')).toBe(true)

    const frozen = await core.freezeVersion(root)
    expect(frozen.reused).toBe(false)
    expect(frozen.version.snapshot.components).toHaveLength(2)
    const repeated = await core.freezeVersion(root)
    expect(repeated.reused).toBe(true)
    expect(repeated.version.id).toBe(frozen.version.id)

    const reread = await core.inspectProject(root)
    expect(core.inspectVersion(reread.project, '1')).toEqual(frozen.version)
    expect(reread.project.revision).toBe(frozen.result.project.revision)
  })

  it('supports Descriptor correction and protects current plus historical references from deletion', async () => {
    const root = await createRoot()
    const core = new StudioCore()
    await core.initProject(root, { name: 'Descriptor correction' })
    let state = await core.importComponent(root, path.resolve('src/test/fixtures/m7/detected'))
    const component = state.project.components[0]
    expect(core.validate((await core.addStackComponent(root, component.id)).project).status).toBe(
      'blocked',
    )
    state = await core.confirmComponentDescriptorFile(
      root,
      component.id,
      path.resolve('src/test/fixtures/m7/detected/fixed-descriptor.json'),
    )
    expect(state.project.components[0].evidenceLevel).toBe('detected')
    expect(core.validate(state.project).status).toBe('ready')
    await core.freezeVersion(root)
    await core.removeStackComponent(root, component.id)

    await expect(core.deleteComponent(root, component.id)).rejects.toMatchObject({
      code: 'COMPONENT_IN_USE',
    } satisfies Partial<StudioCoreError>)
    const archived = await core.archiveComponent(root, component.id)
    expect(archived.project.components[0].archivedAt).not.toBeNull()
    expect(archived.project.versions[0].snapshot.components[0].archivedAt).toBeNull()
  })

  it('derives explicit Adapter remediation tasks without executing or persisting referenced code', async () => {
    const root = await createRoot()
    const core = new StudioCore()
    await core.initProject(root, { name: 'Adapter remediation' })
    let state = await core.importComponent(
      root,
      path.resolve('src/test/fixtures/m22/legacy-adapter'),
    )
    const adapter = state.project.components[0]
    state = await core.addStackComponent(root, adapter.id)

    const validation = core.validate(state.project)
    expect(validation.status).toBe('blocked')
    expect(validation.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ADAPTER_UNVERIFIED' })]),
    )
    expect(validation.remediationTasks.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: 'adapter-work', status: 'complete' },
      { kind: 'contract-test', status: 'complete' },
      { kind: 'runtime-validation', status: 'required' },
    ])

    const reread = await core.inspectProject(root)
    expect(JSON.stringify(reread.project)).not.toContain('remediationTasks')
    expect(reread.project.components[0].source.files).not.toContain('dist/adapter.js')
  })

  it('remediates Pi as execution Owner and corrects MRAgent to evidence-backed memory/state-store', async () => {
    const root = await createRoot()
    const core = new StudioCore()
    await core.initProject(root, { name: 'Pi and MRAgent remediation' })
    let state = await core.importComponent(root, path.resolve('src/test/fixtures/m31/pi'))
    const pi = state.project.components[0]
    state = await core.importComponent(root, path.resolve('src/test/fixtures/m31/mr-agent'))
    const mr = state.project.components.find(
      ({ descriptor }) => descriptor.id === 'mr.agent.memory',
    )!
    expect(pi.descriptor.compatibility.level).toBe('unknown')
    expect(mr.descriptor.provides[0].capability).toBe('execution-controller')
    expect(pi.source.files).toContain('should-never-run.js')
    expect(mr.source.files).toContain('should-never-run.js')
    state = await core.addStackComponent(root, pi.id)
    state = await core.addStackComponent(root, mr.id)
    expect(core.validate(state.project).issues.map(({ code }) => code)).toContain(
      'COMPATIBILITY_UNKNOWN',
    )

    const piDescriptor: ComponentDescriptor = {
      ...pi.descriptor,
      runtimeAdapter: 'studio://runtime/harness-x',
      provides: [
        {
          capability: 'execution-controller',
          implementation: 'pi.agent.harness.controller',
          replaceability: 'adapter-required',
          confidence: 'detected',
          activation: 'owner-only',
        },
      ],
      compatibility: {
        level: 'adapter',
        validation: 'declared',
        detail: 'Pi 作为外层执行控制 Owner，通过受信 Harness Adapter 处置。',
        strategyRationale: 'Pi 的静态证据表明它持有外层执行循环。',
        strategySelectedAt: '2026-08-22T10:00:00.000Z',
      },
    }
    const mrDescriptor: ComponentDescriptor = {
      ...mr.descriptor,
      provides: [
        {
          capability: 'memory',
          implementation: 'mr.agent.memory.store',
          replaceability: 'replaceable',
          confidence: 'detected',
          activation: 'owner-only',
        },
        {
          capability: 'state-store',
          implementation: 'mr.agent.state.store',
          replaceability: 'replaceable',
          confidence: 'detected',
          activation: 'owner-only',
        },
      ],
      compatibility: {
        level: 'native',
        validation: 'declared',
        detail: 'MRAgent 仅提供 memory/state-store 契约，不接管执行控制。',
        strategyRationale: 'README 静态证据将职责限定为记忆与任务状态。',
        strategySelectedAt: '2026-08-22T10:01:00.000Z',
      },
    }
    state = await core.confirmComponentDescriptor(root, pi.id, piDescriptor)
    state = await core.confirmComponentDescriptor(root, mr.id, mrDescriptor)
    expect(state.project.components.find(({ id }) => id === pi.id)?.evidenceLevel).toBe('detected')
    state = await core.runComponentContractTest(root, pi.id)
    state = await core.runComponentContractTest(root, mr.id)
    state = await core.setOwner(root, 'execution-controller', pi.id)
    state = await core.setOwner(root, 'memory', mr.id)
    state = await core.setOwner(root, 'state-store', mr.id)

    const runtime: TrustedCompatibilityRuntimeGateway = {
      validate: (input) =>
        Promise.resolve({
          id: randomUUID(),
          componentId: input.componentId,
          adapterRef: input.adapterRef,
          status: 'succeeded',
          method: 'trusted-runtime-validation-v1',
          checks: [
            { name: 'whitelist', status: 'passed' },
            { name: 'kernel-start', status: 'passed' },
            { name: 'adapter-contract', status: 'passed' },
            { name: 'cancel', status: 'passed' },
            { name: 'cleanup', status: 'passed' },
          ],
          artifact: { name: 'compatibility-validation.json', contentHash: 'a'.repeat(64) },
          startedAt: '2026-08-22T10:02:00.000Z',
          finishedAt: '2026-08-22T10:02:01.000Z',
        }),
    }
    state = await core.runTrustedComponentValidation(root, pi.id, runtime)
    expect(core.validate(state.project).status).toBe('ready')
    const verifiedPi = state.project.components.find(({ id }) => id === pi.id)!
    expect(verifiedPi.descriptor.compatibility.validation).toBe('runtime-verified')
    expect(verifiedPi.descriptor.evidence.at(-1)).toMatchObject({
      kind: 'runtime-check',
      artifact: { contentHash: 'a'.repeat(64) },
    })
    expect(
      state.project.components.find(({ id }) => id === mr.id)?.descriptor.compatibility.validation,
    ).toBe('contract-tested')
  })

  it('keeps runtime cancellation, unknown adapters, stale revisions, and restore as zero-loss paths', async () => {
    const root = await createRoot()
    const core = new StudioCore()
    await core.initProject(root, { name: 'Compatibility recovery paths' })
    let state = await core.importComponent(root, path.resolve('src/test/fixtures/m7/harness-x'))
    const component = state.project.components[0]
    const revisionBeforeEdit = state.project.revision
    const contractDescriptor: ComponentDescriptor = {
      ...component.descriptor,
      runtimeAdapter: 'studio://runtime/harness-x',
      compatibility: {
        ...component.descriptor.compatibility,
        validation: 'declared',
        strategyRationale: '使用 Studio 内置精确白名单 Adapter。',
        strategySelectedAt: '2026-08-22T11:00:00.000Z',
      },
    }
    state = await core.confirmComponentDescriptor(root, component.id, contractDescriptor, {
      expectedRevision: revisionBeforeEdit,
    })
    await expect(
      core.confirmComponentDescriptor(root, component.id, contractDescriptor, {
        expectedRevision: revisionBeforeEdit,
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    state = await core.runComponentContractTest(root, component.id)
    const revisionBeforeRuntime = state.project.revision
    const controller = new AbortController()
    const runtime: TrustedCompatibilityRuntimeGateway = {
      validate: (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('已取消。', 'AbortError')),
            { once: true },
          )
        }),
    }
    const validation = core.runTrustedComponentValidation(root, component.id, runtime, {
      expectedRevision: revisionBeforeRuntime,
      signal: controller.signal,
    })
    controller.abort()
    await expect(validation).rejects.toMatchObject({ name: 'AbortError' })
    const cancelled = await core.inspectProject(root)
    expect(cancelled.project.revision).toBe(revisionBeforeRuntime)
    expect(cancelled.project.components[0].descriptor.compatibility.validation).toBe(
      'contract-tested',
    )

    state = await core.runTrustedComponentValidation(root, component.id, {
      validate: () =>
        Promise.resolve({
          id: randomUUID(),
          componentId: component.id,
          adapterRef: 'studio://runtime/harness-x',
          status: 'succeeded',
          method: 'trusted-runtime-validation-v1',
          checks: [
            { name: 'whitelist', status: 'passed' },
            { name: 'kernel-start', status: 'passed' },
            { name: 'adapter-contract', status: 'passed' },
            { name: 'cancel', status: 'passed' },
            { name: 'cleanup', status: 'passed' },
          ],
          startedAt: '2026-08-22T11:10:00.000Z',
          finishedAt: '2026-08-22T11:10:01.000Z',
          artifact: { name: 'compatibility-validation.json', contentHash: 'b'.repeat(64) },
        }),
    })
    const forged = {
      ...state.project.components[0].descriptor,
      compatibility: {
        ...state.project.components[0].descriptor.compatibility,
        validation: 'failed' as const,
      },
      evidence: [],
    }
    state = await core.confirmComponentDescriptor(root, component.id, forged)
    expect(state.project.components[0].descriptor.compatibility.validation).toBe('runtime-verified')
    expect(state.project.components[0].descriptor.evidence).not.toHaveLength(0)
    const changedContract: ComponentDescriptor = {
      ...state.project.components[0].descriptor,
      provides: state.project.components[0].descriptor.provides.map((provider, index) =>
        index === 0 ? { ...provider, activation: 'always-active' as const } : provider,
      ),
    }
    state = await core.confirmComponentDescriptor(root, component.id, changedContract)
    expect(state.project.components[0].descriptor.compatibility.validation).toBe('declared')
    const supersededContract = state.project.components[0].descriptor.evidence.find(
      ({ kind }) => kind === 'contract-test',
    )
    const supersededRuntime = state.project.components[0].descriptor.evidence.find(
      ({ kind }) => kind === 'runtime-check',
    )
    expect(typeof supersededContract?.supersededAt).toBe('string')
    expect(typeof supersededRuntime?.supersededAt).toBe('string')

    const unsafe = {
      ...state.project.components[0].descriptor,
      runtimeAdapter: './third-party.js',
    }
    state = await core.confirmComponentDescriptor(root, component.id, unsafe)
    state = await core.runComponentContractTest(root, component.id)
    await expect(
      core.runTrustedComponentValidation(root, component.id, {
        validate: () => Promise.reject(new Error('must not execute')),
      }),
    ).rejects.toMatchObject({ code: 'UNSAFE_SOURCE' })
    state = await core.archiveComponent(root, component.id)
    expect(state.project.components[0].archivedAt).not.toBeNull()
    state = await core.restoreComponent(root, component.id)
    expect(state.project.components[0].archivedAt).toBeNull()
    expect(state.project.components[0].auditTrail?.at(-1)?.action).toBe('restored')
  })
})
