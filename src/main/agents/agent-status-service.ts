import {
  agentStatusListSchema,
  agentStatusProjectionSchema,
  type AgentStatusProjection,
} from '../../shared/agent-status'
import type { AgentListInput } from '../../shared/agent'
import type { ExperimentRecord } from '../../shared/experiment'
import type { PublishHistory, PublishTarget } from '../../shared/publish'
import type { RunRecord } from '../../shared/run'
import type { StackState } from '../../shared/runtime-plan'
import type { AgentService } from './agent-service'

interface AgentStatusDependencies {
  agents: Pick<AgentService, 'get' | 'list'>
  stacks: { getStack(agentId: string): StackState }
  runs: { list(agentId: string | null): RunRecord[] }
  experiments: { list(agentId: string | null): ExperimentRecord[] }
  publishing: {
    targets(): PublishTarget[]
    history(targetId: PublishTarget['id'], agentId: string): PublishHistory
  }
}

export class AgentStatusService {
  readonly #dependencies: AgentStatusDependencies

  constructor(dependencies: AgentStatusDependencies) {
    this.#dependencies = dependencies
  }

  list(input: AgentListInput = { scope: 'active' }): AgentStatusProjection[] {
    return agentStatusListSchema.parse(
      this.#dependencies.agents.list(input).map(({ id }) => this.get(id)),
    )
  }

  get(agentId: string): AgentStatusProjection {
    const detail = this.#dependencies.agents.get(agentId)
    const stack = this.#dependencies.stacks.getStack(agentId)
    const latestRun = this.#dependencies.runs.list(agentId)[0] ?? null
    const latestExperiment = this.#dependencies.experiments.list(agentId)[0] ?? null
    const latestPublish = this.#dependencies.publishing
      .targets()
      .flatMap((target) =>
        this.#dependencies.publishing
          .history(target.id, agentId)
          .receipts.map((receipt) => ({ target, receipt })),
      )
      .sort((left, right) =>
        (right.receipt.completedAt ?? right.receipt.createdAt).localeCompare(
          left.receipt.completedAt ?? left.receipt.createdAt,
        ),
      )[0]

    return agentStatusProjectionSchema.parse({
      agent: detail.agent,
      draftRevision: detail.draft.revision,
      currentVersion: detail.versions[0]
        ? {
            id: detail.versions[0].id,
            versionNumber: detail.versions[0].versionNumber,
            createdAt: detail.versions[0].createdAt,
          }
        : null,
      stack: {
        status: stack.compilation.status,
        componentCount: stack.components.length,
        ownerCount: stack.owners.length,
        issueCount: stack.compilation.issues.length,
      },
      latestRun: latestRun
        ? { id: latestRun.id, status: latestRun.status, updatedAt: latestRun.updatedAt }
        : null,
      latestExperiment: latestExperiment
        ? {
            id: latestExperiment.id,
            name: latestExperiment.name,
            status: latestExperiment.status,
            updatedAt: latestExperiment.updatedAt,
          }
        : null,
      latestPublish: latestPublish
        ? {
            targetId: latestPublish.target.id,
            targetLabel: latestPublish.target.label,
            status: latestPublish.receipt.status,
            occurredAt: latestPublish.receipt.completedAt ?? latestPublish.receipt.createdAt,
          }
        : null,
    })
  }
}
