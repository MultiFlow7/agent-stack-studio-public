import { describe, expect, it } from 'vitest'
import { modelAuthSelectInputSchema, modelAuthVerifyInputSchema } from './model-auth-ipc'

describe('model auth IPC schemas', () => {
  it('accepts only portable Provider/model credential requirements', () => {
    const input = {
      expectedRevision: 3,
      modelConfiguration: {
        providerId: 'openai',
        modelId: 'gpt-5.1',
        credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
      },
    }
    expect(modelAuthSelectInputSchema.parse(input)).toEqual(input)
    for (const forbidden of [
      { apiKey: 'opaque-canary' },
      { secret: 'opaque-canary' },
      { bindingId: crypto.randomUUID() },
      { keychainAccount: 'account' },
    ]) {
      expect(() =>
        modelAuthSelectInputSchema.parse({
          ...input,
          modelConfiguration: { ...input.modelConfiguration, ...forbidden },
        }),
      ).toThrow()
    }
  })

  it('requires an explicit cost acknowledgement before model verification', () => {
    expect(() =>
      modelAuthVerifyInputSchema.parse({ requestId: crypto.randomUUID(), timeoutMs: 5_000 }),
    ).toThrow()
    expect(
      modelAuthVerifyInputSchema.parse({
        requestId: crypto.randomUUID(),
        costAcknowledged: true,
        timeoutMs: 5_000,
      }).costAcknowledged,
    ).toBe(true)
  })
})
