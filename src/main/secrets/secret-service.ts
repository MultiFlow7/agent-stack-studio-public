import {
  defaultKeychainService,
  type KeychainAdapter,
} from '../../adapters/keychain/macos-keychain-adapter'
import type {
  ConfigureAgentSecretInput,
  SecretReferenceStatus,
} from '../../shared/secret-reference'
import type { AgentRepository } from '../persistence/agent-repository'

export class SecretService {
  readonly #repository: AgentRepository
  readonly #keychain: KeychainAdapter

  constructor(options: { repository: AgentRepository; keychain: KeychainAdapter }) {
    this.#repository = options.repository
    this.#keychain = options.keychain
  }

  async list(agentId: string): Promise<SecretReferenceStatus[]> {
    this.#repository.getDetail(agentId)
    return Promise.all(
      this.#repository.listSecretReferences(agentId).map(async (reference) => ({
        ...reference,
        configured: await this.#keychain.has({
          service: reference.keychainService,
          account: reference.keychainAccount,
        }),
      })),
    )
  }

  async configure(
    input: ConfigureAgentSecretInput & { secret: string },
  ): Promise<SecretReferenceStatus> {
    this.#repository.getDetail(input.agentId)
    const existing = this.#repository
      .listSecretReferences(input.agentId)
      .find(
        (reference) =>
          reference.keychainService === defaultKeychainService &&
          reference.keychainAccount === input.keychainAccount,
      )
    await this.#keychain.set(
      { service: defaultKeychainService, account: input.keychainAccount },
      input.secret,
      input.label,
    )
    if (existing) {
      const reference =
        existing.label === input.label
          ? existing
          : this.#repository.updateSecretReferenceLabel(existing.id, input.label)
      return { ...reference, configured: true }
    }
    try {
      const reference = this.#repository.saveSecretReference({
        agentId: input.agentId,
        label: input.label,
        keychainService: defaultKeychainService,
        keychainAccount: input.keychainAccount,
      })
      return { ...reference, configured: true }
    } catch (error) {
      await this.#keychain.delete({
        service: defaultKeychainService,
        account: input.keychainAccount,
      })
      throw error
    }
  }

  async delete(referenceId: string): Promise<{ referenceId: string; deleted: boolean }> {
    const reference = this.#repository.getSecretReference(referenceId)
    const deleted = await this.#keychain.delete({
      service: reference.keychainService,
      account: reference.keychainAccount,
    })
    this.#repository.deleteSecretReference(referenceId)
    return { referenceId, deleted }
  }

  async readForRuntime(referenceId: string): Promise<string | null> {
    const reference = this.#repository.getSecretReference(referenceId)
    return this.#keychain.get({
      service: reference.keychainService,
      account: reference.keychainAccount,
    })
  }
}
