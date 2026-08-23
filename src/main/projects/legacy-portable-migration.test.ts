import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioCore } from '../../core/studio-core'
import { isProjectAgentVersionReference } from '../../shared/agent-detail'
import { builtInComponents } from '../components/built-in-components'
import { AgentRepository } from '../persistence/agent-repository'
import { ComponentRepository } from '../persistence/component-repository'
import { migrateLegacyPortableFacts } from './legacy-portable-migration'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'm30-legacy-'))
  directories.push(root)
  const databasePath = path.join(root, 'studio.sqlite3')
  const workspace = path.join(root, 'workspaces', 'legacy-agent')
  const agents = new AgentRepository(databasePath)
  const components = new ComponentRepository(databasePath)
  const agent = agents.create(
    { name: 'Legacy Agent', description: '待迁移', executionMode: 'agent-loop' },
    { location: { workspacePath: workspace, sourceKind: 'blank', sourcePath: null } },
  )
  const component = components.save(builtInComponents[0].descriptor, builtInComponents[0].id)
  components.addToStack(agent.id, component.id)
  const version = agents.createVersion(agent.id)
  return { root, workspace, agents, components, agent, version }
}

describe('legacy portable fact migration', () => {
  it('moves descriptors, Stack and immutable Versions to .agent-stack idempotently', async () => {
    const setup = await fixture()
    const first = await migrateLegacyPortableFacts({
      agents: setup.agents,
      components: setup.components,
      workspacesRoot: path.join(setup.root, 'workspaces'),
    })

    expect(first).toEqual({ migratedAgentIds: [setup.agent.id], failed: [] })
    const project = await new StudioCore().inspectProject(setup.workspace)
    expect(project.project.id).toBe(setup.agent.id)
    expect(project.project.components).toHaveLength(1)
    expect(project.project.stack.componentIds).toEqual([builtInComponents[0].id])
    expect(project.project.versions[0]?.id).toBe(setup.version.id)
    expect(setup.agents.projectLink(setup.agent.id)?.projectPath).toBe(project.path)
    const migratedVersion = setup.agents.getDetail(setup.agent.id).versions[0]
    if (!migratedVersion) throw new Error('Migrated version is missing.')
    expect(isProjectAgentVersionReference(migratedVersion.snapshot)).toBe(true)
    expect(setup.components.list()).toEqual([])
    await expect(access(`${project.path}.migration-backup`)).resolves.toBeUndefined()
    expect(JSON.stringify(project.project)).not.toContain('/Users/')

    const second = await migrateLegacyPortableFacts({
      agents: setup.agents,
      components: setup.components,
      workspacesRoot: path.join(setup.root, 'workspaces'),
    })
    expect(second).toEqual({ migratedAgentIds: [], failed: [] })
    setup.agents.close()
    setup.components.close()
  })

  it('preserves SQLite facts on conflict and completes safely after the conflict is removed', async () => {
    const setup = await fixture()
    const core = new StudioCore()
    await core.initProject(setup.workspace, { name: 'Legacy Agent' })

    const failed = await migrateLegacyPortableFacts({
      agents: setup.agents,
      components: setup.components,
      workspacesRoot: path.join(setup.root, 'workspaces'),
      core,
    })
    expect(failed.failed[0]).toMatchObject({ agentId: setup.agent.id })
    expect(setup.agents.projectLink(setup.agent.id)).toBeNull()
    expect(setup.components.list()).toHaveLength(1)
    const conflictingProject = JSON.parse(
      await readFile(path.join(setup.workspace, '.agent-stack'), 'utf8'),
    ) as { id?: unknown }
    expect(conflictingProject.id).not.toBe(setup.agent.id)

    await rm(path.join(setup.workspace, '.agent-stack'))
    const recovered = await migrateLegacyPortableFacts({
      agents: setup.agents,
      components: setup.components,
      workspacesRoot: path.join(setup.root, 'workspaces'),
      core,
    })
    expect(recovered).toEqual({ migratedAgentIds: [setup.agent.id], failed: [] })
    setup.agents.close()
    setup.components.close()
  })
})
