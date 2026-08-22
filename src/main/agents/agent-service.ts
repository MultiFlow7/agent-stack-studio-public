import { randomUUID } from 'node:crypto'
import {
  agentListInputSchema,
  duplicateAgentInputSchema,
  type Agent,
  type AgentLifecycleResult,
  type AgentListInput,
  type CreateAgentInput,
  type DeleteAgentResult,
  type DuplicateAgentInput,
  type UpdateAgentInput,
} from '../../shared/agent'
import type { AgentDetail, AgentVersion, MaterializedAgentVersion } from '../../shared/agent-detail'
import { isProjectAgentVersionReference } from '../../shared/agent-detail'
import type { ImportScan } from '../../shared/import'
import { AppError } from '../../shared/errors'
import type { AgentRepository } from '../persistence/agent-repository'
import type { WorkspaceService } from '../workspace/workspace-service'
import type { StudioProjectService } from '../projects/studio-project-service'

export class AgentService {
  readonly #repository: AgentRepository
  readonly #workspaces: WorkspaceService
  #projects: StudioProjectService | null = null

  constructor(repository: AgentRepository, workspaces: WorkspaceService) {
    this.#repository = repository
    this.#workspaces = workspaces
  }

  connectProject(projects: StudioProjectService): void {
    this.#projects = projects
  }

  async create(input: CreateAgentInput): Promise<Agent> {
    const id = randomUUID()
    const workspacePath = await this.#workspaces.create(id)
    try {
      if (this.#projects) {
        const state = await this.#projects.init(workspacePath, input, id)
        if (!state.localAgentId) throw new Error('未能建立 Agent 项目引用。')
        return this.#repository.getDetail(state.localAgentId).agent
      }
      return this.#repository.create(input, {
        id,
        location: { workspacePath, sourceKind: 'blank', sourcePath: null },
      })
    } catch (error) {
      await this.#workspaces.remove(id).catch(() => undefined)
      throw error
    }
  }

  async import(scan: ImportScan): Promise<AgentDetail> {
    const id = randomUUID()
    const workspacePath = await this.#workspaces.create(id)
    try {
      if (this.#projects) {
        let state = await this.#projects.init(
          workspacePath,
          {
            name: scan.suggestedName,
            description: `通过静态检查从 ${scan.projectType} 项目导入。`,
            executionMode: 'external-harness',
          },
          id,
        )
        state = await this.#projects.importComponent(scan.sourcePath, state.project!.revision)
        const imported = state.project?.components.at(-1)
        if (!imported) throw new Error('导入项目未生成组件静态记录。')
        await this.#projects.stackAdd(imported.id, state.project!.revision)
        return this.get(id)
      }
      const agent = this.#repository.create(
        {
          name: scan.suggestedName,
          description: `通过静态检查从 ${scan.projectType} 项目导入。`,
          executionMode: 'external-harness',
        },
        {
          id,
          location: {
            workspacePath,
            sourceKind: 'local-import',
            sourcePath: scan.sourcePath,
          },
        },
      )
      this.#repository.createVersion(agent.id)
      return this.#repository.getDetail(agent.id)
    } catch (error) {
      if (this.#repository.list({ scope: 'active' }).some((agent) => agent.id === id)) {
        try {
          this.#repository.archive(id)
          this.#repository.delete(id)
        } catch {
          // Preserve the original import failure; repository cleanup is best effort.
        }
      }
      await this.#workspaces.remove(id).catch(() => undefined)
      throw error
    }
  }

  list(input: AgentListInput = { scope: 'active' }): Agent[] {
    return this.#repository.list(agentListInputSchema.parse(input))
  }

  get(agentId: string): AgentDetail {
    const detail = this.#repository.getDetail(agentId)
    const state = this.#projects?.activeComposition(agentId)
    if (!state?.project) return detail
    return {
      ...detail,
      agent: {
        ...detail.agent,
        name: state.project.name,
        description: state.project.description,
        executionMode: state.project.stack.executionMode,
        updatedAt: state.project.updatedAt,
      },
      draft: {
        agentId,
        executionMode: state.project.stack.executionMode,
        revision: state.project.revision + 1,
        updatedAt: state.project.updatedAt,
      },
    }
  }

  update(input: UpdateAgentInput): AgentDetail | Promise<AgentDetail> {
    const state = this.#projects?.activeComposition(input.id)
    if (state?.project && this.#projects) {
      return this.#projects
        .updateMetadata({
          name: input.name,
          description: input.description,
          executionMode: input.executionMode,
          expectedRevision: state.project.revision,
        })
        .then(() => this.get(input.id))
    }
    return this.#repository.update(input)
  }

  createVersion(agentId: string): AgentVersion | Promise<AgentVersion> {
    this.getActive(agentId)
    if (this.#projects?.activeComposition(agentId)) {
      return this.#projects.freezeForAgent(agentId)
    }
    return this.#repository.createVersion(agentId)
  }

  async duplicate(input: DuplicateAgentInput): Promise<AgentDetail> {
    const parsed = duplicateAgentInputSchema.parse(input)
    const source = this.#repository.getDetail(parsed.id)
    if (this.#repository.projectLink(parsed.id)) {
      throw new AppError(
        'VALIDATION_FAILED',
        '项目 Agent 不能复制为 SQLite Stack。请从项目设置导出可移植包，再以新项目导入。',
      )
    }
    const id = randomUUID()
    const workspacePath = await this.#workspaces.create(id)
    const defaultName = `${source.agent.name} 副本`.slice(0, 80)
    try {
      return this.#repository.duplicate(source.agent.id, {
        id,
        name: parsed.name ?? defaultName,
        workspacePath,
      })
    } catch (error) {
      await this.#workspaces.remove(id)
      throw error
    }
  }

  archive(agentId: string): AgentLifecycleResult {
    return {
      agent: this.#repository.archive(agentId).agent,
      message: 'Agent 已归档；历史版本与记录保持可读。',
    }
  }

  restore(agentId: string): AgentLifecycleResult {
    return {
      agent: this.#repository.restore(agentId).agent,
      message: 'Agent 已恢复到本地 Agent 列表。',
    }
  }

  async delete(agentId: string): Promise<DeleteAgentResult> {
    this.#repository.delete(agentId)
    await this.#workspaces.remove(agentId)
    return { id: agentId, deleted: true, message: 'Agent 与其空闲工作空间已永久删除。' }
  }

  getActive(agentId: string): AgentDetail {
    const detail = this.get(agentId)
    if (detail.agent.archivedAt) {
      throw new AppError(
        'VALIDATION_FAILED',
        '该 Agent 已归档。请先恢复后再执行新的运行、实验或发布。',
      )
    }
    return detail
  }

  materializeVersion(agentId: string, version: AgentVersion): MaterializedAgentVersion {
    if (!isProjectAgentVersionReference(version.snapshot)) {
      return { ...version, snapshot: version.snapshot }
    }
    if (!this.#projects) throw new AppError('VALIDATION_FAILED', '当前项目不可用。')
    return this.#projects.materializeVersion(agentId, version)
  }
}
