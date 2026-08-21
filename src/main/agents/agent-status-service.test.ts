import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '../../shared/agent'
import type { AgentDetail } from '../../shared/agent-detail'
import type { ExperimentRecord } from '../../shared/experiment'
import {
  localContractTestTargetId,
  type PublishReceipt,
  type PublishTarget,
} from '../../shared/publish'
import type { RunRecord } from '../../shared/run'
import type { StackState } from '../../shared/runtime-plan'
import { AgentStatusService } from './agent-status-service'

const agent: Agent = {
  id: '92d74aaf-b86c-4e84-978b-b35d227e0c79',
  name: 'Status Agent',
  description: 'Projects existing local facts.',
  executionMode: 'agent-loop',
  archivedAt: null,
  createdAt: '2026-08-20T01:00:00.000Z',
  updatedAt: '2026-08-20T01:00:00.000Z',
}

const detail = {
  agent,
  draft: {
    agentId: agent.id,
    executionMode: agent.executionMode,
    revision: 4,
    updatedAt: agent.updatedAt,
  },
  versions: [
    {
      id: '3b129300-9e8a-4a70-ae02-e2dc1cba565e',
      agentId: agent.id,
      versionNumber: 2,
      snapshot: {},
      contentHash: 'a'.repeat(64),
      createdAt: '2026-08-20T02:00:00.000Z',
    },
  ],
  location: null,
} as unknown as AgentDetail

function createService(options?: { empty?: boolean }) {
  const run = {
    id: 'd5f4d198-02db-46e5-8156-5a888f23ceef',
    status: 'succeeded',
    updatedAt: '2026-08-20T04:00:00.000Z',
  } as RunRecord
  const experiment = {
    id: 'c64105e1-cb83-48c4-b53c-9ab2a66d441f',
    agentId: agent.id,
    name: 'Latency baseline',
    status: 'completed',
    updatedAt: '2026-08-20T05:00:00.000Z',
  } as ExperimentRecord
  const receipt = {
    id: '914b516e-8ee0-4d56-aef6-65c62f1f2b38',
    targetId: localContractTestTargetId,
    agentId: agent.id,
    agentVersionId: detail.versions[0].id,
    packageHash: 'b'.repeat(64),
    idempotencyKey: 'c'.repeat(64),
    attempt: 1,
    status: 'succeeded',
    remoteAgentId: 'contract-agent',
    remoteVersionId: 'contract-version',
    response: { message: 'ok', publishedFields: [], testOnly: true },
    failure: null,
    createdAt: '2026-08-20T05:30:00.000Z',
    completedAt: '2026-08-20T06:00:00.000Z',
  } satisfies PublishReceipt
  const target = {
    id: localContractTestTargetId,
    connector: 'multica',
    transport: 'contract-test',
    label: '本地 Contract Test Target',
    description: 'No network.',
    availability: 'ready',
    externalSideEffect: false,
  } satisfies PublishTarget
  const getStack = vi.fn(
    () =>
      ({
        agentId: agent.id,
        revision: 4,
        components: [{ id: 'component-a' }, { id: 'component-b' }],
        owners: [{ capability: 'model-provider' }],
        compilation: { status: 'ready', issues: [], plan: {} },
      }) as unknown as StackState,
  )
  const listAgents = vi.fn(() => (options?.empty ? [] : [agent]))
  const service = new AgentStatusService({
    agents: { list: listAgents, get: vi.fn(() => detail) },
    stacks: { getStack },
    runs: { list: vi.fn(() => (options?.empty ? [] : [run])) },
    experiments: { list: vi.fn(() => (options?.empty ? [] : [experiment])) },
    publishing: {
      targets: vi.fn(() => [target]),
      history: vi.fn(() => ({ mapping: null, receipts: options?.empty ? [] : [receipt] })),
    },
  })
  return { service, getStack, listAgents }
}

describe('AgentStatusService', () => {
  it('projects version, Stack, Run, experiment and publish facts without persisting copies', () => {
    const { service } = createService()

    expect(service.get(agent.id)).toEqual({
      agent,
      draftRevision: 4,
      currentVersion: {
        id: detail.versions[0].id,
        versionNumber: 2,
        createdAt: '2026-08-20T02:00:00.000Z',
      },
      stack: { status: 'ready', componentCount: 2, ownerCount: 1, issueCount: 0 },
      latestRun: {
        id: 'd5f4d198-02db-46e5-8156-5a888f23ceef',
        status: 'succeeded',
        updatedAt: '2026-08-20T04:00:00.000Z',
      },
      latestExperiment: {
        id: 'c64105e1-cb83-48c4-b53c-9ab2a66d441f',
        name: 'Latency baseline',
        status: 'completed',
        updatedAt: '2026-08-20T05:00:00.000Z',
      },
      latestPublish: {
        targetId: localContractTestTargetId,
        targetLabel: '本地 Contract Test Target',
        status: 'succeeded',
        occurredAt: '2026-08-20T06:00:00.000Z',
      },
    })
  })

  it('preserves list scope and returns an empty projection list without dependent reads', () => {
    const { service, getStack, listAgents } = createService({ empty: true })

    expect(service.list({ scope: 'archived' })).toEqual([])
    expect(listAgents).toHaveBeenCalledWith({ scope: 'archived' })
    expect(getStack).not.toHaveBeenCalled()
  })
})
