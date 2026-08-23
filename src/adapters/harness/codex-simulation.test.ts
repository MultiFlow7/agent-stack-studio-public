import { describe, expect, it } from 'vitest'
import { codexSimulationFromEnvironment } from './codex-simulation'

describe('Codex simulation environment', () => {
  it('stays disabled unless explicitly enabled', () => {
    expect(codexSimulationFromEnvironment({})).toBeNull()
    expect(
      codexSimulationFromEnvironment({
        STUDIO_CODEX_SIMULATION_URL: 'http://127.0.0.1:43123/v1',
      }),
    ).toBeNull()
  })

  it('accepts only an explicit loopback OpenAI endpoint', () => {
    expect(
      codexSimulationFromEnvironment({
        STUDIO_CODEX_SIMULATION: '1',
        STUDIO_CODEX_SIMULATION_URL: 'http://127.0.0.1:43123/v1/',
      }),
    ).toEqual({
      endpoint: 'http://127.0.0.1:43123/v1',
      providerId: 'studio-codex-simulation',
      modelId: 'codex-simulation',
      apiKey: 'studio-local-simulation',
    })
  })

  it.each([
    undefined,
    'https://127.0.0.1:43123/v1',
    'http://example.com:43123/v1',
    'http://127.0.0.1/v1',
    'http://user:secret@127.0.0.1:43123/v1',
    'http://127.0.0.1:43123/v1?token=secret',
    'http://127.0.0.1:43123/other',
  ])('rejects unsafe endpoint %s', (url) => {
    expect(() =>
      codexSimulationFromEnvironment({
        STUDIO_CODEX_SIMULATION: '1',
        STUDIO_CODEX_SIMULATION_URL: url,
      }),
    ).toThrow()
  })
})
