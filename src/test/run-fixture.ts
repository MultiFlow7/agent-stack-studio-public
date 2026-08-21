import { builtInComponents } from '../main/components/built-in-components'
import { buildRunManifest } from '../main/domain/run-manifest'
import { compileRuntimePlan } from '../main/domain/runtime-plan-compiler'
import type { ExecutionMode } from '../shared/agent'
import type { AgentVersion } from '../shared/agent-detail'
import type { ComponentRecord } from '../shared/component'
import type { RunManifest } from '../shared/run'

const timestamp = '2026-08-19T08:00:00.000Z'
export const fixtureAgentId = '20000000-0000-4000-8000-000000000001'
export const fixtureVersionId = '30000000-0000-4000-8000-000000000001'
export const fixtureRunId = '40000000-0000-4000-8000-000000000001'

export function createRunFixture(executionMode: ExecutionMode = 'agent-loop'): {
  manifest: RunManifest
  component: ComponentRecord
  version: AgentVersion
} {
  const component: ComponentRecord = {
    id: builtInComponents[0].id,
    descriptor: structuredClone(builtInComponents[0].descriptor),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const compilation = compileRuntimePlan({
    agentId: fixtureAgentId,
    stackRevision: 2,
    executionMode,
    components: [component],
    owners: [],
  })
  if (compilation.status !== 'ready') throw new Error('Run test fixture must compile.')
  const version: AgentVersion = {
    id: fixtureVersionId,
    agentId: fixtureAgentId,
    versionNumber: 1,
    snapshot: {
      agent: {
        id: fixtureAgentId,
        name: 'M3 样例 Agent',
        description: '',
        executionMode,
      },
      stack: {
        executionMode,
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
    createdAt: timestamp,
  }
  return {
    component,
    version,
    manifest: buildRunManifest({
      runId: fixtureRunId,
      version,
      plan: compilation.plan,
      components: [component],
      prompt: '执行本地样例',
      timeoutMs: 10_000,
      electronVersion: '43.4.1',
      architecture: 'arm64',
      createdAt: timestamp,
    }),
  }
}
