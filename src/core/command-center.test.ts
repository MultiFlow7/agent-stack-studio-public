import { describe, expect, it } from 'vitest'
import type { AgentStatusProjection } from '../shared/agent-status'
import type { ComponentCatalogItem } from '../shared/component-catalog'
import type { ExperimentRecord } from '../shared/experiment'
import type { RunRecord } from '../shared/run'
import type { StudioProjectState } from '../shared/studio-project'
import {
  buildCommandCenterSnapshot,
  searchCommandCenter,
  type CommandCenterSource,
} from './command-center'

const agentId = '92d74aaf-b86c-4e84-978b-b35d227e0c79'
const runId = 'd5f4d198-02db-46e5-8156-5a888f23ceef'
const componentId = '6bb9d2c4-77ed-42f3-babf-18664187d715'
const experimentId = 'c64105e1-cb83-48c4-b53c-9ab2a66d441f'

function source(overrides: Partial<CommandCenterSource> = {}): CommandCenterSource {
  const project = {
    project: { id: '86203a4b-faa8-4464-8c68-9718039c02ea', name: 'Research Stack', revision: 7 },
    validation: { status: 'ready', issues: [] },
    changedExternally: false,
  } as unknown as StudioProjectState
  const agent = {
    agent: { id: agentId, name: 'Research Agent', archivedAt: null },
    draftRevision: 4,
  } as AgentStatusProjection
  const component = {
    component: {
      id: componentId,
      descriptor: { id: 'studio://components/evaluator', name: 'Latency Evaluator' },
    },
  } as ComponentCatalogItem
  const run = {
    id: runId,
    agentId,
    status: 'running',
    updatedAt: '2026-08-21T01:00:00.000Z',
  } as RunRecord
  const experiment = {
    id: experimentId,
    agentId,
    name: 'Latency baseline',
  } as ExperimentRecord
  return {
    project,
    activeAgents: [agent],
    archivedAgents: [],
    components: [component],
    runs: [run],
    experiments: [experiment],
    now: '2026-08-21T01:02:00.000Z',
    ...overrides,
  }
}

describe('command center core', () => {
  it('projects the real workspace, active Run and local entity counts', () => {
    expect(buildCommandCenterSnapshot(source())).toEqual({
      workspace: { status: 'ready', name: 'Research Stack', revision: 7, issueCount: 0 },
      activity: {
        status: 'active',
        activeRunCount: 1,
        latestRun: {
          id: runId,
          agentId,
          status: 'running',
          updatedAt: '2026-08-21T01:00:00.000Z',
        },
      },
      counts: { activeAgents: 1, archivedAgents: 0, components: 1, runs: 1, experiments: 1 },
      refreshedAt: '2026-08-21T01:02:00.000Z',
    })
  })

  it('distinguishes external project changes and a failed latest Run', () => {
    const input = source({
      project: {
        ...source().project,
        changedExternally: true,
      },
      runs: [
        {
          ...source().runs[0],
          status: 'failed',
          updatedAt: '2026-08-21T01:03:00.000Z',
        } as RunRecord,
      ],
    })
    const snapshot = buildCommandCenterSnapshot(input)
    expect(snapshot.workspace.status).toBe('changed-externally')
    expect(snapshot.activity).toMatchObject({ status: 'attention', activeRunCount: 0 })
  })

  it('searches navigation, actions and local entities with deterministic ranking', () => {
    expect(searchCommandCenter(source(), 'Research Agent')[0]).toMatchObject({
      category: 'agent',
      label: 'Research Agent',
      destination: { kind: 'agent', agentId },
    })
    expect(searchCommandCenter(source(), 'evaluator')[0]).toMatchObject({
      category: 'component',
      destination: { kind: 'component', componentId },
    })
    expect(searchCommandCenter(source(), '刷新')[0]).toMatchObject({
      category: 'action',
      destination: { kind: 'action', action: 'refresh' },
    })
    expect(searchCommandCenter(source(), '')).toHaveLength(12)
  })
})
