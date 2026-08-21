import {
  componentCatalogItemSchema,
  componentCatalogSchema,
  type ComponentCatalogItem,
} from '../../shared/component-catalog'
import { AppError } from '../../shared/errors'
import type { AgentService } from '../agents/agent-service'
import type { ComponentService } from './component-service'

export class ComponentCatalogService {
  readonly #agents: Pick<AgentService, 'get' | 'list'>
  readonly #components: Pick<ComponentService, 'getStack' | 'list'>

  constructor(options: {
    agents: Pick<AgentService, 'get' | 'list'>
    components: Pick<ComponentService, 'getStack' | 'list'>
  }) {
    this.#agents = options.agents
    this.#components = options.components
  }

  list(): ComponentCatalogItem[] {
    const agentDetails = [
      ...this.#agents.list({ scope: 'active' }),
      ...this.#agents.list({ scope: 'archived' }),
    ].map(({ id }) => this.#agents.get(id))
    const stackComponentIds = new Map(
      agentDetails.map((detail) => [
        detail.agent.id,
        new Set(this.#components.getStack(detail.agent.id).components.map(({ id }) => id)),
      ]),
    )

    return componentCatalogSchema.parse(
      this.#components.list().map((component) => {
        const usedByAgents = agentDetails
          .filter((detail) => stackComponentIds.get(detail.agent.id)?.has(component.id))
          .map((detail) => ({
            id: detail.agent.id,
            name: detail.agent.name,
            archivedAt: detail.agent.archivedAt,
            draftRevision: detail.draft.revision,
          }))
          .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
        const affectedVersions = agentDetails
          .flatMap((detail) =>
            detail.versions
              .filter((version) =>
                version.snapshot.stack.components.some(
                  ({ componentId }) => componentId === component.id,
                ),
              )
              .map((version) => ({
                agentId: detail.agent.id,
                agentName: detail.agent.name,
                versionId: version.id,
                versionNumber: version.versionNumber,
                createdAt: version.createdAt,
              })),
          )
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        const validation = component.descriptor.compatibility.validation
        return componentCatalogItemSchema.parse({
          component,
          usedByAgents,
          affectedVersions,
          validationRecord:
            validation === 'declared'
              ? null
              : { status: validation, recordedAt: component.updatedAt },
        })
      }),
    )
  }

  get(componentId: string): ComponentCatalogItem {
    const item = this.list().find(({ component }) => component.id === componentId)
    if (!item) throw new AppError('NOT_FOUND', '指定的本地组件不存在。')
    return item
  }
}
