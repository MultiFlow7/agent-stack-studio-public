import path from 'node:path'
import { StudioCore } from '../../core/studio-core'
import type { AgentRepository } from '../persistence/agent-repository'
import type { ComponentRepository } from '../persistence/component-repository'

export interface LegacyPortableMigrationResult {
  migratedAgentIds: string[]
  failed: Array<{ agentId: string; message: string }>
}

export async function migrateLegacyPortableFacts(options: {
  agents: AgentRepository
  components: ComponentRepository
  workspacesRoot: string
  core?: StudioCore
}): Promise<LegacyPortableMigrationResult> {
  const core = options.core ?? new StudioCore()
  const result: LegacyPortableMigrationResult = { migratedAgentIds: [], failed: [] }
  const catalog = options.components.list()
  const unlinkedAgentIds = options.agents.listUnlinkedAgentIds()
  if (catalog.length > 0 && unlinkedAgentIds.length === 0 && options.agents.list().length === 0) {
    return {
      migratedAgentIds: [],
      failed: [
        {
          agentId: 'unassigned-catalog',
          message: '旧组件库没有可承载的 Agent，已保留 SQLite 原数据并拒绝自动删除。',
        },
      ],
    }
  }
  for (const agentId of unlinkedAgentIds) {
    try {
      const detail = options.agents.getDetail(agentId)
      const stack = options.components.getStack(agentId)
      const root = detail.location?.workspacePath ?? path.join(options.workspacesRoot, agentId)
      const migrated = await core.migrateLegacyAgentProject(root, detail, stack, catalog)
      options.agents.finalizeLegacyProjectMigration(migrated.project, migrated.path)
      result.migratedAgentIds.push(agentId)
    } catch (error) {
      result.failed.push({
        agentId,
        message: error instanceof Error ? error.message : '未知迁移错误。',
      })
    }
  }
  if (result.failed.length === 0 && options.agents.allAgentsLinked()) {
    options.components.clearLegacyPortableFacts()
  }
  return result
}
