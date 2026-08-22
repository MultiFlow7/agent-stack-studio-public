import type {
  AddStackComponentInput,
  ComponentRecord,
  RemoveStackComponentInput,
  SelectCapabilityOwnerInput,
} from '../../shared/component'
import type { StackState } from '../../shared/runtime-plan'
import type { ComponentRepository } from '../persistence/component-repository'
import { builtInComponents } from './built-in-components'
import type { StudioProjectService } from '../projects/studio-project-service'
import { compileRuntimePlan } from '../domain/runtime-plan-compiler'

export class ComponentService {
  readonly #repository: ComponentRepository
  #projects: StudioProjectService | null = null

  constructor(repository: ComponentRepository) {
    this.#repository = repository
  }

  connectProject(projects: StudioProjectService): void {
    this.#projects = projects
  }

  ensureBuiltIns(): void {
    for (const component of builtInComponents) {
      this.#repository.ensure(component.descriptor, component.id)
    }
  }

  loadDemoData(): ComponentRecord[] {
    this.ensureBuiltIns()
    return this.list()
  }

  list(): ComponentRecord[] {
    const activeAgentId = this.#projects?.activeAgentId()
    const state = activeAgentId ? this.#projects?.activeComposition(activeAgentId) : null
    if (state?.project) {
      return state.project.components.map((component) => ({
        id: component.id,
        descriptor: component.descriptor,
        createdAt: component.importedAt,
        updatedAt: component.updatedAt,
        archivedAt: component.archivedAt,
      }))
    }
    return this.#repository.list()
  }

  getStack(agentId: string): StackState {
    const state = this.#projects?.activeComposition(agentId)
    if (state?.project) {
      const project = state.project
      const byId = new Map(project.components.map((component) => [component.id, component]))
      const components = project.stack.componentIds.flatMap((id) => {
        const component = byId.get(id)
        return component && !component.archivedAt
          ? [
              {
                id: component.id,
                descriptor: component.descriptor,
                createdAt: component.importedAt,
                updatedAt: component.updatedAt,
              },
            ]
          : []
      })
      const owners = project.stack.capabilityOwners.map((owner) => ({
        ...owner,
        selectedAt: project.updatedAt,
      }))
      return {
        agentId,
        revision: project.revision + 1,
        components,
        owners,
        compilation: compileRuntimePlan({
          agentId,
          stackRevision: project.revision + 1,
          executionMode: project.stack.executionMode,
          components,
          owners,
        }),
      }
    }
    return this.#repository.getStack(agentId)
  }

  addToStack(input: AddStackComponentInput): StackState {
    return this.#repository.addToStack(input.agentId, input.componentId)
  }

  removeFromStack(input: RemoveStackComponentInput): StackState {
    return this.#repository.removeFromStack(input.agentId, input.componentId)
  }

  selectOwner(input: SelectCapabilityOwnerInput): StackState {
    return this.#repository.selectOwner(input.agentId, input.capability, input.componentId)
  }
}
