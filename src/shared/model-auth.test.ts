import { describe, expect, it } from 'vitest'
import {
  KNOWN_HARNESS_MODEL_CATALOG,
  agentModelReadinessSchema,
  assertSupportedModelSelection,
  buildAgentModelReadiness,
  harnessModelCatalogSchema,
  modelConfigurationSchema,
  type BuildAgentModelReadinessInput,
} from './model-auth'

const configuration = modelConfigurationSchema.parse({
  providerId: 'openai',
  modelId: 'gpt-5.1',
  credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
})

const baseInput: BuildAgentModelReadinessInput = {
  stackCompatible: true,
  harnessStatus: 'ready',
  configurationState: 'configured',
  configuration,
  authentication: {
    harnessId: 'pi',
    providerId: 'openai',
    authMethod: 'api-key',
    state: 'credential-valid',
    detail: 'Keychain 绑定存在。',
    checkedAt: '2026-08-26T08:00:00.000Z',
    failure: null,
  },
  verification: {
    state: 'not-run',
    configurationHash: null,
    checkedAt: null,
    failure: null,
  },
}

describe('model authentication domain', () => {
  it('keeps the portable configuration strict and enforces credential kind', () => {
    expect(configuration.credentialRequirement).toEqual({
      method: 'api-key',
      credentialKind: 'api-key',
    })
    expect(() =>
      modelConfigurationSchema.parse({
        ...configuration,
        credentialRequirement: { method: 'api-key', credentialKind: 'harness-session' },
      }),
    ).toThrow('认证方式与凭证需求不匹配')
    expect(() =>
      modelConfigurationSchema.parse({ ...configuration, apiKey: 'forbidden' }),
    ).toThrow()
  })

  it('publishes one strict capability catalog for Pi, OpenClaw and Codex', () => {
    expect(harnessModelCatalogSchema.parse(KNOWN_HARNESS_MODEL_CATALOG)).toHaveLength(3)
    const pi = KNOWN_HARNESS_MODEL_CATALOG.find(({ harnessId }) => harnessId === 'pi')!
    const openclaw = KNOWN_HARNESS_MODEL_CATALOG.find(({ harnessId }) => harnessId === 'openclaw')!
    const codex = KNOWN_HARNESS_MODEL_CATALOG.find(({ harnessId }) => harnessId === 'codex')!
    expect(pi.requiredVersion).toBe('0.84.2')
    expect(
      pi.providers.every(({ customModelIds }) => customModelIds.availability === 'available'),
    ).toBe(true)
    expect(pi.providers.find(({ id }) => id === 'openai')?.authMethods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'api-key', availability: 'available' }),
      ]),
    )
    expect(openclaw.providers.flatMap(({ authMethods }) => authMethods)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ method: 'api-key' })]),
    )
    expect(codex.providers.flatMap(({ authMethods }) => authMethods)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ method: 'api-key' })]),
    )
  })

  it('accepts safe custom model IDs while keeping Provider and auth combinations allowlisted', () => {
    expect(
      assertSupportedModelSelection({
        harnessId: 'pi',
        ...configuration,
      }),
    ).toMatchObject({ harnessId: 'pi', providerId: 'openai', modelId: 'gpt-5.1' })
    expect(() =>
      assertSupportedModelSelection({
        harnessId: 'codex',
        ...configuration,
      }),
    ).toThrow('不支持所选认证方式')
    expect(
      assertSupportedModelSelection({
        harnessId: 'pi',
        ...configuration,
        modelId: 'gpt-5.6-sol',
      }),
    ).toMatchObject({ harnessId: 'pi', providerId: 'openai', modelId: 'gpt-5.6-sol' })
    expect(() =>
      assertSupportedModelSelection({
        harnessId: 'pi',
        ...configuration,
        modelId: 'gpt 5.6 sol',
      }),
    ).toThrow()
    expect(() =>
      assertSupportedModelSelection({
        harnessId: 'openclaw',
        providerId: 'openai-codex',
        modelId: 'gpt-5.1-codex',
        credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
      }),
    ).toThrow('不支持所选认证方式')
  })

  it.each([
    [{ stackCompatible: false }, 'stack-incompatible', 'stack-incompatible'],
    [{ harnessStatus: 'not-selected' }, 'harness-not-selected', 'harness-not-selected'],
    [{ harnessStatus: 'not-installed' }, 'harness-not-installed', 'harness-not-installed'],
    [
      { harnessStatus: 'unsupported-version' },
      'harness-version-unsupported',
      'harness-version-unsupported',
    ],
    [
      { configurationState: 'provider-not-selected', configuration: null },
      'provider-not-selected',
      'provider-not-selected',
    ],
    [
      { configurationState: 'model-not-selected', configuration: null },
      'model-not-selected',
      'model-not-selected',
    ],
    [{ authentication: null }, 'unauthenticated', 'authentication-required'],
  ] as const)('derives blocking readiness facts for %o', (overrides, state, blockerCode) => {
    const readiness = buildAgentModelReadiness({ ...baseInput, ...overrides })
    expect(readiness).toMatchObject({ state, ready: false })
    expect(readiness.blockers[0]?.code).toBe(blockerCode)
  })

  it('keeps a valid credential distinct from a successful minimum model call', () => {
    const credentialOnly = buildAgentModelReadiness(baseInput)
    expect(credentialOnly).toMatchObject({ state: 'credential-valid', ready: false })
    expect(credentialOnly.blockers[0]?.code).toBe('verification-required')

    const ready = buildAgentModelReadiness({
      ...baseInput,
      verification: {
        state: 'minimal-call-succeeded',
        configurationHash: 'a'.repeat(64),
        checkedAt: '2026-08-26T08:01:00.000Z',
        failure: null,
      },
    })
    expect(ready).toMatchObject({ state: 'minimal-call-succeeded', ready: true, blockers: [] })
  })

  it('fails validation if callers try to label incomplete facts as ready', () => {
    expect(() =>
      agentModelReadinessSchema.parse({
        ...buildAgentModelReadiness(baseInput),
        ready: true,
        state: 'minimal-call-succeeded',
      }),
    ).toThrow('必须同时满足兼容性')
  })
})
