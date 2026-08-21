import { describe, expect, it, vi } from 'vitest'
import type { Agent, AgentListInput } from '../../shared/agent'
import type { AgentDetail } from '../../shared/agent-detail'
import type { ComponentRecord } from '../../shared/component'
import type { StackState } from '../../shared/runtime-plan'
import { builtInComponents } from './built-in-components'
import { ComponentCatalogService } from './component-catalog-service'

const component: ComponentRecord = {
  ...builtInComponents[0],
  createdAt: '2026-08-20T01:00:00.000Z',
  updatedAt: '2026-08-20T02:00:00.000Z',
}

const activeAgent: Agent = {
  id: '92d74aaf-b86c-4e84-978b-b35d227e0c79',
  name: 'Active Agent',
  description: '',
  executionMode: 'agent-loop',
  archivedAt: null,
  createdAt: '2026-08-20T01:00:00.000Z',
  updatedAt: '2026-08-20T01:00:00.000Z',
}

const archivedAgent: Agent = {
  ...activeAgent,
  id: '0567f861-b2ae-4a48-a1c1-01cbcd4f119d',
  name: 'Archived Agent',
  archivedAt: '2026-08-20T05:00:00.000Z',
}

function detail(agent: Agent, options: { usesDraft: boolean; usesVersion: boolean }): AgentDetail {
  return {
    agent,
    draft: {
      agentId: agent.id,
      executionMode: agent.executionMode,
      revision: options.usesDraft ? 3 : 1,
      updatedAt: agent.updatedAt,
    },
    versions: options.usesVersion
      ? [
          {
            id:
              agent.id === activeAgent.id
                ? '3b129300-9e8a-4a70-ae02-e2dc1cba565e'
                : '154b25e9-8e01-41b9-bf31-e6c7e053df4a',
            agentId: agent.id,
            versionNumber: 1,
            snapshot: {
              agent: {
                id: agent.id,
                name: agent.name,
                description: agent.description,
                executionMode: agent.executionMode,
              },
              stack: {
                executionMode: agent.executionMode,
                revision: 2,
                components: [
                  {
                    componentId: component.id,
                    contractId: component.descriptor.id,
                    version: component.descriptor.version,
                  },
                ],
                capabilityOwners: [],
              },
            },
            contentHash: 'a'.repeat(64),
            createdAt:
              agent.id === activeAgent.id ? '2026-08-20T04:00:00.000Z' : '2026-08-20T03:00:00.000Z',
          },
        ]
      : [],
    location: null,
  }
}

describe('ComponentCatalogService', () => {
  it('projects current Agent usage, immutable affected versions and recorded validation', () => {
    const activeDetail = detail(activeAgent, { usesDraft: true, usesVersion: true })
    const archivedDetail = detail(archivedAgent, { usesDraft: false, usesVersion: true })
    const agents = {
      list: vi.fn((input: AgentListInput) =>
        input.scope === 'active' ? [activeAgent] : [archivedAgent],
      ),
      get: vi.fn((id: string) => (id === activeAgent.id ? activeDetail : archivedDetail)),
    }
    const service = new ComponentCatalogService({
      agents,
      components: {
        list: vi.fn(() => [component]),
        getStack: vi.fn(
          (agentId: string) =>
            ({
              agentId,
              revision: agentId === activeAgent.id ? 3 : 1,
              components: agentId === activeAgent.id ? [component] : [],
              owners: [],
              compilation: { status: 'blocked', issues: [{}], plan: null },
            }) as unknown as StackState,
        ),
      },
    })

    const item = service.get(component.id)
    expect(item.usedByAgents).toEqual([
      {
        id: activeAgent.id,
        name: activeAgent.name,
        archivedAt: null,
        draftRevision: 3,
      },
    ])
    expect(item.affectedVersions.map(({ agentName }) => agentName)).toEqual([
      activeAgent.name,
      archivedAgent.name,
    ])
    expect(item.validationRecord).toEqual({
      status: 'runtime-verified',
      recordedAt: component.updatedAt,
    })
    expect(service.list()).toHaveLength(1)
  })

  it('does not invent a validation time for declaration-only evidence', () => {
    const declared = {
      ...component,
      descriptor: {
        ...component.descriptor,
        compatibility: {
          ...component.descriptor.compatibility,
          validation: 'declared' as const,
        },
      },
    }
    const service = new ComponentCatalogService({
      agents: { list: vi.fn(() => []), get: vi.fn() },
      components: { list: vi.fn(() => [declared]), getStack: vi.fn() },
    })

    expect(service.get(declared.id).validationRecord).toBeNull()
  })
})
