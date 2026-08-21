import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import {
  componentDescriptorSchema,
  componentListSchema,
  componentRecordSchema,
  type ComponentDescriptor,
  type ComponentRecord,
} from '../../shared/component'
import { AppError } from '../../shared/errors'
import {
  capabilityOwnerSchema,
  stackStateSchema,
  type CapabilityOwner,
  type StackState,
} from '../../shared/runtime-plan'
import { compileRuntimePlan } from '../domain/runtime-plan-compiler'
import { migrate } from './migrations'

interface ComponentRow {
  id: string
  descriptor_json: string
  created_at: string
  updated_at: string
}

interface DraftRow {
  execution_mode: 'agent-loop' | 'workflow' | 'hybrid' | 'external-harness'
  revision: number
}

function mapComponent(row: ComponentRow): ComponentRecord {
  return componentRecordSchema.parse({
    id: row.id,
    descriptor: JSON.parse(row.descriptor_json) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

export class ComponentRepository {
  readonly #database: Database.Database

  constructor(databasePath: string) {
    this.#database = new Database(databasePath)
    this.#database.pragma('foreign_keys = ON')
    this.#database.pragma('journal_mode = WAL')
    migrate(this.#database)
  }

  save(descriptor: ComponentDescriptor, id: string = randomUUID()): ComponentRecord {
    const parsed = componentDescriptorSchema.parse(descriptor)
    const timestamp = new Date().toISOString()
    const record = componentRecordSchema.parse({
      id,
      descriptor: parsed,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    try {
      this.#database
        .prepare(
          `INSERT INTO components
            (id, contract_id, version, descriptor_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          record.descriptor.id,
          record.descriptor.version,
          JSON.stringify(record.descriptor),
          record.createdAt,
          record.updatedAt,
        )
      return record
    } catch (error) {
      throw new AppError('PERSISTENCE_FAILED', '无法保存本地组件记录。', { cause: error })
    }
  }

  ensure(descriptor: ComponentDescriptor, id: string): ComponentRecord {
    const existing = this.#database
      .prepare('SELECT id, descriptor_json, created_at, updated_at FROM components WHERE id = ?')
      .get(id) as ComponentRow | undefined
    return existing ? mapComponent(existing) : this.save(descriptor, id)
  }

  list(): ComponentRecord[] {
    const rows = this.#database
      .prepare(
        `SELECT id, descriptor_json, created_at, updated_at
         FROM components ORDER BY contract_id, version`,
      )
      .all() as unknown as ComponentRow[]
    return componentListSchema.parse(rows.map(mapComponent))
  }

  addToStack(agentId: string, componentId: string): StackState {
    const timestamp = new Date().toISOString()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const result = this.#database
        .prepare(
          `INSERT OR IGNORE INTO agent_stack_components (agent_id, component_id, added_at)
           VALUES (?, ?, ?)`,
        )
        .run(agentId, componentId, timestamp)
      if (result.changes === 1) this.#bumpRevision(agentId, timestamp)
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw new AppError('PERSISTENCE_FAILED', '无法将组件添加到 Stack。', { cause: error })
    }
    return this.getStack(agentId)
  }

  removeFromStack(agentId: string, componentId: string): StackState {
    const timestamp = new Date().toISOString()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const result = this.#database
        .prepare('DELETE FROM agent_stack_components WHERE agent_id = ? AND component_id = ?')
        .run(agentId, componentId)
      if (result.changes === 1) this.#bumpRevision(agentId, timestamp)
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw new AppError('PERSISTENCE_FAILED', '无法从 Stack 移除组件。', { cause: error })
    }
    return this.getStack(agentId)
  }

  selectOwner(agentId: string, capability: string, componentId: string): StackState {
    const state = this.getStack(agentId)
    const candidate = state.components.find((component) => component.id === componentId)
    if (!candidate?.descriptor.provides.some((provider) => provider.capability === capability)) {
      throw new AppError('VALIDATION_FAILED', '所选组件不提供该能力。')
    }
    if (
      state.owners.some(
        (owner) => owner.capability === capability && owner.componentId === componentId,
      )
    ) {
      return state
    }
    const timestamp = new Date().toISOString()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      this.#database
        .prepare(
          `INSERT INTO capability_owners (agent_id, capability, component_id, selected_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (agent_id, capability) DO UPDATE SET
             component_id = excluded.component_id,
             selected_at = excluded.selected_at`,
        )
        .run(agentId, capability, componentId, timestamp)
      this.#bumpRevision(agentId, timestamp)
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw new AppError('PERSISTENCE_FAILED', '无法保存 capability owner。', { cause: error })
    }
    return this.getStack(agentId)
  }

  getStack(agentId: string): StackState {
    const draft = this.#database
      .prepare(`SELECT execution_mode, revision FROM agent_stack_drafts WHERE agent_id = ?`)
      .get(agentId) as DraftRow | undefined
    if (!draft) throw new AppError('NOT_FOUND', '指定的 Agent Stack 不存在。')

    const componentRows = this.#database
      .prepare(
        `SELECT c.id, c.descriptor_json, c.created_at, c.updated_at
         FROM agent_stack_components sc
         JOIN components c ON c.id = sc.component_id
         WHERE sc.agent_id = ? ORDER BY sc.added_at, c.contract_id`,
      )
      .all(agentId) as unknown as ComponentRow[]
    const ownerRows = this.#database
      .prepare(
        `SELECT capability, component_id, selected_at
         FROM capability_owners WHERE agent_id = ? ORDER BY capability`,
      )
      .all(agentId) as Array<{
      capability: string
      component_id: string
      selected_at: string
    }>
    const components = componentRows.map(mapComponent)
    const owners: CapabilityOwner[] = ownerRows.map((row) =>
      capabilityOwnerSchema.parse({
        capability: row.capability,
        componentId: row.component_id,
        selectedAt: row.selected_at,
      }),
    )
    return stackStateSchema.parse({
      agentId,
      revision: draft.revision,
      components,
      owners,
      compilation: compileRuntimePlan({
        agentId,
        stackRevision: draft.revision,
        executionMode: draft.execution_mode,
        components,
        owners,
      }),
    })
  }

  #bumpRevision(agentId: string, timestamp: string): void {
    const result = this.#database
      .prepare(
        `UPDATE agent_stack_drafts
         SET revision = revision + 1, updated_at = ? WHERE agent_id = ?`,
      )
      .run(timestamp, agentId)
    if (result.changes !== 1) throw new AppError('NOT_FOUND', '指定的 Agent Stack 不存在。')
  }

  close(): void {
    this.#database.close()
  }
}
