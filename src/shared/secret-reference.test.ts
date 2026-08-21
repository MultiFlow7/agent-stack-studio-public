import { describe, expect, it } from 'vitest'
import { configureAgentSecretInputSchema } from './secret-reference'

describe('secret reference IPC contract', () => {
  it('rejects a secret value before it can enter the Renderer-to-Main payload', () => {
    expect(
      configureAgentSecretInputSchema.safeParse({
        agentId: '4061fbad-2152-47bc-9db3-bd70d133f2be',
        label: 'OpenAI API',
        keychainAccount: 'openai-api',
        secret: 'must-not-cross-ipc',
      }).success,
    ).toBe(false)
  })
})
