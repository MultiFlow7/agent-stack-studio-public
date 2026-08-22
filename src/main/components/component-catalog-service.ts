import {
  componentCatalogItemSchema,
  componentCatalogSchema,
  type ComponentCatalogItem,
} from '../../shared/component-catalog'
import { AppError } from '../../shared/errors'
import type { AgentService } from '../agents/agent-service'
import type { ComponentService } from './component-service'
import type { StudioProjectService } from '../projects/studio-project-service'
import { isProjectAgentVersionReference } from '../../shared/agent-detail'
import { assessComponentCompatibility } from '../../shared/compatibility-assessment'

export class ComponentCatalogService {
  readonly #agents: Pick<AgentService, 'get' | 'list'>
  readonly #components: Pick<ComponentService, 'getStack' | 'list'>
  #projects: Pick<StudioProjectService, 'activeAgentId' | 'activeComposition'> | null

  constructor(options: {
    agents: Pick<AgentService, 'get' | 'list'>
    components: Pick<ComponentService, 'getStack' | 'list'>
    projects?: Pick<StudioProjectService, 'activeAgentId' | 'activeComposition'>
  }) {
    this.#agents = options.agents
    this.#components = options.components
    this.#projects = options.projects ?? null
  }

  connectProject(
    projects: Pick<StudioProjectService, 'activeAgentId' | 'activeComposition'>,
  ): void {
    this.#projects = projects
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
        const legacyAffectedVersions = agentDetails.flatMap((detail) =>
          detail.versions
            .filter(
              (version) =>
                !isProjectAgentVersionReference(version.snapshot) &&
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
        const activeAgentId = this.#projects?.activeAgentId()
        const activeProject = activeAgentId
          ? this.#projects?.activeComposition(activeAgentId)?.project
          : null
        const activeAgent = agentDetails.find(({ agent }) => agent.id === activeAgentId)
        const projectAffectedVersions =
          activeProject && activeAgent
            ? activeProject.versions
                .filter(({ snapshot }) => snapshot.components.some(({ id }) => id === component.id))
                .map((version) => ({
                  agentId: activeAgent.agent.id,
                  agentName: activeAgent.agent.name,
                  versionId: version.id,
                  versionNumber: version.versionNumber,
                  createdAt: version.createdAt,
                }))
            : []
        const affectedVersions = [...legacyAffectedVersions, ...projectAffectedVersions].sort(
          (left, right) => right.createdAt.localeCompare(left.createdAt),
        )
        const validation = component.descriptor.compatibility.validation
        const projectAssessment = this.#projects
          ?.activeComposition(activeAgentId ?? '')
          ?.validation?.assessments?.find(({ componentId }) => componentId === component.id)
        const assessment =
          projectAssessment ??
          (activeProject?.components.some(({ id }) => id === component.id)
            ? assessComponentCompatibility({
                componentId: component.id,
                descriptor: component.descriptor,
                checkedAt: new Date().toISOString(),
              })
            : null)
        return componentCatalogItemSchema.parse({
          component,
          usedByAgents,
          affectedVersions,
          validationRecord:
            validation === 'declared'
              ? null
              : { status: validation, recordedAt: component.updatedAt },
          assessment: assessment ?? null,
          auditTrail:
            activeProject?.components.find(({ id }) => id === component.id)?.auditTrail ?? [],
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
