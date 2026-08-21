import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { stableHash, type StudioProject } from '../../core/project-model'
import { migrate } from './migrations'

interface ProjectIndexRow {
  id: string
  project_path: string
  display_name: string
  last_seen_revision: number
  last_seen_hash: string
  last_opened_at: string
  created_at: string
  updated_at: string
}

export interface ProjectIndexRecord {
  id: string
  projectPath: string
  displayName: string
  lastSeenRevision: number
  lastSeenHash: string
  lastOpenedAt: string
  createdAt: string
  updatedAt: string
}

function mapRow(row: ProjectIndexRow): ProjectIndexRecord {
  return {
    id: row.id,
    projectPath: row.project_path,
    displayName: row.display_name,
    lastSeenRevision: row.last_seen_revision,
    lastSeenHash: row.last_seen_hash,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class ProjectIndexRepository {
  readonly #database: Database.Database

  constructor(databasePath: string) {
    this.#database = new Database(databasePath)
    this.#database.pragma('foreign_keys = ON')
    this.#database.pragma('journal_mode = WAL')
    migrate(this.#database)
  }

  touch(projectPath: string, project: StudioProject): ProjectIndexRecord {
    const timestamp = new Date().toISOString()
    const hash = stableHash(project)
    this.#database
      .prepare(
        `INSERT INTO studio_projects
         (id, project_path, display_name, last_seen_revision, last_seen_hash,
          last_opened_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (project_path) DO UPDATE SET
           id = excluded.id,
           display_name = excluded.display_name,
           last_seen_revision = excluded.last_seen_revision,
           last_seen_hash = excluded.last_seen_hash,
           last_opened_at = excluded.last_opened_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        project.id,
        projectPath,
        project.name,
        project.revision,
        hash,
        timestamp,
        timestamp,
        timestamp,
      )
    const record = this.findByPath(projectPath)
    if (!record) throw new Error('Project index write failed.')
    return record
  }

  latest(): ProjectIndexRecord | null {
    const row = this.#database
      .prepare(
        `SELECT id, project_path, display_name, last_seen_revision, last_seen_hash,
         last_opened_at, created_at, updated_at FROM studio_projects
         ORDER BY last_opened_at DESC LIMIT 1`,
      )
      .get() as ProjectIndexRow | undefined
    return row ? mapRow(row) : null
  }

  findByPath(projectPath: string): ProjectIndexRecord | null {
    const row = this.#database
      .prepare(
        `SELECT id, project_path, display_name, last_seen_revision, last_seen_hash,
         last_opened_at, created_at, updated_at FROM studio_projects WHERE project_path = ?`,
      )
      .get(projectPath) as ProjectIndexRow | undefined
    return row ? mapRow(row) : null
  }

  setPreference(key: string, value: unknown): void {
    this.#database
      .prepare(
        `INSERT INTO app_preferences (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), new Date().toISOString())
  }

  preference<T>(key: string): T | null {
    const row = this.#database
      .prepare('SELECT value_json FROM app_preferences WHERE key = ?')
      .get(key) as { value_json: string } | undefined
    return row ? (JSON.parse(row.value_json) as T) : null
  }

  recordMaintenance(
    kind: 'project-migration' | 'project-recovery' | 'demo-data-load',
    projectId: string | null,
    details: unknown,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO maintenance_records (id, kind, project_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), kind, projectId, JSON.stringify(details), new Date().toISOString())
  }

  setComponentPath(projectId: string, componentId: string, sourcePath: string): void {
    this.#database
      .prepare(
        `INSERT INTO project_component_paths (project_id, component_id, source_path, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id, component_id) DO UPDATE SET
           source_path = excluded.source_path, updated_at = excluded.updated_at`,
      )
      .run(projectId, componentId, sourcePath, new Date().toISOString())
  }

  componentPath(projectId: string, componentId: string): string | null {
    const row = this.#database
      .prepare(
        'SELECT source_path FROM project_component_paths WHERE project_id = ? AND component_id = ?',
      )
      .get(projectId, componentId) as { source_path: string } | undefined
    return row?.source_path ?? null
  }

  close(): void {
    this.#database.close()
  }
}
