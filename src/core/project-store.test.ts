import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StudioCoreError } from './project-errors'
import { StudioCore } from './studio-core'

const temporaryPaths: string[] = []

async function temporaryProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-project-store-'))
  temporaryPaths.push(root)
  return root
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  )
})

describe('ProjectStore', () => {
  it('writes atomically, keeps a valid backup, and rejects a stale revision', async () => {
    const root = await temporaryProject()
    const core = new StudioCore()
    const initialized = await core.initProject(root, { name: 'Atomic project' })
    const imported = await core.importComponent(
      root,
      path.resolve('src/test/fixtures/m7/harness-x'),
      { expectedRevision: initialized.project.revision },
    )

    expect(imported.project.revision).toBe(1)
    expect(
      JSON.parse(await readFile(path.join(root, '.agent-stack.backup'), 'utf8')),
    ).toMatchObject({
      revision: 0,
      name: 'Atomic project',
    })
    await expect(
      core.addStackComponent(root, imported.project.components[0].id, { expectedRevision: 0 }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' } satisfies Partial<StudioCoreError>)
  })

  it('recovers from the last valid backup and migrates the v0 file in place', async () => {
    const root = await temporaryProject()
    const core = new StudioCore()
    await core.initProject(root, { name: 'Recovery project' })
    await core.importComponent(root, path.resolve('src/test/fixtures/m7/harness-x'))
    await writeFile(path.join(root, '.agent-stack'), '{broken', 'utf8')

    const recovered = await core.inspectProject(root)
    expect(recovered.recovered).toBe(true)
    expect(recovered.project.revision).toBe(0)
    expect((await readdir(root)).some((name) => name.startsWith('.agent-stack.invalid-'))).toBe(
      true,
    )

    const legacy = structuredClone(recovered.project) as unknown as Record<string, unknown>
    legacy.formatVersion = 0
    delete legacy.$schema
    await writeFile(path.join(root, '.agent-stack'), `${JSON.stringify(legacy)}\n`, 'utf8')
    const migrated = await core.inspectProject(root)
    expect(migrated.migrated).toBe(true)
    expect(migrated.project.formatVersion).toBe(2)
  })

  it('serializes concurrent writers so only one matching revision can commit', async () => {
    const root = await temporaryProject()
    const core = new StudioCore()
    await core.initProject(root, { name: 'Concurrent project' })
    const results = await Promise.allSettled([
      core.importComponent(root, path.resolve('src/test/fixtures/m7/harness-x'), {
        expectedRevision: 0,
      }),
      core.importComponent(root, path.resolve('src/test/fixtures/m7/research-y'), {
        expectedRevision: 0,
      }),
    ])

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(({ status }) => status === 'rejected')
    expect(rejected).toMatchObject({ reason: { code: 'REVISION_CONFLICT' } })
    expect((await core.inspectProject(root)).project.revision).toBe(1)
  })

  it('recovers a stale lock left by a terminated process without removing a live lock', async () => {
    const root = await temporaryProject()
    const core = new StudioCore()
    await core.initProject(root, { name: 'Stale lock recovery' })
    const lockPath = path.join(root, '.agent-stack.lock')
    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: 2_147_483_647, createdAt: '2020-01-01T00:00:00.000Z' })}\n`,
      'utf8',
    )

    await expect(
      core.importComponent(root, path.resolve('src/test/fixtures/m7/harness-x'), {
        expectedRevision: 0,
      }),
    ).resolves.toMatchObject({ project: { revision: 1 } })

    await writeFile(
      lockPath,
      `${JSON.stringify({ pid: process.pid, createdAt: '2020-01-01T00:00:00.000Z' })}\n`,
      'utf8',
    )
    await expect(
      core.importComponent(root, path.resolve('src/test/fixtures/m7/research-y'), {
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  })

  it('migrates v1 to v2, recovers a failed migration, and refuses forward-format downgrade reads', async () => {
    const root = await temporaryProject()
    const core = new StudioCore()
    const initialized = await core.initProject(root, { name: 'Format compatibility' })
    const projectPath = path.join(root, '.agent-stack')
    const versionOne = structuredClone(initialized.project) as unknown as Record<string, unknown>
    versionOne.$schema = 'https://agentstack.studio/schemas/project-v1.json'
    versionOne.formatVersion = 1
    delete versionOne.workflows
    await writeFile(projectPath, `${JSON.stringify(versionOne, null, 2)}\n`, 'utf8')

    const migrated = await core.inspectProject(root)
    expect(migrated).toMatchObject({
      migrated: true,
      project: { formatVersion: 2, workflows: [] },
    })

    await writeFile(
      projectPath,
      `${JSON.stringify({ $schema: versionOne.$schema, formatVersion: 1, name: 'broken' })}\n`,
      'utf8',
    )
    const recovered = await core.inspectProject(root)
    expect(recovered.recovered).toBe(true)
    expect(recovered.project.formatVersion).toBe(2)

    const forward = { ...recovered.project, formatVersion: 3, $schema: 'future-project-v3' }
    await writeFile(projectPath, `${JSON.stringify(forward, null, 2)}\n`, 'utf8')
    await expect(core.auditProject(root)).rejects.toMatchObject({
      code: 'PROJECT_INVALID',
      details: { formatVersion: 3, supportedVersion: 2 },
    } satisfies Partial<StudioCoreError>)
  })

  it('rejects a tampered immutable snapshot and can recover a prior verified version', async () => {
    const root = await temporaryProject()
    const core = new StudioCore()
    await core.initProject(root, { name: 'Integrity recovery' })
    let state = await core.importComponent(root, path.resolve('src/test/fixtures/m7/detected'))
    const component = state.project.components[0]
    state = await core.confirmComponentDescriptorFile(
      root,
      component.id,
      path.resolve('src/test/fixtures/m7/detected/fixed-descriptor.json'),
    )
    state = await core.addStackComponent(root, component.id)
    await core.freezeVersion(root)
    await core.archiveComponent(root, component.id)

    const projectPath = path.join(root, '.agent-stack')
    const tampered = JSON.parse(await readFile(projectPath, 'utf8')) as {
      versions: Array<{ snapshot: { project: { name: string } } }>
    }
    tampered.versions[0].snapshot.project.name = 'Tampered history'
    await writeFile(projectPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8')

    await expect(core.auditProject(root)).rejects.toMatchObject({
      code: 'PROJECT_INTEGRITY_FAILED',
      details: { failures: [{ code: 'VERSION_HASH_MISMATCH' }] },
    } satisfies Partial<StudioCoreError>)
    const recovered = await core.inspectProject(root)
    expect(recovered.recovered).toBe(true)
    expect(recovered.integrity).toMatchObject({ status: 'verified', versionsChecked: 1 })
    expect(recovered.project.versions[0].snapshot.project.name).toBe('Integrity recovery')
  })
})
