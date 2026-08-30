import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { z } from 'zod'
import {
  agentSetupListSchema,
  agentSetupSessionSchema,
  emptyAgentSetupProfile,
  type AgentSetupSession,
  type AgentSetupUpdateInput,
} from '../../shared/agent-setup'
import { AppError } from '../../shared/errors'
import { modelVerificationStatusSchema } from '../../shared/model-auth'
import type { SetupCapabilityItem } from '../../shared/setup-capability'
import type { McpValidationRecord } from '../../shared/mcp'
import { migrate } from './migrations'

interface AgentSetupRow {
  id: string
  status: string
  revision: number
  step: string
  name: string
  description: string
  harness_id: string | null
  selection_json: string | null
  profile_json: string
  capability_selections_json: string
  mcp_validations_json: string
  authentication_json: string | null
  verification_json: string
  keychain_service: string | null
  keychain_account: string | null
  created_at: string
  updated_at: string
}

export interface AgentSetupKeychainLocator {
  service: string
  account: string
}

function mapSetup(row: AgentSetupRow): AgentSetupSession {
  return agentSetupSessionSchema.parse({
    id: row.id,
    status: row.status,
    revision: row.revision,
    step: row.step,
    name: row.name,
    description: row.description,
    harnessId: row.harness_id,
    selection: row.selection_json ? (JSON.parse(row.selection_json) as unknown) : null,
    profile: JSON.parse(row.profile_json) as unknown,
    capabilitySelections: JSON.parse(row.capability_selections_json) as unknown,
    mcpValidations: JSON.parse(row.mcp_validations_json) as unknown,
    authentication: row.authentication_json
      ? (JSON.parse(row.authentication_json) as unknown)
      : null,
    verification: JSON.parse(row.verification_json) as unknown,
    hasKeychainCredential: Boolean(row.keychain_service && row.keychain_account),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

const columns = `id, status, revision, step, name, description, harness_id,
  selection_json, profile_json, capability_selections_json, mcp_validations_json,
  authentication_json, verification_json,
  keychain_service, keychain_account, created_at, updated_at`

export class AgentSetupRepository {
  readonly #database: Database.Database

  constructor(databasePath: string) {
    this.#database = new Database(databasePath)
    this.#database.pragma('foreign_keys = ON')
    this.#database.pragma('journal_mode = WAL')
    migrate(this.#database)
  }

  create(): AgentSetupSession {
    const timestamp = new Date().toISOString()
    const session = agentSetupSessionSchema.parse({
      id: randomUUID(),
      status: 'transient',
      revision: 1,
      step: 'basics',
      name: '',
      description: '',
      harnessId: null,
      selection: null,
      profile: emptyAgentSetupProfile,
      capabilitySelections: [],
      mcpValidations: [],
      authentication: null,
      verification: modelVerificationStatusSchema.parse({
        state: 'not-run',
        configurationHash: null,
        checkedAt: null,
        failure: null,
      }),
      hasKeychainCredential: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    this.#database
      .prepare(
        `INSERT INTO agent_setup_sessions
         (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        session.id,
        session.status,
        session.revision,
        session.step,
        session.name,
        session.description,
        session.harnessId,
        null,
        JSON.stringify(session.profile),
        JSON.stringify(session.capabilitySelections),
        JSON.stringify(session.mcpValidations),
        null,
        JSON.stringify(session.verification),
        session.createdAt,
        session.updatedAt,
      )
    return session
  }

  get(id: string): AgentSetupSession {
    const row = this.#database
      .prepare(`SELECT ${columns} FROM agent_setup_sessions WHERE id = ?`)
      .get(z.uuid().parse(id)) as AgentSetupRow | undefined
    if (!row) throw new AppError('NOT_FOUND', '找不到该 Agent 设置草稿。')
    return mapSetup(row)
  }

  listSaved(): AgentSetupSession[] {
    const rows = this.#database
      .prepare(
        `SELECT ${columns} FROM agent_setup_sessions
         WHERE status = 'saved' ORDER BY updated_at DESC, id`,
      )
      .all() as unknown as AgentSetupRow[]
    return agentSetupListSchema.parse(rows.map(mapSetup))
  }

  listTransient(): AgentSetupSession[] {
    const rows = this.#database
      .prepare(
        `SELECT ${columns} FROM agent_setup_sessions
         WHERE status = 'transient' ORDER BY updated_at, id`,
      )
      .all() as unknown as AgentSetupRow[]
    return rows.map(mapSetup)
  }

  update(
    input: AgentSetupUpdateInput & { capabilitySelections?: SetupCapabilityItem[] },
  ): AgentSetupSession {
    const current = this.get(input.id)
    if (current.revision !== input.expectedRevision) {
      throw new AppError('VALIDATION_FAILED', '设置草稿已在其他窗口变化，请重新载入后继续。')
    }
    const selectionChanged = JSON.stringify(current.selection) !== JSON.stringify(input.selection)
    const authIdentityChanged =
      current.selection?.harnessId !== input.selection?.harnessId ||
      current.selection?.providerId !== input.selection?.providerId ||
      current.selection?.credentialRequirement.method !==
        input.selection?.credentialRequirement.method
    const timestamp = new Date().toISOString()
    const verification = selectionChanged
      ? { state: 'not-run', configurationHash: null, checkedAt: null, failure: null }
      : current.verification
    const authentication = authIdentityChanged ? null : current.authentication
    const capabilitySelections = input.capabilitySelections ?? current.capabilitySelections
    const configuredMcpServers = [
      ...input.profile.mcpServers,
      ...capabilitySelections.flatMap((item) => (item.kind === 'mcp' ? [item.server] : [])),
    ]
    const mcpValidations = current.mcpValidations.filter((validation) =>
      configuredMcpServers.some(
        (server) =>
          server.id === validation.serverId &&
          JSON.stringify(server) === JSON.stringify(validation.server),
      ),
    )
    const result = this.#database
      .prepare(
        `UPDATE agent_setup_sessions SET
          revision = revision + 1, step = ?, name = ?, description = ?, harness_id = ?,
          selection_json = ?, profile_json = ?, capability_selections_json = ?, mcp_validations_json = ?,
          authentication_json = ?, verification_json = ?,
          keychain_service = CASE WHEN ? THEN NULL ELSE keychain_service END,
          keychain_account = CASE WHEN ? THEN NULL ELSE keychain_account END,
          updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(
        input.step,
        input.name,
        input.description,
        input.harnessId,
        input.selection ? JSON.stringify(input.selection) : null,
        JSON.stringify(input.profile),
        JSON.stringify(capabilitySelections),
        JSON.stringify(mcpValidations),
        authentication ? JSON.stringify(authentication) : null,
        JSON.stringify(verification),
        authIdentityChanged ? 1 : 0,
        authIdentityChanged ? 1 : 0,
        timestamp,
        input.id,
        input.expectedRevision,
      )
    if (result.changes !== 1) {
      throw new AppError('VALIDATION_FAILED', '设置草稿已变化，请重新载入。')
    }
    return this.get(input.id)
  }

  setMcpValidation(id: string, validation: McpValidationRecord): AgentSetupSession {
    const current = this.get(id)
    const timestamp = new Date().toISOString()
    const validations = [
      ...current.mcpValidations.filter(({ serverId }) => serverId !== validation.serverId),
      validation,
    ]
    this.#database
      .prepare(
        `UPDATE agent_setup_sessions SET
          revision = revision + 1, mcp_validations_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(validations), timestamp, id)
    return this.get(id)
  }

  save(id: string, expectedRevision: number): AgentSetupSession {
    const current = this.get(id)
    if (current.status === 'saved') return current
    if (current.revision !== expectedRevision) {
      throw new AppError('VALIDATION_FAILED', '设置草稿已变化，请重新载入。')
    }
    const timestamp = new Date().toISOString()
    this.#database
      .prepare(
        `UPDATE agent_setup_sessions
         SET status = 'saved', revision = revision + 1, updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(timestamp, id, expectedRevision)
    return this.get(id)
  }

  setAuthentication(input: {
    id: string
    authentication: AgentSetupSession['authentication']
    verification?: AgentSetupSession['verification']
    locator?: AgentSetupKeychainLocator | null
  }): AgentSetupSession {
    const current = this.get(input.id)
    const timestamp = new Date().toISOString()
    const locator = input.locator === undefined ? this.keychainLocator(input.id) : input.locator
    this.#database
      .prepare(
        `UPDATE agent_setup_sessions SET
          revision = revision + 1, authentication_json = ?, verification_json = ?,
          keychain_service = ?, keychain_account = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        input.authentication ? JSON.stringify(input.authentication) : null,
        JSON.stringify(input.verification ?? current.verification),
        locator?.service ?? null,
        locator?.account ?? null,
        timestamp,
        input.id,
      )
    return this.get(input.id)
  }

  setVerification(id: string, verification: AgentSetupSession['verification']): AgentSetupSession {
    const timestamp = new Date().toISOString()
    this.#database
      .prepare(
        `UPDATE agent_setup_sessions
         SET revision = revision + 1, verification_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(verification), timestamp, z.uuid().parse(id))
    return this.get(id)
  }

  keychainLocator(id: string): AgentSetupKeychainLocator | null {
    const row = this.#database
      .prepare('SELECT keychain_service, keychain_account FROM agent_setup_sessions WHERE id = ?')
      .get(z.uuid().parse(id)) as
      | { keychain_service: string | null; keychain_account: string | null }
      | undefined
    if (!row) throw new AppError('NOT_FOUND', '找不到该 Agent 设置草稿。')
    return row.keychain_service && row.keychain_account
      ? { service: row.keychain_service, account: row.keychain_account }
      : null
  }

  delete(id: string): void {
    this.#database.prepare('DELETE FROM agent_setup_sessions WHERE id = ?').run(z.uuid().parse(id))
  }

  close(): void {
    this.#database.close()
  }
}
