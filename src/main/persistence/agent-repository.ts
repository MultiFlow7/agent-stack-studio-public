import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
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
  type StackDraft,
} from '../../shared/agent-detail'
import { AppError } from '../../shared/errors'
import { secretReferenceSchema, type SecretReference } from '../../shared/secret-reference'
import { migrate } from './migrations'

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

  createVersion(agentId: string): AgentVersion {
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
    })

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
}
