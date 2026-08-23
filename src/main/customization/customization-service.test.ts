import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { knownInstallRecipes, recognizeGithubSource } from '../../core/install-recipes'
import type { StudioCoreError } from '../../core/project-errors'
import { StudioCore } from '../../core/studio-core'
import { installRecipeSchema, type InstallRecipe } from '../../shared/customization'
import { CustomizationService } from './customization-service'

const roots: string[] = []

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function temporaryRoot(): Promise<string> {
  const value = await mkdtemp(path.join(tmpdir(), 'studio-customization-'))
  roots.push(value)
  return value
}

async function fixtureRecipe(root: string): Promise<{
  markdown: string
  recipe: InstallRecipe
  source: string
}> {
  const source = path.join(root, 'known-source')
  const artifactPath = 'skills/safe-skill/SKILL.md'
  const licensePath = 'skills/safe-skill/LICENSE.txt'
  const markdown = '---\nname: safe-skill\ndescription: Fixture\n---\n\n# Safe Skill\n'
  const license = 'Apache License\nVersion 2.0\n'
  await mkdir(path.join(source, 'skills', 'safe-skill'), { recursive: true })
  await writeFile(path.join(source, artifactPath), markdown)
  await writeFile(path.join(source, licensePath), license)
  const recipe = installRecipeSchema.parse({
    id: 'fixture-safe-skill',
    title: 'Fixture Safe Skill',
    kind: 'skill-markdown',
    repository: 'fixture/safe-skill',
    commit: 'a'.repeat(40),
    artifactPath,
    artifactUrl: 'https://raw.githubusercontent.com/fixture/safe-skill/commit/SKILL.md',
    artifactSha256: hash(markdown),
    license: 'Apache-2.0',
    licensePath,
    licenseUrl: 'https://raw.githubusercontent.com/fixture/safe-skill/commit/LICENSE.txt',
    licenseSha256: hash(license),
    platforms: ['darwin-arm64', 'darwin-x64'],
    skillId: 'safe-skill',
    skillName: 'Safe Skill',
    supportedHarnesses: ['pi', 'openclaw'],
    harnessSupport: [
      { harnessId: 'pi', level: 'native', detail: 'Fixture native support.' },
      { harnessId: 'openclaw', level: 'adapted', detail: 'Fixture adapted support.' },
    ],
    capabilities: ['skill-provider'],
    executionPolicy: 'content-only',
    contentCompleteness: 'complete',
    limitations: [],
    verification: {
      status: 'content-verified',
      verifiedAt: '2026-08-23',
      method: 'pinned-sha256-content-smoke-v1',
      detail: 'Fixture content verified.',
    },
  })
  return { markdown, recipe, source }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('CustomizationService', () => {
  it('recognizes and installs a pinned local Markdown Skill without executing source code', async () => {
    const root = await temporaryRoot()
    const projectPath = path.join(root, 'project')
    const core = new StudioCore()
    await core.initProject(projectPath, { name: 'Known install' })
    const selected = await core.selectKnownHarness(projectPath, 'openclaw', { expectedRevision: 0 })
    const fixture = await fixtureRecipe(root)
    const service = new CustomizationService({ core, recipes: [fixture.recipe] })

    await expect(
      service.recognize({ source: fixture.source, harnessId: 'openclaw' }),
    ).resolves.toMatchObject({ status: 'known', recipe: { id: fixture.recipe.id } })
    const installed = await service.install({
      projectPath,
      recipeId: fixture.recipe.id,
      harnessId: 'openclaw',
      localSourcePath: fixture.source,
      expectedRevision: selected.project.revision,
      confirmed: true,
    })

    expect(installed).toMatchObject({
      status: 'installed',
      previousRevision: 1,
      revision: 2,
      artifactSha256: fixture.recipe.artifactSha256,
      executedThirdPartyCode: false,
      smokeTest: { status: 'passed' },
    })
    await expect(access(installed.snapshotPath)).resolves.toBeUndefined()
    const project = (await core.inspectProject(projectPath)).project
    expect(project.profile.skills).toContainEqual({
      id: fixture.recipe.skillId,
      name: fixture.recipe.skillName,
      markdown: fixture.markdown,
      enabled: true,
    })

    await expect(
      service.install({
        projectPath,
        recipeId: fixture.recipe.id,
        harnessId: 'openclaw',
        localSourcePath: fixture.source,
        expectedRevision: project.revision,
        confirmed: true,
      }),
    ).resolves.toMatchObject({ status: 'reused', revision: 2 })
  })

  it('restores the pre-install snapshot when the post-write Smoke Test fails', async () => {
    const root = await temporaryRoot()
    const projectPath = path.join(root, 'project')
    const core = new StudioCore()
    await core.initProject(projectPath, { name: 'Rollback install' })
    await core.selectKnownHarness(projectPath, 'pi', { expectedRevision: 0 })
    const fixture = await fixtureRecipe(root)
    const service = new CustomizationService({
      core,
      recipes: [fixture.recipe],
      verifyInstalled: () => Promise.reject(new Error('forced smoke failure')),
    })

    await expect(
      service.install({
        projectPath,
        recipeId: fixture.recipe.id,
        harnessId: 'pi',
        localSourcePath: fixture.source,
        expectedRevision: 1,
        confirmed: true,
      }),
    ).rejects.toMatchObject({
      code: 'CUSTOMIZATION_INSTALL_FAILED',
      details: { recovered: true },
    } satisfies Partial<StudioCoreError>)
    const restored = await core.inspectProject(projectPath)
    expect(restored.project.revision).toBe(1)
    expect(restored.project.profile.skills).toEqual([])
    expect(await readFile(restored.path, 'utf8')).not.toContain('safe-skill')
  })

  it('keeps checksum failures at zero writes and generates a complete unknown-source task', async () => {
    const root = await temporaryRoot()
    const projectPath = path.join(root, 'project')
    const core = new StudioCore()
    await core.initProject(projectPath, { name: 'Integrity install' })
    await core.selectKnownHarness(projectPath, 'openclaw', { expectedRevision: 0 })
    const fixture = await fixtureRecipe(root)
    await writeFile(path.join(fixture.source, fixture.recipe.artifactPath), 'tampered')
    const service = new CustomizationService({ core, recipes: [fixture.recipe] })

    await expect(
      service.install({
        projectPath,
        recipeId: fixture.recipe.id,
        harnessId: 'openclaw',
        localSourcePath: fixture.source,
        expectedRevision: 1,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'CUSTOMIZATION_INTEGRITY_FAILED' })
    expect((await core.inspectProject(projectPath)).project.revision).toBe(1)

    const unknown = path.join(root, 'unknown')
    await mkdir(unknown)
    await writeFile(path.join(unknown, 'package.json'), '{"name":"unknown-agent"}\n')
    const task = await service.task({ source: unknown, harnessId: 'pi', projectPath })
    expect(task.recognition.status).toBe('unknown')
    for (const section of [
      '强制安全边界',
      '能力映射待办',
      '实现文件计划',
      '测试与 Smoke Test',
      '验收条件',
    ]) {
      expect(task.markdown).toContain(section)
    }
  })

  it('detects drift, repairs a pinned update, smoke-tests, uninstalls, and restores by opaque id', async () => {
    const root = await temporaryRoot()
    const projectPath = path.join(root, 'project')
    const core = new StudioCore()
    await core.initProject(projectPath, { name: 'Lifecycle' })
    await core.selectKnownHarness(projectPath, 'pi', { expectedRevision: 0 })
    const fixture = await fixtureRecipe(root)
    const service = new CustomizationService({ core, recipes: [fixture.recipe] })

    await service.install({
      projectPath,
      recipeId: fixture.recipe.id,
      harnessId: 'pi',
      localSourcePath: fixture.source,
      expectedRevision: 1,
      confirmed: true,
    })
    await expect(
      service.smoke({ projectPath, recipeId: fixture.recipe.id, harnessId: 'pi' }),
    ).resolves.toMatchObject({
      status: 'passed',
      level: 'native',
      executedThirdPartyCode: false,
    })

    const installed = await core.inspectProject(projectPath)
    await core.updateAgentProfile(
      projectPath,
      {
        ...installed.project.profile,
        skills: installed.project.profile.skills.map((skill) =>
          skill.id === fixture.recipe.skillId
            ? { ...skill, markdown: `${skill.markdown}\ndrift` }
            : skill,
        ),
      },
      { expectedRevision: 2 },
    )
    await expect(service.check({ projectPath, harnessId: 'pi' })).resolves.toEqual([
      expect.objectContaining({ state: 'drifted' }),
    ])

    const updated = await service.install({
      projectPath,
      recipeId: fixture.recipe.id,
      harnessId: 'pi',
      localSourcePath: fixture.source,
      expectedRevision: 3,
      confirmed: true,
      operation: 'update',
    })
    expect(updated).toMatchObject({ operation: 'update', revision: 4 })
    const removed = await service.uninstall({
      projectPath,
      recipeId: fixture.recipe.id,
      harnessId: 'pi',
      expectedRevision: 4,
      confirmed: true,
    })
    expect(removed).toMatchObject({ status: 'uninstalled', revision: 5 })
    expect(removed.snapshotId).not.toBeNull()
    const restored = await service.restore({
      projectPath,
      snapshotId: removed.snapshotId!,
      expectedRevision: 5,
      confirmed: true,
    })
    expect(restored).toMatchObject({ status: 'restored', revision: 4 })
    await expect(service.check({ projectPath, harnessId: 'pi' })).resolves.toEqual([
      expect.objectContaining({ state: 'current' }),
    ])
  })

  it('restores the drifted pre-update state when update smoke fails', async () => {
    const root = await temporaryRoot()
    const projectPath = path.join(root, 'project')
    const core = new StudioCore()
    await core.initProject(projectPath, { name: 'Update rollback' })
    await core.selectKnownHarness(projectPath, 'openclaw', { expectedRevision: 0 })
    const fixture = await fixtureRecipe(root)
    let fail = false
    const service = new CustomizationService({
      core,
      recipes: [fixture.recipe],
      verifyInstalled: () =>
        fail ? Promise.reject(new Error('update smoke failed')) : Promise.resolve(),
    })
    await service.install({
      projectPath,
      recipeId: fixture.recipe.id,
      harnessId: 'openclaw',
      localSourcePath: fixture.source,
      expectedRevision: 1,
      confirmed: true,
    })
    const installed = await core.inspectProject(projectPath)
    const driftedMarkdown = `${fixture.markdown}\nlocal edit`
    await core.updateAgentProfile(
      projectPath,
      {
        ...installed.project.profile,
        skills: installed.project.profile.skills.map((skill) => ({
          ...skill,
          markdown: driftedMarkdown,
        })),
      },
      { expectedRevision: 2 },
    )
    fail = true
    await expect(
      service.install({
        projectPath,
        recipeId: fixture.recipe.id,
        harnessId: 'openclaw',
        localSourcePath: fixture.source,
        expectedRevision: 3,
        confirmed: true,
        operation: 'update',
      }),
    ).rejects.toMatchObject({
      code: 'CUSTOMIZATION_INSTALL_FAILED',
      details: { recovered: true },
    })
    const recovered = await core.inspectProject(projectPath)
    expect(recovered.project.revision).toBe(3)
    expect(recovered.project.profile.skills[0]?.markdown).toBe(driftedMarkdown)
  })

  it('uses the same pinned Skill content across Pi and OpenClaw capability matrices', async () => {
    const root = await temporaryRoot()
    const fixture = await fixtureRecipe(root)
    const levels = []
    for (const harnessId of ['pi', 'openclaw'] as const) {
      const projectPath = path.join(root, harnessId)
      const core = new StudioCore()
      await core.initProject(projectPath, { name: harnessId })
      await core.selectKnownHarness(projectPath, harnessId, { expectedRevision: 0 })
      const service = new CustomizationService({ core, recipes: [fixture.recipe] })
      await service.install({
        projectPath,
        recipeId: fixture.recipe.id,
        harnessId,
        localSourcePath: fixture.source,
        expectedRevision: 1,
        confirmed: true,
      })
      const result = await service.smoke({
        projectPath,
        recipeId: fixture.recipe.id,
        harnessId,
      })
      expect(result.artifactSha256).toBe(fixture.recipe.artifactSha256)
      levels.push(result.level)
    }
    expect(levels).toEqual(['native', 'adapted'])
  })

  it('recognizes all pinned official GitHub recipes without network access', () => {
    expect(knownInstallRecipes).toHaveLength(12)
    expect(new Set(knownInstallRecipes.map(({ artifactSha256 }) => artifactSha256)).size).toBe(12)
    const recognition = recognizeGithubSource('https://github.com/anthropics/skills', 'openclaw')
    expect(recognition?.availableRecipes.map(({ id }) => id)).toContain('anthropic-webapp-testing')
    expect(recognition).toMatchObject({
      status: 'known',
      recipe: {
        id: 'anthropic-algorithmic-art',
        commit: knownInstallRecipes[0]?.commit,
        artifactSha256: knownInstallRecipes[0]?.artifactSha256,
      },
    })
  })
})
