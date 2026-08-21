import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { AppError } from '../../shared/errors'
import {
  publishHistorySchema,
  publishMappingSchema,
  publishReceiptSchema,
  type PublishHistory,
  type PublishPackage,
  type PublishReceipt,
} from '../../shared/publish'
import { migrate } from './migrations'

interface ReceiptRow {
  id: string
  target_id: string
  agent_id: string
  agent_version_id: string
  package_hash: string
  idempotency_key: string
  attempt: number
  status: string
  remote_agent_id: string | null
  remote_version_id: string | null
  response_json: string | null
  failure_json: string | null
  created_at: string
  completed_at: string | null
}

interface MappingRow {
  target_id: string
  agent_id: string
  remote_agent_id: string
  created_at: string
  updated_at: string
}

function mapReceipt(row: ReceiptRow): PublishReceipt {
  return publishReceiptSchema.parse({
    id: row.id,
    targetId: row.target_id,
    agentId: row.agent_id,
    agentVersionId: row.agent_version_id,
    packageHash: row.package_hash,
    idempotencyKey: row.idempotency_key,
    attempt: row.attempt,
    status: row.status,
    remoteAgentId: row.remote_agent_id,
    remoteVersionId: row.remote_version_id,
    response: row.response_json ? (JSON.parse(row.response_json) as unknown) : null,
    failure: row.failure_json ? (JSON.parse(row.failure_json) as unknown) : null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  })
}

function mapMapping(row: MappingRow) {
  return publishMappingSchema.parse({
    targetId: row.target_id,
    agentId: row.agent_id,
    remoteAgentId: row.remote_agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

const receiptSelect = `SELECT id, target_id, agent_id, agent_version_id, package_hash,
  idempotency_key, attempt, status, remote_agent_id, remote_version_id, response_json,
  failure_json, created_at, completed_at FROM publish_receipts`

export class PublishRepository {
  readonly #database: Database.Database

  constructor(databasePath: string) {
    this.#database = new Database(databasePath)
    this.#database.pragma('foreign_keys = ON')
    this.#database.pragma('journal_mode = WAL')
    migrate(this.#database)
  }

  createPending(input: {
    targetId: string
    agentId: string
    agentVersionId: string
    publishPackage: PublishPackage
    idempotencyKey: string
  }): PublishReceipt {
    const attempt = (
      this.#database
        .prepare(
          `SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt FROM publish_receipts
           WHERE target_id = ? AND agent_version_id = ? AND package_hash = ?`,
        )
        .get(input.targetId, input.agentVersionId, input.publishPackage.contentHash) as {
        attempt: number
      }
    ).attempt
    const createdAt = new Date().toISOString()
    const receipt = publishReceiptSchema.parse({
      id: randomUUID(),
      targetId: input.targetId,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      packageHash: input.publishPackage.contentHash,
      idempotencyKey: input.idempotencyKey,
      attempt,
      status: 'pending',
      remoteAgentId: null,
      remoteVersionId: null,
      response: null,
      failure: null,
      createdAt,
      completedAt: null,
    })
    this.#database
      .prepare(
        `INSERT INTO publish_receipts
         (id, target_id, agent_id, agent_version_id, package_hash, package_json,
          idempotency_key, attempt, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        receipt.id,
        receipt.targetId,
        receipt.agentId,
        receipt.agentVersionId,
        receipt.packageHash,
        JSON.stringify(input.publishPackage),
        receipt.idempotencyKey,
        receipt.attempt,
        receipt.createdAt,
      )
    return receipt
  }

  completeSuccess(
    receiptId: string,
    outcome: {
      remoteAgentId: string
      remoteVersionId: string
      message: string
      publishedFields: string[]
      testOnly: boolean
    },
  ): PublishReceipt {
    const current = this.getReceipt(receiptId)
    const completedAt = new Date().toISOString()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      this.#database
        .prepare(
          `UPDATE publish_receipts SET status = 'succeeded', remote_agent_id = ?,
           remote_version_id = ?, response_json = ?, failure_json = NULL, completed_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(
          outcome.remoteAgentId,
          outcome.remoteVersionId,
          JSON.stringify({
            message: outcome.message,
            publishedFields: outcome.publishedFields,
            testOnly: outcome.testOnly,
          }),
          completedAt,
          receiptId,
        )
      this.#database
        .prepare(
          `INSERT INTO publish_mappings
           (target_id, agent_id, remote_agent_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (target_id, agent_id) DO UPDATE SET
             remote_agent_id = excluded.remote_agent_id,
             updated_at = excluded.updated_at`,
        )
        .run(current.targetId, current.agentId, outcome.remoteAgentId, completedAt, completedAt)
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw new AppError('PERSISTENCE_FAILED', '无法保存发布 Receipt。', { cause: error })
    }
    return this.getReceipt(receiptId)
  }

  completeFailure(
    receiptId: string,
    failure: { code: string; message: string; retryable: boolean },
  ): PublishReceipt {
    const result = this.#database
      .prepare(
        `UPDATE publish_receipts SET status = 'failed', failure_json = ?, completed_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(JSON.stringify(failure), new Date().toISOString(), receiptId)
    if (result.changes !== 1) throw new AppError('NOT_FOUND', '待完成的发布 Receipt 不存在。')
    return this.getReceipt(receiptId)
  }

  findSucceeded(
    targetId: string,
    agentVersionId: string,
    packageHash: string,
  ): PublishReceipt | null {
    const row = this.#database
      .prepare(
        `${receiptSelect} WHERE target_id = ? AND agent_version_id = ?
         AND package_hash = ? AND status = 'succeeded' ORDER BY attempt DESC LIMIT 1`,
      )
      .get(targetId, agentVersionId, packageHash) as ReceiptRow | undefined
    return row ? mapReceipt(row) : null
  }

  getReceipt(receiptId: string): PublishReceipt {
    const row = this.#database.prepare(`${receiptSelect} WHERE id = ?`).get(receiptId) as
      | ReceiptRow
      | undefined
    if (!row) throw new AppError('NOT_FOUND', '指定的发布 Receipt 不存在。')
    return mapReceipt(row)
  }

  getMapping(targetId: string, agentId: string) {
    const row = this.#database
      .prepare(
        `SELECT target_id, agent_id, remote_agent_id, created_at, updated_at
         FROM publish_mappings WHERE target_id = ? AND agent_id = ?`,
      )
      .get(targetId, agentId) as MappingRow | undefined
    return row ? mapMapping(row) : null
  }

  history(targetId: string, agentId: string): PublishHistory {
    const rows = this.#database
      .prepare(`${receiptSelect} WHERE target_id = ? AND agent_id = ? ORDER BY created_at DESC`)
      .all(targetId, agentId) as unknown as ReceiptRow[]
    return publishHistorySchema.parse({
      mapping: this.getMapping(targetId, agentId),
      receipts: rows.map(mapReceipt),
    })
  }

  close(): void {
    this.#database.close()
  }
}
