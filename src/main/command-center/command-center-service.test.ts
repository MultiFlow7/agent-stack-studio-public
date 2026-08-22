import { describe, expect, it, vi } from 'vitest'
import type { AgentStatusProjection } from '../../shared/agent-status'
import type { ComponentCatalogItem } from '../../shared/component-catalog'
import type { ExperimentRecord } from '../../shared/experiment'
import type { RunRecord } from '../../shared/run'
import type { StudioProjectState } from '../../shared/studio-project'
import { CommandCenterService } from './command-center-service'

describe('CommandCenterService', () => {
  it('aggregates existing local services without persisting a second workspace model', async () => {
    const listAgents = vi.fn(({ scope }: { scope: 'active' | 'archived' }) =>
      scope === 'active'
        ? ([
            {
              agent: {
                id: '92d74aaf-b86c-4e84-978b-b35d227e0c79',
                name: 'Research Agent',
                archivedAt: null,
              },
              draftRevision: 1,
            } as AgentStatusProjection,
          ] satisfies AgentStatusProjection[])
        : [],
    )
    const service = new CommandCenterService({
      projects: {
        summary: vi.fn(() =>
          Promise.resolve({
            project: { name: 'Fixture Studio', revision: 2 },
            validation: { status: 'blocked', issues: [{ code: 'EMPTY_STACK' }] },
            changedExternally: false,
          } as unknown as StudioProjectState),
        ),
      },
      agents: { list: listAgents },
      components: { list: vi.fn(() => [] as ComponentCatalogItem[]) },
      runs: { list: vi.fn(() => [] as RunRecord[]) },
      experiments: { list: vi.fn(() => [] as ExperimentRecord[]) },
      now: () => '2026-08-21T01:02:00.000Z',
    })

    await expect(service.snapshot()).resolves.toMatchObject({
      workspace: { name: 'Fixture Studio', status: 'blocked', issueCount: 1 },
      counts: { activeAgents: 1, archivedAgents: 0 },
    })
    await expect(service.search('Research')).resolves.toEqual([
      expect.objectContaining({ label: 'Research Agent', category: 'agent' }),
    ])
    expect(listAgents).toHaveBeenCalledWith({ scope: 'active' })
    expect(listAgents).toHaveBeenCalledWith({ scope: 'archived' })
  })
})
