import { describe, expect, it } from 'vitest'
import {
  agentSetupSessionSchema,
  buildAgentSetupReadiness,
  emptyAgentSetupProfile,
} from './agent-setup'
import type { HarnessProbe } from './native-agent'

const timestamp = '2026-08-26T08:00:00.000Z'

function probe(status: HarnessProbe['status'] = 'ready'): HarnessProbe {
  return {
    id: 'pi',
    label: 'Pi',
    executable: 'pi',
    status,
    version: status === 'not-installed' ? null : '0.84.2',
    requiredVersion: '0.84.2',
    capabilities: {
      prompt: 'native',
      skills: 'native',
      memory: 'native',
      mcp: 'native',
      sessions: 'native',
    },
    detail: '本机检查结果。',
  }
}

function session() {
  return agentSetupSessionSchema.parse({
    id: '4061fbad-2152-47bc-9db3-bd70d133f2be',
    status: 'transient',
    revision: 1,
    step: 'review',
    name: 'Research Agent',
    description: '',
    harnessId: 'pi',
    selection: {
      harnessId: 'pi',
      providerId: 'openai',
      modelId: 'gpt-5.1',
      credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
    },
    profile: { ...emptyAgentSetupProfile, instructions: 'Keep answers evidence-based.' },
    authentication: {
      harnessId: 'pi',
      providerId: 'openai',
      authMethod: 'api-key',
      state: 'credential-valid',
      detail: '凭证有效。',
      checkedAt: timestamp,
      failure: null,
    },
    verification: {
      state: 'minimal-call-succeeded',
      configurationHash: 'a'.repeat(64),
      checkedAt: timestamp,
      failure: null,
    },
    hasKeychainCredential: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
}

describe('Agent setup readiness', () => {
  it('requires the five base completion facts and reuses model readiness', () => {
    const readiness = buildAgentSetupReadiness({ session: session(), probe: probe() })

    expect(readiness.ready).toBe(true)
    expect(readiness.model.state).toBe('minimal-call-succeeded')
    expect(readiness.hasCapability).toBe(true)
    expect(readiness.blockers).toEqual([])
  })

  it('returns focused recovery for an unavailable Harness without inventing a capability blocker', () => {
    const current = session()
    const readiness = buildAgentSetupReadiness({
      session: {
        ...current,
        profile: emptyAgentSetupProfile,
      },
      probe: probe('not-installed'),
    })

    expect(readiness.ready).toBe(false)
    expect(readiness.hasCapability).toBe(false)
    expect(readiness.blockers).toEqual([
      expect.objectContaining({ id: 'harness', step: 'harness' }),
    ])
  })

  it('allows a verified setup to complete with no optional capabilities', () => {
    const current = session()
    const readiness = buildAgentSetupReadiness({
      session: { ...current, profile: emptyAgentSetupProfile, capabilitySelections: [] },
      probe: probe(),
    })

    expect(readiness.ready).toBe(true)
    expect(readiness.hasCapability).toBe(false)
    expect(readiness.blockers).toEqual([])
  })

  it('never accepts an API Key value in the session contract', () => {
    expect(() => agentSetupSessionSchema.parse({ ...session(), apiKey: 'secret-value' })).toThrow()
    expect(JSON.stringify(session())).not.toContain('secret-value')
  })

  it('requires exact approval and validation for a selected MCP on Pi', () => {
    const current = session()
    const server = {
      id: 'fixture-mcp',
      name: 'Fixture MCP',
      transport: 'stdio' as const,
      command: '/usr/bin/env',
      args: ['node'],
      url: null,
      secretReferences: [],
      enabled: true,
      approval: 'approved' as const,
    }
    const pending = buildAgentSetupReadiness({
      session: { ...current, profile: { ...emptyAgentSetupProfile, mcpServers: [server] } },
      probe: probe(),
    })
    const ready = buildAgentSetupReadiness({
      session: {
        ...current,
        profile: { ...emptyAgentSetupProfile, mcpServers: [server] },
        mcpValidations: [
          {
            serverId: server.id,
            configurationHash: 'b'.repeat(64),
            server,
            state: 'succeeded',
            transport: 'stdio',
            checkedAt: timestamp,
            executable: '/usr/bin/env',
            toolNames: ['fixture_echo'],
            failure: null,
          },
        ],
      },
      probe: probe(),
    })

    expect(pending.blockers).toContainEqual(expect.objectContaining({ id: 'capability' }))
    expect(ready.ready).toBe(true)
  })

  it('truthfully blocks Profile MCP transports that the selected Harness cannot consume', () => {
    const current = session()
    const openclawSession = agentSetupSessionSchema.parse({
      ...current,
      harnessId: 'openclaw',
      selection: {
        harnessId: 'openclaw',
        providerId: 'openai-codex',
        modelId: 'gpt-5.1-codex',
        credentialRequirement: {
          method: 'existing-login',
          credentialKind: 'harness-session',
        },
      },
      authentication: {
        harnessId: 'openclaw',
        providerId: 'openai-codex',
        authMethod: 'existing-login',
        state: 'credential-valid',
        detail: '凭证有效。',
        checkedAt: timestamp,
        failure: null,
      },
      hasKeychainCredential: false,
      profile: {
        ...emptyAgentSetupProfile,
        mcpServers: [
          {
            id: 'remote-mcp',
            name: 'Remote MCP',
            transport: 'http',
            command: null,
            args: [],
            url: 'https://mcp.example.test/rpc',
            secretReferences: [],
            enabled: true,
            approval: 'approved',
          },
        ],
      },
    })
    const openclawProbe = {
      ...probe(),
      id: 'openclaw' as const,
      label: 'OpenClaw',
      executable: 'openclaw',
    }
    const readiness = buildAgentSetupReadiness({
      session: openclawSession,
      probe: openclawProbe,
    })

    expect(readiness.ready).toBe(false)
    const blocker = readiness.blockers.find(({ id }) => id === 'capability')
    expect(blocker?.recoveryAction).toContain('移除')
  })
})
