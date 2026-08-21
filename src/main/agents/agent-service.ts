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
import type { AgentDetail, AgentVersion } from '../../shared/agent-detail'
import type { ImportScan } from '../../shared/import'
import { AppError } from '../../shared/errors'
import type { AgentRepository } from '../persistence/agent-repository'
import type { WorkspaceService } from '../workspace/workspace-service'

export class AgentService {
  readonly #repository: AgentRepository
  readonly #workspaces: WorkspaceService

  constructor(repository: AgentRepository, workspaces: WorkspaceService) {
    this.#repository = repository
    this.#workspaces = workspaces
  }

  async create(input: CreateAgentInput): Promise<Agent> {
    const id = randomUUID()
    const workspacePath = await this.#workspaces.create(id)
    return this.#repository.create(input, {
      id,
      location: { workspacePath, sourceKind: 'blank', sourcePath: null },
    })
  }

  async import(scan: ImportScan): Promise<AgentDetail> {
    const id = randomUUID()
    const workspacePath = await this.#workspaces.create(id)
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
  }

  list(input: AgentListInput = { scope: 'active' }): Agent[] {
    return this.#repository.list(agentListInputSchema.parse(input))
  }

  get(agentId: string): AgentDetail {
    return this.#repository.getDetail(agentId)
  }

  update(input: UpdateAgentInput): AgentDetail {
    return this.#repository.update(input)
  }

  createVersion(agentId: string): AgentVersion {
    this.getActive(agentId)
    return this.#repository.createVersion(agentId)
  }

  async duplicate(input: DuplicateAgentInput): Promise<AgentDetail> {
    const parsed = duplicateAgentInputSchema.parse(input)
    const source = this.#repository.getDetail(parsed.id)
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
}
