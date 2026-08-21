import Database from 'better-sqlite3'
import { AppError } from '../../shared/errors'
import {
  driftCheckSchema,
  experimentCellSchema,
  experimentDetailSchema,
  experimentListSchema,
  experimentRecordSchema,
  type DriftCheck,
  type ExperimentCell,
  type ExperimentDetail,
  type ExperimentRecord,
} from '../../shared/experiment'
import { compareExperimentCells } from '../domain/experiment-domain'
import { migrate } from './migrations'

interface ExperimentRow {
  id: string
  agent_id: string
  name: string
  research_question: string
  status: string
  definition_json: string
  drift_json: string
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

interface CellRow {
  id: string
  experiment_id: string
  prompt_index: number
  prompt_value: string
  random_seed: number
  repetition: number
  status: string
  run_id: string | null
  duration_ms: number | null
  failure_message: string | null
  created_at: string
  updated_at: string
}

function mapExperiment(row: ExperimentRow): ExperimentRecord {
  return experimentRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    researchQuestion: row.research_question,
    status: row.status,
    definition: JSON.parse(row.definition_json) as unknown,
    drift: JSON.parse(row.drift_json) as unknown,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

function mapCell(row: CellRow): ExperimentCell {
  return experimentCellSchema.parse({
    id: row.id,
    experimentId: row.experiment_id,
    promptIndex: row.prompt_index,
    promptValue: row.prompt_value,
    randomSeed: row.random_seed,
    repetition: row.repetition,
    status: row.status,
    runId: row.run_id,
    durationMs: row.duration_ms,
    failureMessage: row.failure_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

export class ExperimentRepository {
  readonly #database: Database.Database

  constructor(databasePath: string) {
    this.#database = new Database(databasePath)
    this.#database.pragma('foreign_keys = ON')
    this.#database.pragma('journal_mode = WAL')
    migrate(this.#database)
  }

  create(experiment: ExperimentRecord, cells: ExperimentCell[]): ExperimentDetail {
    const parsed = experimentRecordSchema.parse(experiment)
    const parsedCells = cells.map((cell) => experimentCellSchema.parse(cell))
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      this.#database
        .prepare(
          `INSERT INTO experiments
           (id, agent_id, baseline_agent_version_id, name, research_question, status,
            definition_json, drift_json, started_at, finished_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        )
        .run(
          parsed.id,
          parsed.agentId,
          parsed.definition.controls.agentVersion.id,
          parsed.name,
          parsed.researchQuestion,
          parsed.status,
          JSON.stringify(parsed.definition),
          JSON.stringify(parsed.drift),
          parsed.createdAt,
          parsed.updatedAt,
        )
      const insertCell = this.#database.prepare(
        `INSERT INTO experiment_cells
         (id, experiment_id, prompt_index, prompt_value, random_seed, repetition, status,
          run_id, duration_ms, failure_message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      )
      for (const cell of parsedCells) {
        insertCell.run(
          cell.id,
          cell.experimentId,
          cell.promptIndex,
          cell.promptValue,
          cell.randomSeed,
          cell.repetition,
          cell.status,
          cell.createdAt,
          cell.updatedAt,
        )
      }
      this.#database.exec('COMMIT')
      return this.get(parsed.id)
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw new AppError('PERSISTENCE_FAILED', '无法保存实验定义。', { cause: error })
    }
  }

  updateStatus(
    experimentId: string,
    status: ExperimentRecord['status'],
    options: { startedAt?: string; finishedAt?: string } = {},
  ): ExperimentRecord {
    const timestamp = new Date().toISOString()
    const result = this.#database
      .prepare(
        `UPDATE experiments SET status = ?, started_at = COALESCE(?, started_at),
         finished_at = COALESCE(?, finished_at), updated_at = ? WHERE id = ?`,
      )
      .run(status, options.startedAt ?? null, options.finishedAt ?? null, timestamp, experimentId)
    if (result.changes !== 1) throw new AppError('NOT_FOUND', '指定的实验不存在。')
    return this.getRecord(experimentId)
  }

  updateDrift(experimentId: string, drift: DriftCheck): ExperimentRecord {
    const parsed = driftCheckSchema.parse(drift)
    const result = this.#database
      .prepare('UPDATE experiments SET drift_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(parsed), new Date().toISOString(), experimentId)
    if (result.changes !== 1) throw new AppError('NOT_FOUND', '指定的实验不存在。')
    return this.getRecord(experimentId)
  }

  updateCell(
    cellId: string,
    status: ExperimentCell['status'],
    options: { runId?: string; durationMs?: number; failureMessage?: string } = {},
  ): ExperimentCell {
    const timestamp = new Date().toISOString()
    const result = this.#database
      .prepare(
        `UPDATE experiment_cells SET status = ?, run_id = COALESCE(?, run_id),
         duration_ms = COALESCE(?, duration_ms), failure_message = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        status,
        options.runId ?? null,
        options.durationMs ?? null,
        options.failureMessage ?? null,
        timestamp,
        cellId,
      )
    if (result.changes !== 1) throw new AppError('NOT_FOUND', '指定的实验单元不存在。')
    const row = this.#database
      .prepare(
        `SELECT id, experiment_id, prompt_index, prompt_value, random_seed, repetition,
         status, run_id, duration_ms, failure_message, created_at, updated_at
         FROM experiment_cells WHERE id = ?`,
      )
      .get(cellId) as CellRow
    return mapCell(row)
  }

  cancelQueued(experimentId: string): void {
    this.#database
      .prepare(
        `UPDATE experiment_cells SET status = 'cancelled', failure_message = '实验已取消。', updated_at = ?
         WHERE experiment_id = ? AND status = 'queued'`,
      )
      .run(new Date().toISOString(), experimentId)
  }

  getRecord(experimentId: string): ExperimentRecord {
    const row = this.#database
      .prepare(
        `SELECT id, agent_id, name, research_question, status, definition_json, drift_json,
         started_at, finished_at, created_at, updated_at FROM experiments WHERE id = ?`,
      )
      .get(experimentId) as ExperimentRow | undefined
    if (!row) throw new AppError('NOT_FOUND', '指定的实验不存在。')
    return mapExperiment(row)
  }

  listCells(experimentId: string): ExperimentCell[] {
    const rows = this.#database
      .prepare(
        `SELECT id, experiment_id, prompt_index, prompt_value, random_seed, repetition,
         status, run_id, duration_ms, failure_message, created_at, updated_at
         FROM experiment_cells WHERE experiment_id = ?
         ORDER BY prompt_index, random_seed, repetition`,
      )
      .all(experimentId) as unknown as CellRow[]
    return rows.map(mapCell)
  }

  get(experimentId: string): ExperimentDetail {
    const experiment = this.getRecord(experimentId)
    const cells = this.listCells(experimentId)
    return experimentDetailSchema.parse({
      experiment,
      cells,
      comparison: compareExperimentCells(cells),
    })
  }

  list(agentId: string | null): ExperimentRecord[] {
    const rows = (agentId
      ? this.#database
          .prepare(
            `SELECT id, agent_id, name, research_question, status, definition_json, drift_json,
             started_at, finished_at, created_at, updated_at FROM experiments
             WHERE agent_id = ? ORDER BY created_at DESC`,
          )
          .all(agentId)
      : this.#database
          .prepare(
            `SELECT id, agent_id, name, research_question, status, definition_json, drift_json,
             started_at, finished_at, created_at, updated_at FROM experiments ORDER BY created_at DESC`,
          )
          .all()) as unknown as ExperimentRow[]
    return experimentListSchema.parse(rows.map(mapExperiment))
  }

  close(): void {
    this.#database.close()
  }
}
