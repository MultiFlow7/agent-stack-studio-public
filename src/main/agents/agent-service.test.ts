import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRepository } from '../persistence/agent-repository'
import { WorkspaceService } from '../workspace/workspace-service'
import { AgentService } from './agent-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('AgentService', () => {
  it('imports a static scan into a local workspace and creates the first version', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-service-'))
    temporaryDirectories.push(directory)
    const repository = new AgentRepository(path.join(directory, 'studio.sqlite3'))
    const service = new AgentService(
      repository,
      new WorkspaceService(path.join(directory, 'workspaces')),
    )

    const detail = await service.import({
      scanId: '7f1447cc-6a9c-47e3-9356-dfabd6170900',
      sourcePath: '/Users/researcher/evaluation-agent',
      suggestedName: 'Evaluation Agent',
      projectType: 'node',
      evidence: [{ kind: 'manifest', path: 'package.json', detail: 'Node 包清单' }],
      warnings: [],
    })

    expect(detail.location?.sourceKind).toBe('local-import')
    expect(detail.versions).toHaveLength(1)
    expect(detail.versions[0]?.snapshot.agent.name).toBe('Evaluation Agent')
    const workspaceManifest = await readFile(
      path.join(detail.location!.workspacePath, 'workspace.json'),
      'utf8',
    )
    expect(JSON.parse(workspaceManifest)).toEqual({ agentId: detail.agent.id, formatVersion: 1 })
    repository.close()
  })

  it('creates a fresh duplicate workspace and removes it after safe permanent deletion', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-service-'))
    temporaryDirectories.push(directory)
    const repository = new AgentRepository(path.join(directory, 'studio.sqlite3'))
    const service = new AgentService(
      repository,
      new WorkspaceService(path.join(directory, 'workspaces')),
    )
    const source = await service.create({
      name: 'Reusable Agent',
      description: '',
      executionMode: 'workflow',
    })

    const duplicate = await service.duplicate({ id: source.id })
    expect(duplicate.agent.name).toBe('Reusable Agent 副本')
    expect(
      JSON.parse(
        await readFile(path.join(duplicate.location!.workspacePath, 'workspace.json'), 'utf8'),
      ),
    ).toEqual({ agentId: duplicate.agent.id, formatVersion: 1 })
    service.archive(duplicate.agent.id)
    const result = await service.delete(duplicate.agent.id)

    expect(result.deleted).toBe(true)
    await expect(access(duplicate.location!.workspacePath)).rejects.toThrow()
    repository.close()
  })

  it('blocks new executable work for an archived Agent while keeping it inspectable', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-service-'))
    temporaryDirectories.push(directory)
    const repository = new AgentRepository(path.join(directory, 'studio.sqlite3'))
    const service = new AgentService(
      repository,
      new WorkspaceService(path.join(directory, 'workspaces')),
    )
    const agent = await service.create({
      name: 'Archived Agent',
      description: '',
      executionMode: 'agent-loop',
    })
    service.archive(agent.id)

    expect(service.get(agent.id).agent.archivedAt).not.toBeNull()
    expect(() => service.getActive(agent.id)).toThrow('请先恢复')
    expect(() => service.createVersion(agent.id)).toThrow('请先恢复')
    await expect(service.duplicate({ id: agent.id })).rejects.toThrow('请先恢复')
    repository.close()
  })

  it('removes a newly-created workspace when repository creation fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-service-cleanup-'))
    temporaryDirectories.push(directory)
    const repository = new AgentRepository(path.join(directory, 'studio.sqlite3'))
    const workspaceRoot = path.join(directory, 'workspaces')
    const service = new AgentService(repository, new WorkspaceService(workspaceRoot))
    vi.spyOn(repository, 'create').mockImplementationOnce(() => {
      throw new Error('simulated persistence failure')
    })

    await expect(
      service.create({ name: 'Cleanup Agent', description: '', executionMode: 'agent-loop' }),
    ).rejects.toThrow('simulated persistence failure')
    expect(await readdir(workspaceRoot)).toEqual([])
    repository.close()
  })
})
