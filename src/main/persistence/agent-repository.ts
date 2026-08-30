import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'
import { z } from 'zod'
import {
  agentListSchema,
  agentSchema,
  createAgentInputSchema,
  updateAgentInputSchema,
  type Agent,
  type AgentListInput,
  type CreateAgentInput,
  type UpdateAgentInput,
} from '../../shared/agent'
import {
  agentDetailSchema,
  agentLocationSchema,
  agentVersionSchema,
  stackDraftSchema,
  type AgentDetail,
  type AgentLocation,
  type AgentVersion,
  type MaterializedAgentVersion,
  type StackDraft,
} from '../../shared/agent-detail'
import { AppError } from '../../shared/errors'
import { secretReferenceSchema, type SecretReference } from '../../shared/secret-reference'
import { migrate } from './migrations'
import type { ProjectVersion, StudioProject } from '../../core/project-model'
import { modelAuthFailureCodeSchema, type ModelAuthFailureCode } from '../../shared/model-auth'

interface AgentRow {
  id: string
  name: string
  description: string
  execution_mode: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

interface StackDraftRow {
  agent_id: string
  execution_mode: string
  revision: number
  updated_at: string
}

interface AgentVersionRow {
  id: string
  agent_id: string
  version_number: number
  snapshot_json: string
  content_hash: string
  created_at: string
}

interface AgentLocationRow {
  workspace_path: string
  source_kind: string
  source_path: string | null
}

interface SecretReferenceRow {
  id: string
  agent_id: string
  label: string
  keychain_service: string
  keychain_account: string
  created_at: string
}

interface CreateOptions {
  id?: string
  location?: AgentLocation
}

export interface AgentProjectLink {
  agentId: string
  projectId: string
  projectPath: string
  linkedAt: string
  updatedAt: string
}

interface AgentProjectLinkRow {
  agent_id: string
  project_id: string
  project_path: string
  linked_at: string
  updated_at: string
}

export const providerCredentialBindingAuthMethodSchema = z.enum([
  'api-key',
  'official-login',
  'existing-login',
])

export const persistedModelVerificationStatusSchema = z.enum([
  'credential-valid',
  'minimal-call-succeeded',
  'credential-invalid',
  'credential-expired',
  'model-forbidden',
  'network-failed',
  'cancelled',
])

const providerIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

const providerCredentialBindingSchema = z
  .object({
    id: z.uuid(),
    agentId: z.uuid(),
    projectId: z.uuid(),
    harnessId: z.enum(['pi', 'openclaw', 'codex']),
    providerId: providerIdSchema,
    authMethod: providerCredentialBindingAuthMethodSchema,
    secretReferenceId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.authMethod === 'api-key' && !binding.secretReferenceId) {
      context.addIssue({
        code: 'custom',
        path: ['secretReferenceId'],
        message: 'API Key 绑定必须引用本机 Keychain 条目。',
      })
    }
    if (binding.authMethod !== 'api-key' && binding.secretReferenceId) {
      context.addIssue({
        code: 'custom',
        path: ['secretReferenceId'],
        message: '官方登录与现有登录不保存第三方 token 引用。',
      })
    }
  })

