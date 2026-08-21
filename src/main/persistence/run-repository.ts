import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { AppError } from '../../shared/errors'
import {
  runArtifactSchema,
  runDetailSchema,
  runEventSchema,
  runListSchema,
  runRecordSchema,
  type RunArtifact,
  type RunDetail,
  type RunEvent,
  type RunManifest,
  type RunRecord,
} from '../../shared/run'
import { migrate } from './migrations'

interface RunRow {
  id: string
  agent_id: string
  agent_version_id: string
  status: string
  manifest_json: string
  started_at: string | null
  finished_at: string | null
  failure_json: string | null
  created_at: string
  updated_at: string
}

interface EventRow {
  id: string
  run_id: string
  sequence: number
  type: string
  message: string
  details_json: string
  created_at: string
}

interface ArtifactRow {
  id: string
  run_id: string
  kind: string
  relative_path: string
  content_hash: string
  size_bytes: number
  created_at: string
}

function mapRun(row: RunRow): RunRecord {
  return runRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    agentVersionId: row.agent_version_id,
    status: row.status,
    manifest: JSON.parse(row.manifest_json) as unknown,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    failure: row.failure_json ? (JSON.parse(row.failure_json) as unknown) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function mapEvent(row: EventRow): RunEvent {
  return runEventSchema.parse({
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.type,
    message: row.message,
    details: JSON.parse(row.details_json) as unknown,
    createdAt: row.created_at,
  })
}

function mapArtifact(row: ArtifactRow): RunArtifact {
  return runArtifactSchema.parse({
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    relativePath: row.relative_path,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  })
}

export class RunRepository {
  readonly #database: Database.Database

  constructor(databasePath: string) {
    this.#database = new Database(databasePath)
    this.#database.pragma('foreign_keys = ON')
    this.#database.pragma('journal_mode = WAL')
    migrate(this.#database)
  }

  create(manifest: RunManifest): RunRecord {
    const timestamp = manifest.createdAt
    const record = runRecordSchema.parse({
      id: manifest.runId,
      agentId: manifest.agentId,
      agentVersionId: manifest.agentVersionId,
      status: 'queued',
      manifest,
      startedAt: null,
      finishedAt: null,
      failure: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    this.#database
      .prepare(
        `INSERT INTO runs
          (id, agent_id, agent_version_id, status, manifest_json, started_at, finished_at,
           failure_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        record.id,
        record.agentId,
        record.agentVersionId,
        record.status,
        JSON.stringify(record.manifest),
        timestamp,
        timestamp,
      )
    return record
  }

  updateStatus(
    runId: string,
    status: RunRecord['status'],
    options: { failure?: RunRecord['failure']; startedAt?: string; finishedAt?: string } = {},
  ): RunRecord {
    const timestamp = new Date().toISOString()
    const result = this.#database
      .prepare(
        `UPDATE runs SET status = ?, started_at = COALESCE(?, started_at),
         finished_at = COALESCE(?, finished_at), failure_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        status,
        options.startedAt ?? null,
        options.finishedAt ?? null,
        options.failure ? JSON.stringify(options.failure) : null,
        timestamp,
        runId,
      )
    if (result.changes !== 1) throw new AppError('NOT_FOUND', '指定的 Run 不存在。')
    return this.get(runId)
  }

  addEvent(runId: string, input: Pick<RunEvent, 'type' | 'message' | 'details'>): RunEvent {
    const sequence = (
      this.#database
        .prepare(
          'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_events WHERE run_id = ?',
        )
        .get(runId) as { sequence: number }
    ).sequence
    const event = runEventSchema.parse({
      id: randomUUID(),
      runId,
      sequence,
      ...input,
      createdAt: new Date().toISOString(),
    })
    this.#database
      .prepare(
        `INSERT INTO run_events
          (id, run_id, sequence, type, message, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.runId,
        event.sequence,
        event.type,
        event.message,
        JSON.stringify(event.details),
        event.createdAt,
      )
    return event
  }

  addArtifact(input: Omit<RunArtifact, 'id' | 'createdAt'>): RunArtifact {
    const artifact = runArtifactSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    })
    this.#database
      .prepare(
        `INSERT INTO run_artifacts
          (id, run_id, kind, relative_path, content_hash, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.runId,
        artifact.kind,
        artifact.relativePath,
        artifact.contentHash,
        artifact.sizeBytes,
        artifact.createdAt,
      )
    return artifact
  }

  get(runId: string): RunRecord {
    const row = this.#database
      .prepare(
        `SELECT id, agent_id, agent_version_id, status, manifest_json, started_at,
         finished_at, failure_json, created_at, updated_at FROM runs WHERE id = ?`,
      )
      .get(runId) as RunRow | undefined
    if (!row) throw new AppError('NOT_FOUND', '指定的 Run 不存在。')
    return mapRun(row)
  }

  list(agentId: string | null): RunRecord[] {
    const rows = (agentId
      ? this.#database
          .prepare(
            `SELECT id, agent_id, agent_version_id, status, manifest_json, started_at,
             finished_at, failure_json, created_at, updated_at
             FROM runs WHERE agent_id = ? ORDER BY created_at DESC`,
          )
          .all(agentId)
      : this.#database
          .prepare(
            `SELECT id, agent_id, agent_version_id, status, manifest_json, started_at,
             finished_at, failure_json, created_at, updated_at
             FROM runs ORDER BY created_at DESC`,
          )
          .all()) as unknown as RunRow[]
    return runListSchema.parse(rows.map(mapRun))
  }

  getDetail(runId: string): RunDetail {
    const eventRows = this.#database
      .prepare(
        `SELECT id, run_id, sequence, type, message, details_json, created_at
         FROM run_events WHERE run_id = ? ORDER BY sequence`,
      )
      .all(runId) as unknown as EventRow[]
    const artifactRows = this.#database
      .prepare(
        `SELECT id, run_id, kind, relative_path, content_hash, size_bytes, created_at
         FROM run_artifacts WHERE run_id = ? ORDER BY created_at`,
      )
      .all(runId) as unknown as ArtifactRow[]
    return runDetailSchema.parse({
      run: this.get(runId),
      events: eventRows.map(mapEvent),
      artifacts: artifactRows.map(mapArtifact),
    })
  }

  close(): void {
    this.#database.close()
  }
}
