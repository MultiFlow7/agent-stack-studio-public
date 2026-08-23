import type Database from 'better-sqlite3'

interface Migration {
  version: number
  sql: string
}

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE agents (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        execution_mode TEXT NOT NULL CHECK (
          execution_mode IN ('agent-loop', 'workflow', 'hybrid', 'external-harness')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE agent_stack_drafts (
        agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        execution_mode TEXT NOT NULL CHECK (
          execution_mode IN ('agent-loop', 'workflow', 'hybrid', 'external-harness')
        ),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
        updated_at TEXT NOT NULL
      );

      INSERT INTO agent_stack_drafts (agent_id, execution_mode, revision, updated_at)
      SELECT id, execution_mode, 1, updated_at FROM agents;

      CREATE TABLE agent_versions (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
        version_number INTEGER NOT NULL CHECK (version_number > 0),
        snapshot_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (agent_id, version_number)
      );

      CREATE TABLE agent_locations (
        agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        workspace_path TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('blank', 'local-import')),
        source_path TEXT
      );

      CREATE TABLE secret_references (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        keychain_service TEXT NOT NULL,
        keychain_account TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (agent_id, label)
      );
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE components (
        id TEXT PRIMARY KEY NOT NULL,
        contract_id TEXT NOT NULL,
        version TEXT NOT NULL,
        descriptor_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (contract_id, version)
      );

      CREATE TABLE agent_stack_components (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        component_id TEXT NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
        added_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, component_id)
      );

      CREATE TABLE capability_owners (
        agent_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        component_id TEXT NOT NULL,
        selected_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, capability),
        FOREIGN KEY (agent_id, component_id)
          REFERENCES agent_stack_components(agent_id, component_id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE runs (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
        agent_version_id TEXT NOT NULL REFERENCES agent_versions(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (
          status IN ('queued', 'starting', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'timed-out')
        ),
        manifest_json TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        failure_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX runs_agent_created_idx ON runs(agent_id, created_at DESC);

      CREATE TABLE run_events (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (run_id, sequence)
      );

      CREATE TABLE run_artifacts (
        id TEXT PRIMARY KEY NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('output', 'log', 'metrics')),
        relative_path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        created_at TEXT NOT NULL,
        UNIQUE (run_id, relative_path)
      );
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE experiments (
        id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
        baseline_agent_version_id TEXT NOT NULL REFERENCES agent_versions(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        research_question TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('ready', 'running', 'cancelling', 'completed', 'completed-with-errors', 'blocked', 'cancelled')
        ),
        definition_json TEXT NOT NULL,
        drift_json TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX experiments_agent_created_idx ON experiments(agent_id, created_at DESC);

      CREATE TABLE experiment_cells (
        id TEXT PRIMARY KEY NOT NULL,
        experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
        prompt_index INTEGER NOT NULL CHECK (prompt_index >= 0),
        prompt_value TEXT NOT NULL,
        random_seed INTEGER NOT NULL CHECK (random_seed >= 0),
        repetition INTEGER NOT NULL CHECK (repetition > 0),
        status TEXT NOT NULL CHECK (
          status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'blocked')
        ),
        run_id TEXT REFERENCES runs(id) ON DELETE RESTRICT,
        duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        failure_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (experiment_id, prompt_index, random_seed, repetition)
      );

      CREATE INDEX experiment_cells_run_idx ON experiment_cells(run_id);
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE publish_mappings (
        target_id TEXT NOT NULL,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
        remote_agent_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (target_id, agent_id),
        UNIQUE (target_id, remote_agent_id)
      );

      CREATE TABLE publish_receipts (
        id TEXT PRIMARY KEY NOT NULL,
        target_id TEXT NOT NULL,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
        agent_version_id TEXT NOT NULL REFERENCES agent_versions(id) ON DELETE RESTRICT,
        package_hash TEXT NOT NULL,
        package_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        attempt INTEGER NOT NULL CHECK (attempt > 0),
        status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
        remote_agent_id TEXT,
        remote_version_id TEXT,
        response_json TEXT,
        failure_json TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE (target_id, agent_version_id, package_hash, attempt)
      );

      CREATE INDEX publish_receipts_agent_created_idx
        ON publish_receipts(agent_id, created_at DESC);
      CREATE INDEX publish_receipts_idempotency_idx
        ON publish_receipts(idempotency_key, status);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE studio_projects (
        id TEXT PRIMARY KEY NOT NULL,
        project_path TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        last_seen_revision INTEGER NOT NULL CHECK (last_seen_revision >= 0),
        last_seen_hash TEXT NOT NULL,
        last_opened_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX studio_projects_last_opened_idx
        ON studio_projects(last_opened_at DESC);

      CREATE TABLE app_preferences (
        key TEXT PRIMARY KEY NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE maintenance_records (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (
          kind IN ('project-migration', 'project-recovery', 'demo-data-load')
        ),
        project_id TEXT,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE project_component_paths (
        project_id TEXT NOT NULL,
        component_id TEXT NOT NULL,
        source_path TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, component_id)
      );
    `,
  },
  {
    version: 8,
    sql: `
      ALTER TABLE agents ADD COLUMN archived_at TEXT;
      CREATE INDEX agents_archived_idx ON agents(archived_at);
    `,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE agent_project_links (
        agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL UNIQUE,
        project_path TEXT NOT NULL UNIQUE,
        linked_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX agent_project_links_project_idx
        ON agent_project_links(project_id);
    `,
  },
]

export const CURRENT_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0

export function migrate(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  const appliedRows = database.prepare('SELECT version FROM schema_migrations').all() as Array<{
    version: number
  }>
  const applied = new Set(appliedRows.map(({ version }) => version))
  const newestAppliedVersion = Math.max(0, ...applied)
  if (newestAppliedVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `数据库版本 ${newestAppliedVersion} 高于当前应用支持的版本 ${CURRENT_SCHEMA_VERSION}，已停止打开以避免数据损坏。`,
    )
  }
  const recordMigration = database.prepare(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  )

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue

    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(migration.sql)
      recordMigration.run(migration.version, new Date().toISOString())
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}