const modelVerificationRecordSchema = z
  .object({
    id: z.uuid(),
    bindingId: z.uuid(),
    configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: persistedModelVerificationStatusSchema,
    failureCode: modelAuthFailureCodeSchema.nullable(),
    checkedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict()

export type ProviderCredentialBindingAuthMethod = z.infer<
  typeof providerCredentialBindingAuthMethodSchema
>
export type PersistedModelVerificationStatus = z.infer<
  typeof persistedModelVerificationStatusSchema
>
export type ProviderCredentialBinding = z.infer<typeof providerCredentialBindingSchema>
export type ModelVerificationRecord = z.infer<typeof modelVerificationRecordSchema>

interface ProviderCredentialBindingRow {
  id: string
  agent_id: string
  project_id: string
  harness_id: string
  provider_id: string
  auth_method: string
  secret_reference_id: string | null
  created_at: string
  updated_at: string
}

interface ModelVerificationRow {
  id: string
  binding_id: string
  configuration_hash: string
  status: string
  failure_code: string | null
  checked_at: string
  expires_at: string | null
}

function mapAgent(row: AgentRow): Agent {
  return agentSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    executionMode: row.execution_mode,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function mapDraft(row: StackDraftRow): StackDraft {
  return stackDraftSchema.parse({
    agentId: row.agent_id,
    executionMode: row.execution_mode,
    revision: row.revision,
    updatedAt: row.updated_at,
  })
}

function mapVersion(row: AgentVersionRow): AgentVersion {
  return agentVersionSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    versionNumber: row.version_number,
    snapshot: JSON.parse(row.snapshot_json) as unknown,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  })
}

function mapLocation(row: AgentLocationRow): AgentLocation {
  return agentLocationSchema.parse({
    workspacePath: row.workspace_path,
    sourceKind: row.source_kind,
    sourcePath: row.source_path,
  })
}

function mapProviderCredentialBinding(
  row: ProviderCredentialBindingRow,
): ProviderCredentialBinding {
  return providerCredentialBindingSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    projectId: row.project_id,
    harnessId: row.harness_id,
    providerId: row.provider_id,
    authMethod: row.auth_method,
    secretReferenceId: row.secret_reference_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function mapModelVerification(row: ModelVerificationRow): ModelVerificationRecord {
  return modelVerificationRecordSchema.parse({
    id: row.id,
    bindingId: row.binding_id,
    configurationHash: row.configuration_hash,
    status: row.status,
    failureCode: row.failure_code,
    checkedAt: row.checked_at,
    expiresAt: row.expires_at,
  })
}

export class AgentRepository {
  readonly #database: Database.Database

  constructor(databasePath: string) {
    this.#database = new Database(databasePath)
    this.#database.pragma('foreign_keys = ON')
    this.#database.pragma('journal_mode = WAL')
    migrate(this.#database)
  }

  create(input: CreateAgentInput, options: CreateOptions = {}): Agent {
    const parsed = createAgentInputSchema.parse(input)
    const timestamp = new Date().toISOString()
    const agent = agentSchema.parse({
      ...parsed,
      id: options.id ?? randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    this.#database.exec('BEGIN IMMEDIATE')
    try {
      this.#database
        .prepare(
          `INSERT INTO agents
            (id, name, description, execution_mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          agent.id,
          agent.name,
          agent.description,
          agent.executionMode,
          agent.createdAt,
          agent.updatedAt,
        )
      this.#database
        .prepare(
          `INSERT INTO agent_stack_drafts
            (agent_id, execution_mode, revision, updated_at)
           VALUES (?, ?, 1, ?)`,
        )
        .run(agent.id, agent.executionMode, timestamp)

      if (options.location) {
        const location = agentLocationSchema.parse(options.location)
        this.#database
          .prepare(
            `INSERT INTO agent_locations
              (agent_id, workspace_path, source_kind, source_path)
             VALUES (?, ?, ?, ?)`,
          )
          .run(agent.id, location.workspacePath, location.sourceKind, location.sourcePath)
      }
      this.#database.exec('COMMIT')
      return agent
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw new AppError('PERSISTENCE_FAILED', '无法在本地保存 Agent。', {
        cause: error,
      })
    }
  }

  ensureProjectAgent(
    project: StudioProject,
    projectPath: string,
    preferredAgentId?: string,
  ): AgentProjectLink {
    const existing = this.findProjectLinkByProject(project.id)
    const timestamp = new Date().toISOString()
    if (existing) {
      if (existing.projectPath !== projectPath) {
        throw new AppError('VALIDATION_FAILED', '该项目 ID 已绑定到另一本机路径，未自动覆盖。')
      }
      const detail = this.getDetail(existing.agentId)
      const draftRevision = project.revision + 1
      if (
        detail.agent.name === project.name &&
        detail.agent.description === project.description &&
        detail.agent.executionMode === project.stack.executionMode &&
        detail.draft.executionMode === project.stack.executionMode &&
        detail.draft.revision === draftRevision
      ) {
        return existing
      }
      this.#database.exec('BEGIN IMMEDIATE')
      try {
        this.#database
          .prepare(
            `UPDATE agents SET name = ?, description = ?, execution_mode = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            project.name,
            project.description,
            project.stack.executionMode,
            timestamp,
            existing.agentId,
          )
        this.#database
          .prepare(
            `UPDATE agent_stack_drafts SET execution_mode = ?, revision = ?, updated_at = ?
             WHERE agent_id = ?`,
          )
          .run(project.stack.executionMode, draftRevision, timestamp, existing.agentId)
        this.#database
          .prepare('UPDATE agent_project_links SET updated_at = ? WHERE agent_id = ?')
          .run(timestamp, existing.agentId)
        this.#database.exec('COMMIT')
        return { ...existing, updatedAt: timestamp }
      } catch (error) {
        this.#database.exec('ROLLBACK')
        throw new AppError('PERSISTENCE_FAILED', '无法刷新 Agent 的本机项目索引。', {
          cause: error,
        })
      }
    }

    const pathConflict = this.#database
      .prepare('SELECT project_id FROM agent_project_links WHERE project_path = ?')
      .get(projectPath) as { project_id: string } | undefined
    if (pathConflict) {
      throw new AppError(
        'VALIDATION_FAILED',
        '该本机路径已绑定不同的项目 ID，请先审核项目备份与冲突。',
      )
    }

    const agentId = preferredAgentId ?? randomUUID()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      this.#database
        .prepare(
          `INSERT INTO agents
            (id, name, description, execution_mode, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          agentId,
          project.name,
          project.description,
          project.stack.executionMode,
          timestamp,
          timestamp,
        )
      this.#database
        .prepare(
          `INSERT INTO agent_stack_drafts
            (agent_id, execution_mode, revision, updated_at) VALUES (?, ?, ?, ?)`,
        )
        .run(agentId, project.stack.executionMode, project.revision + 1, timestamp)
      this.#database
        .prepare(
          `INSERT INTO agent_locations
            (agent_id, workspace_path, source_kind, source_path)
           VALUES (?, ?, 'local-import', ?)`,
        )
        .run(agentId, projectPath, projectPath)
      this.#database
        .prepare(
          `INSERT INTO agent_project_links
            (agent_id, project_id, project_path, linked_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(agentId, project.id, projectPath, timestamp, timestamp)
      this.#database.exec('COMMIT')
      return {
        agentId,
        projectId: project.id,
        projectPath,
        linkedAt: timestamp,
        updatedAt: timestamp,
      }
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw new AppError('PERSISTENCE_FAILED', '无法建立 Agent 与项目的本机引用。', {
        cause: error,
      })
    }
  }

  projectLink(agentId: string): AgentProjectLink | null {
    const row = this.#database
      .prepare(
        `SELECT agent_id, project_id, project_path, linked_at, updated_at
         FROM agent_project_links WHERE agent_id = ?`,
      )
      .get(agentId) as AgentProjectLinkRow | undefined
    return row ? this.#mapProjectLink(row) : null
  }

  findProjectLinkByProject(projectId: string): AgentProjectLink | null {
    const row = this.#database
      .prepare(
        `SELECT agent_id, project_id, project_path, linked_at, updated_at
         FROM agent_project_links WHERE project_id = ?`,
      )
      .get(projectId) as AgentProjectLinkRow | undefined
    return row ? this.#mapProjectLink(row) : null
  }

  listUnlinkedAgentIds(): string[] {
    return this.#database
      .prepare(
        `SELECT a.id FROM agents a
         LEFT JOIN agent_project_links l ON l.agent_id = a.id
         WHERE l.agent_id IS NULL ORDER BY a.created_at, a.id`,
      )
      .pluck()
      .all() as string[]
  }

  allAgentsLinked(): boolean {
    const row = this.#database
      .prepare(
        `SELECT COUNT(*) AS count FROM agents a
         LEFT JOIN agent_project_links l ON l.agent_id = a.id
         WHERE l.agent_id IS NULL`,
      )
      .get() as { count: number }
    return row.count === 0
  }

  finalizeLegacyProjectMigration(project: StudioProject, projectPath: string): AgentProjectLink {
    const existing = this.projectLink(project.id)
    if (existing) {
      if (existing.projectId !== project.id || existing.projectPath !== projectPath) {
        throw new AppError('VALIDATION_FAILED', '历史 Agent 迁移引用与已有项目绑定冲突。')
      }
      return existing
    }
    this.getDetail(project.id)
    const timestamp = new Date().toISOString()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      this.#database
        .prepare(
          `INSERT INTO agent_project_links
            (agent_id, project_id, project_path, linked_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(project.id, project.id, projectPath, timestamp, timestamp)
      const updateVersion = this.#database.prepare(
        `UPDATE agent_versions SET snapshot_json = ?, content_hash = ?
         WHERE id = ? AND agent_id = ?`,
      )
      for (const version of project.versions) {
        const result = updateVersion.run(
          JSON.stringify({
            kind: 'project-reference',
            projectId: project.id,
            projectVersionId: version.id,
            projectRevision: project.revision,
          }),
          version.contentHash,
          version.id,
          project.id,
        )
        if (result.changes !== 1) throw new Error(`Missing legacy version ${version.id}`)
      }
      this.#database.prepare('DELETE FROM capability_owners WHERE agent_id = ?').run(project.id)
      this.#database
        .prepare('DELETE FROM agent_stack_components WHERE agent_id = ?')
        .run(project.id)
      this.#database
        .prepare(
          `UPDATE agent_locations SET workspace_path = ?, source_kind = 'local-import', source_path = ?
           WHERE agent_id = ?`,
        )
        .run(path.dirname(projectPath), projectPath, project.id)
      this.#database.exec('COMMIT')
      return {
        agentId: project.id,
        projectId: project.id,
        projectPath,
        linkedAt: timestamp,
        updatedAt: timestamp,
      }
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw new AppError('PERSISTENCE_FAILED', '无法提交历史 Agent 项目迁移，数据库已回滚。', {
        cause: error,
      })
    }
  }

  createProjectVersionReference(
    agentId: string,
    project: StudioProject,
    version: ProjectVersion,
  ): AgentVersion {
    const link = this.projectLink(agentId)
    if (!link || link.projectId !== project.id) {
      throw new AppError('VALIDATION_FAILED', '当前 Agent 没有绑定该 Studio 项目。')
    }
    const snapshot = {
      kind: 'project-reference' as const,
      projectId: project.id,
      projectVersionId: version.id,
      projectRevision: project.revision,
    }
    const reference = agentVersionSchema.parse({
      id: version.id,
      agentId,
      versionNumber: version.versionNumber,
      snapshot,
      contentHash: version.contentHash,
      createdAt: version.createdAt,
    })
    const existing = this.#database
      .prepare(
        `SELECT id, agent_id, version_number, snapshot_json, content_hash, created_at
         FROM agent_versions WHERE id = ?`,
      )
      .get(reference.id) as AgentVersionRow | undefined
    if (existing) {
      const parsed = mapVersion(existing)
      if (
        parsed.agentId !== agentId ||
        parsed.contentHash !== reference.contentHash ||
        parsed.versionNumber !== reference.versionNumber
      ) {
        throw new AppError('VALIDATION_FAILED', '不可变项目 Version 引用发生冲突。')
      }
      return parsed
    }
    this.#database
      .prepare(
        `INSERT INTO agent_versions
          (id, agent_id, version_number, snapshot_json, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reference.id,
        reference.agentId,
        reference.versionNumber,
        JSON.stringify(reference.snapshot),
        reference.contentHash,
        reference.createdAt,
      )
    return reference
  }

  list(input: AgentListInput = { scope: 'active' }): Agent[] {
    try {
      const where = input.scope === 'archived' ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'
      const rows = this.#database
        .prepare(
          `SELECT id, name, description, execution_mode, archived_at, created_at, updated_at
           FROM agents WHERE ${where}
           ORDER BY created_at DESC`,
        )
        .all() as unknown as AgentRow[]
      return agentListSchema.parse(rows.map(mapAgent))
    } catch (error) {
      throw new AppError('PERSISTENCE_FAILED', '无法载入本地 Agent。', {
        cause: error,
      })
    }
  }

  getDetail(agentId: string): AgentDetail {
    const agentRow = this.#database
      .prepare(
        `SELECT id, name, description, execution_mode, archived_at, created_at, updated_at
         FROM agents WHERE id = ?`,
      )
      .get(agentId) as AgentRow | undefined
    if (!agentRow) throw new AppError('NOT_FOUND', '指定的 Agent 不存在。')

    const draftRow = this.#database
      .prepare(
        `SELECT agent_id, execution_mode, revision, updated_at
         FROM agent_stack_drafts WHERE agent_id = ?`,
      )
      .get(agentId) as StackDraftRow
    const versionRows = this.#database
      .prepare(
        `SELECT id, agent_id, version_number, snapshot_json, content_hash, created_at
         FROM agent_versions WHERE agent_id = ? ORDER BY version_number DESC`,
      )
      .all(agentId) as unknown as AgentVersionRow[]
    const locationRow = this.#database
      .prepare(
        `SELECT workspace_path, source_kind, source_path
         FROM agent_locations WHERE agent_id = ?`,
      )
      .get(agentId) as AgentLocationRow | undefined

    return agentDetailSchema.parse({
      agent: mapAgent(agentRow),
      draft: mapDraft(draftRow),
      versions: versionRows.map(mapVersion),
      location: locationRow ? mapLocation(locationRow) : null,
    })
  }

  update(input: UpdateAgentInput): AgentDetail {
    const parsed = updateAgentInputSchema.parse(input)
    const timestamp = new Date().toISOString()
    const current = this.getDetail(parsed.id)
    if (
      current.agent.name === parsed.name &&
      current.agent.description === parsed.description &&
      current.agent.executionMode === parsed.executionMode
    ) {
      return current
    }
    const nextRevision = current.draft.revision + 1

    this.#database.exec('BEGIN IMMEDIATE')
    try {
      this.#database
        .prepare(
          `UPDATE agents
           SET name = ?, description = ?, execution_mode = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(parsed.name, parsed.description, parsed.executionMode, timestamp, parsed.id)
      this.#database
        .prepare(
          `UPDATE agent_stack_drafts
           SET execution_mode = ?, revision = ?, updated_at = ?
           WHERE agent_id = ?`,
        )
        .run(parsed.executionMode, nextRevision, timestamp, parsed.id)
      this.#database.exec('COMMIT')
      return this.getDetail(parsed.id)
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw new AppError('PERSISTENCE_FAILED', '无法保存 Agent 设置。', {
        cause: error,
      })
    }
  }

  duplicate(
    sourceAgentId: string,
    input: { id: string; name: string; workspacePath: string },
  ): AgentDetail {
    const source = this.getDetail(sourceAgentId)
    if (source.agent.archivedAt) {
      throw new AppError('VALIDATION_FAILED', '请先恢复已归档 Agent，再创建副本。')
    }
    const timestamp = new Date().toISOString()
    const duplicate = agentSchema.parse({
      ...source.agent,
      id: input.id,
      name: input.name,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    this.#database.exec('BEGIN IMMEDIATE')
    try {
      this.#database
        .prepare(
          `INSERT INTO agents
            (id, name, description, execution_mode, archived_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          duplicate.id,
          duplicate.name,
          duplicate.description,
          duplicate.executionMode,
          duplicate.createdAt,
          duplicate.updatedAt,
        )
      this.#database
        .prepare(
          `INSERT INTO agent_stack_drafts
            (agent_id, execution_mode, revision, updated_at)
           VALUES (?, ?, 1, ?)`,
        )
        .run(duplicate.id, duplicate.executionMode, timestamp)
      this.#database
        .prepare(
          `INSERT INTO agent_locations
            (agent_id, workspace_path, source_kind, source_path)
           VALUES (?, ?, 'blank', NULL)`,
        )
        .run(duplicate.id, input.workspacePath)
      this.#database
        .prepare(
          `INSERT INTO agent_stack_components (agent_id, component_id, added_at)
           SELECT ?, component_id, ?
           FROM agent_stack_components WHERE agent_id = ?`,
        )
        .run(duplicate.id, timestamp, sourceAgentId)
      this.#database
        .prepare(
          `INSERT INTO capability_owners (agent_id, capability, component_id, selected_at)
           SELECT ?, capability, component_id, ?
           FROM capability_owners WHERE agent_id = ?`,
        )
        .run(duplicate.id, timestamp, sourceAgentId)
      this.#database.exec('COMMIT')
      return this.getDetail(duplicate.id)
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw new AppError('PERSISTENCE_FAILED', '无法复制 Agent。', { cause: error })
    }
  }

  archive(agentId: string): AgentDetail {
    const current = this.getDetail(agentId)
    if (current.agent.archivedAt) return current
    const timestamp = new Date().toISOString()
    this.#database
      .prepare('UPDATE agents SET archived_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, timestamp, agentId)
    return this.getDetail(agentId)
  }

  restore(agentId: string): AgentDetail {
    const current = this.getDetail(agentId)
    if (!current.agent.archivedAt) return current
    const timestamp = new Date().toISOString()
    this.#database
      .prepare('UPDATE agents SET archived_at = NULL, updated_at = ? WHERE id = ?')
      .run(timestamp, agentId)
    return this.getDetail(agentId)
  }

  delete(agentId: string): void {
    const current = this.getDetail(agentId)
    if (!current.agent.archivedAt) {
      throw new AppError('VALIDATION_FAILED', '永久删除前必须先归档 Agent。')
    }

    const referenceQueries = [
      ['不可变版本', 'agent_versions'],
      ['运行记录', 'runs'],
      ['实验记录', 'experiments'],
      ['发布回执', 'publish_receipts'],
      ['发布映射', 'publish_mappings'],
      ['密钥引用', 'secret_references'],
      ['Provider 凭证绑定', 'provider_credential_bindings'],
    ] as const
    const references = referenceQueries.flatMap(([label, table]) => {
      const row = this.#database
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE agent_id = ?`)
        .get(agentId) as { count: number }
      return row.count > 0 ? [`${label} ${row.count} 项`] : []
    })
    if (references.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `该 Agent 仍有历史引用，不能永久删除：${references.join('、')}。请保留归档状态。`,
      )
    }

    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const result = this.#database.prepare('DELETE FROM agents WHERE id = ?').run(agentId)
      if (result.changes !== 1) throw new Error('Agent delete affected an unexpected row count.')
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw new AppError('PERSISTENCE_FAILED', '无法永久删除 Agent。', { cause: error })
    }
  }

  createVersion(agentId: string): MaterializedAgentVersion {
    const detail = this.getDetail(agentId)
    const componentRows = this.#database
      .prepare(
        `SELECT c.id AS component_id, c.contract_id, c.version
         FROM agent_stack_components sc
         JOIN components c ON c.id = sc.component_id
         WHERE sc.agent_id = ? ORDER BY c.contract_id, c.version`,
      )
      .all(agentId) as Array<{ component_id: string; contract_id: string; version: string }>
    const ownerRows = this.#database
      .prepare(
        `SELECT capability, component_id
         FROM capability_owners WHERE agent_id = ? ORDER BY capability`,
      )
      .all(agentId) as Array<{ capability: string; component_id: string }>
    const snapshot = {
      agent: {
        id: detail.agent.id,
        name: detail.agent.name,
        description: detail.agent.description,
        executionMode: detail.agent.executionMode,
      },
      stack: {
        executionMode: detail.draft.executionMode,
        revision: detail.draft.revision,
        components: componentRows.map((row) => ({
          componentId: row.component_id,
          contractId: row.contract_id,
          version: row.version,
        })),
        capabilityOwners: ownerRows.map((row) => ({
          capability: row.capability,
          componentId: row.component_id,
        })),
      },
    }
    const snapshotJson = JSON.stringify(snapshot)
    const version = agentVersionSchema.parse({
      id: randomUUID(),
      agentId,
      versionNumber: (detail.versions[0]?.versionNumber ?? 0) + 1,
      snapshot,
      contentHash: createHash('sha256').update(snapshotJson).digest('hex'),
      createdAt: new Date().toISOString(),
    }) as MaterializedAgentVersion

    try {
      this.#database
        .prepare(
          `INSERT INTO agent_versions
            (id, agent_id, version_number, snapshot_json, content_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          version.id,
          version.agentId,
          version.versionNumber,
          snapshotJson,
          version.contentHash,
          version.createdAt,
        )
      return version
    } catch (error) {
      throw new AppError('PERSISTENCE_FAILED', '无法创建 Agent 版本。', {
        cause: error,
      })
    }
  }

  saveProviderCredentialBinding(input: {
    agentId: string
    projectId: string
    harnessId: ProviderCredentialBinding['harnessId']
    providerId: string
    authMethod: ProviderCredentialBindingAuthMethod
    secretReferenceId: string | null
  }): ProviderCredentialBinding {
    const projectId = z.uuid().parse(input.projectId)
    const link = this.projectLink(input.agentId)
    if (!link || link.projectId !== projectId) {
      throw new AppError('VALIDATION_FAILED', '凭证绑定必须属于当前 Agent 已绑定的 Studio 项目。')
    }
    const parsedInput = providerCredentialBindingSchema
      .pick({
        agentId: true,
        projectId: true,
        harnessId: true,
        providerId: true,
        authMethod: true,
        secretReferenceId: true,
      })
      .parse({ ...input, projectId })
    if (parsedInput.secretReferenceId) {
      const reference = this.getSecretReference(parsedInput.secretReferenceId)
      if (reference.agentId !== parsedInput.agentId) {
        throw new AppError('VALIDATION_FAILED', '不能绑定其他 Agent 的 Keychain 引用。')
      }
    }

    const existing = this.findProviderCredentialBinding(
      parsedInput.projectId,
      parsedInput.harnessId,
      parsedInput.providerId,
    )
    const timestamp = new Date().toISOString()
    if (existing) {
      if (existing.agentId !== parsedInput.agentId) {
        throw new AppError('VALIDATION_FAILED', '该项目 Provider 绑定已属于另一个 Agent。')
      }
      const identityChanged =
        existing.authMethod !== parsedInput.authMethod ||
        existing.secretReferenceId !== parsedInput.secretReferenceId
      this.#database.exec('BEGIN IMMEDIATE')
      try {
        this.#database
          .prepare(
            `UPDATE provider_credential_bindings
             SET auth_method = ?, secret_reference_id = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(parsedInput.authMethod, parsedInput.secretReferenceId, timestamp, existing.id)
        if (identityChanged) {
          this.#database
            .prepare('DELETE FROM model_verifications WHERE binding_id = ?')
            .run(existing.id)
        }
        this.#database.exec('COMMIT')
      } catch (error) {
        this.#database.exec('ROLLBACK')
        throw new AppError('PERSISTENCE_FAILED', '无法更新 Provider 凭证绑定。', {
          cause: error,
        })
      }
      return this.getProviderCredentialBinding(existing.id)
    }

    const binding = providerCredentialBindingSchema.parse({
      ...parsedInput,
      id: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    try {
      this.#database
        .prepare(
          `INSERT INTO provider_credential_bindings
           (id, agent_id, project_id, harness_id, provider_id, auth_method,
            secret_reference_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          binding.id,
          binding.agentId,
          binding.projectId,
          binding.harnessId,
          binding.providerId,
          binding.authMethod,
          binding.secretReferenceId,
          binding.createdAt,
          binding.updatedAt,
        )
      return binding
    } catch (error) {
      throw new AppError('PERSISTENCE_FAILED', '无法保存 Provider 凭证绑定。', {
        cause: error,
      })
    }
  }

  listProviderCredentialBindings(projectId: string): ProviderCredentialBinding[] {
    const parsedProjectId = z.uuid().parse(projectId)
    const rows = this.#database
      .prepare(
        `SELECT id, agent_id, project_id, harness_id, provider_id, auth_method,
                secret_reference_id, created_at, updated_at
         FROM provider_credential_bindings
         WHERE project_id = ? ORDER BY harness_id, provider_id`,
      )
      .all(parsedProjectId) as unknown as ProviderCredentialBindingRow[]
    return rows.map(mapProviderCredentialBinding)
  }

  findProviderCredentialBinding(
    projectId: string,
    harnessId: ProviderCredentialBinding['harnessId'],
    providerId: string,
  ): ProviderCredentialBinding | null {
    const row = this.#database
      .prepare(
        `SELECT id, agent_id, project_id, harness_id, provider_id, auth_method,
                secret_reference_id, created_at, updated_at
         FROM provider_credential_bindings
         WHERE project_id = ? AND harness_id = ? AND provider_id = ?`,
      )
      .get(z.uuid().parse(projectId), harnessId, providerIdSchema.parse(providerId)) as
      | ProviderCredentialBindingRow
      | undefined
    return row ? mapProviderCredentialBinding(row) : null
  }

  getProviderCredentialBinding(bindingId: string): ProviderCredentialBinding {
    const row = this.#database
      .prepare(
        `SELECT id, agent_id, project_id, harness_id, provider_id, auth_method,
                secret_reference_id, created_at, updated_at
         FROM provider_credential_bindings WHERE id = ?`,
      )
      .get(z.uuid().parse(bindingId)) as ProviderCredentialBindingRow | undefined
    if (!row) throw new AppError('NOT_FOUND', '找不到该 Provider 凭证绑定。')
    return mapProviderCredentialBinding(row)
  }

  deleteProviderCredentialBinding(bindingId: string): ProviderCredentialBinding {
    const binding = this.getProviderCredentialBinding(bindingId)
    const result = this.#database
      .prepare('DELETE FROM provider_credential_bindings WHERE id = ?')
      .run(binding.id)
    if (result.changes !== 1) throw new AppError('NOT_FOUND', '找不到该 Provider 凭证绑定。')
    return binding
  }

  saveModelVerification(input: {
    bindingId: string
    configurationHash: string
    status: PersistedModelVerificationStatus
    failureCode?: ModelAuthFailureCode | null
    checkedAt?: string
    expiresAt?: string | null
  }): ModelVerificationRecord {
    this.getProviderCredentialBinding(input.bindingId)
    const existing = this.getModelVerification(input.bindingId, input.configurationHash)
    const record = modelVerificationRecordSchema.parse({
      id: existing?.id ?? randomUUID(),
      bindingId: input.bindingId,
      configurationHash: input.configurationHash,
      status: input.status,
      failureCode: input.failureCode ?? null,
      checkedAt: input.checkedAt ?? new Date().toISOString(),
      expiresAt: input.expiresAt ?? null,
    })
    this.#database
      .prepare(
        `INSERT INTO model_verifications
         (id, binding_id, configuration_hash, status, failure_code, checked_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (binding_id, configuration_hash) DO UPDATE SET
           status = excluded.status,
           failure_code = excluded.failure_code,
           checked_at = excluded.checked_at,
           expires_at = excluded.expires_at`,
      )
      .run(
        record.id,
        record.bindingId,
        record.configurationHash,
        record.status,
        record.failureCode,
        record.checkedAt,
        record.expiresAt,
      )
    return record
  }

  getModelVerification(
    bindingId: string,
    configurationHash: string,
  ): ModelVerificationRecord | null {
    const row = this.#database
      .prepare(
        `SELECT id, binding_id, configuration_hash, status, failure_code, checked_at, expires_at
         FROM model_verifications WHERE binding_id = ? AND configuration_hash = ?`,
      )
      .get(
        z.uuid().parse(bindingId),
        z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(configurationHash),
      ) as ModelVerificationRow | undefined
    return row ? mapModelVerification(row) : null
  }

  clearModelVerifications(bindingId: string): number {
    this.getProviderCredentialBinding(bindingId)
    return this.#database
      .prepare('DELETE FROM model_verifications WHERE binding_id = ?')
      .run(bindingId).changes
  }

  saveSecretReference(input: Omit<SecretReference, 'id' | 'createdAt'>): SecretReference {
    const reference = secretReferenceSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    })
    this.#database
      .prepare(
        `INSERT INTO secret_references
          (id, agent_id, label, keychain_service, keychain_account, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reference.id,
        reference.agentId,
        reference.label,
        reference.keychainService,
        reference.keychainAccount,
        reference.createdAt,
      )
    return reference
  }

  listSecretReferences(agentId: string): SecretReference[] {
    const rows = this.#database
      .prepare(
        `SELECT id, agent_id, label, keychain_service, keychain_account, created_at
         FROM secret_references WHERE agent_id = ? ORDER BY label`,
      )
      .all(agentId) as unknown as SecretReferenceRow[]
    return rows.map((row) =>
      secretReferenceSchema.parse({
        id: row.id,
        agentId: row.agent_id,
        label: row.label,
        keychainService: row.keychain_service,
        keychainAccount: row.keychain_account,
        createdAt: row.created_at,
      }),
    )
  }

  getSecretReference(referenceId: string): SecretReference {
    const row = this.#database
      .prepare(
        `SELECT id, agent_id, label, keychain_service, keychain_account, created_at
         FROM secret_references WHERE id = ?`,
      )
      .get(referenceId) as SecretReferenceRow | undefined
    if (!row) throw new AppError('NOT_FOUND', '找不到该密钥引用。')
    return secretReferenceSchema.parse({
      id: row.id,
      agentId: row.agent_id,
      label: row.label,
      keychainService: row.keychain_service,
      keychainAccount: row.keychain_account,
      createdAt: row.created_at,
    })
  }

  updateSecretReferenceLabel(referenceId: string, label: string): SecretReference {
    const parsedLabel = secretReferenceSchema.shape.label.parse(label)
    const result = this.#database
      .prepare('UPDATE secret_references SET label = ? WHERE id = ?')
      .run(parsedLabel, referenceId)
    if (result.changes === 0) throw new AppError('NOT_FOUND', '找不到该密钥引用。')
    return this.getSecretReference(referenceId)
  }

  deleteSecretReference(referenceId: string): void {
    const result = this.#database
      .prepare('DELETE FROM secret_references WHERE id = ?')
      .run(referenceId)
    if (result.changes === 0) throw new AppError('NOT_FOUND', '找不到该密钥引用。')
  }

  close(): void {
    this.#database.close()
  }

  #mapProjectLink(row: AgentProjectLinkRow): AgentProjectLink {
    return {
      agentId: row.agent_id,
      projectId: row.project_id,
      projectPath: row.project_path,
      linkedAt: row.linked_at,
      updatedAt: row.updated_at,
    }
  }
}
