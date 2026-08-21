import type {
  AddStackComponentInput,
  ComponentRecord,
  RemoveStackComponentInput,
  SelectCapabilityOwnerInput,
} from '../../shared/component'
import type { StackState } from '../../shared/runtime-plan'
import type { ComponentRepository } from '../persistence/component-repository'
import { builtInComponents } from './built-in-components'

export class ComponentService {
  readonly #repository: ComponentRepository

  constructor(repository: ComponentRepository) {
    this.#repository = repository
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
    return this.#repository.list()
  }

  getStack(agentId: string): StackState {
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
