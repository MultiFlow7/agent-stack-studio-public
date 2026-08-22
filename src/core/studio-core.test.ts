import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StudioCoreError } from './project-errors'
import { StudioCore } from './studio-core'

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
})
