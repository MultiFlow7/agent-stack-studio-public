import {
  buildCommandCenterSnapshot,
  searchCommandCenter,
  type CommandCenterSource,
} from '../../core/command-center'
import type { AgentStatusProjection } from '../../shared/agent-status'
import type { ComponentCatalogItem } from '../../shared/component-catalog'
import type { CommandCenterResult, CommandCenterSnapshot } from '../../shared/command-center'
import type { ExperimentRecord } from '../../shared/experiment'
import type { RunRecord } from '../../shared/run'
import type { StudioProjectState } from '../../shared/studio-project'

interface CommandCenterDependencies {
  projects: { summary(): Promise<StudioProjectState> }
  agents: { list(input: { scope: 'active' | 'archived' }): AgentStatusProjection[] }
  components: { list(): ComponentCatalogItem[] }
  runs: { list(agentId: string | null): RunRecord[] }
  experiments: { list(agentId: string | null): ExperimentRecord[] }
  now?: () => string
}

export class CommandCenterService {
  readonly #dependencies: CommandCenterDependencies

  constructor(dependencies: CommandCenterDependencies) {
    this.#dependencies = dependencies
  }

  async snapshot(): Promise<CommandCenterSnapshot> {
    return buildCommandCenterSnapshot(await this.#source())
  }

  async search(query: string): Promise<CommandCenterResult[]> {
    return searchCommandCenter(await this.#source(), query)
  }

  async #source(): Promise<CommandCenterSource> {
    const [project, activeAgents, archivedAgents, components, runs, experiments] =
      await Promise.all([
        this.#dependencies.projects.summary(),
        Promise.resolve(this.#dependencies.agents.list({ scope: 'active' })),
        Promise.resolve(this.#dependencies.agents.list({ scope: 'archived' })),
        Promise.resolve(this.#dependencies.components.list()),
        Promise.resolve(this.#dependencies.runs.list(null)),
        Promise.resolve(this.#dependencies.experiments.list(null)),
      ])
    return {
      project,
      activeAgents,
      archivedAgents,
      components,
      runs,
      experiments,
      now: this.#dependencies.now?.(),
    }
  }
}
