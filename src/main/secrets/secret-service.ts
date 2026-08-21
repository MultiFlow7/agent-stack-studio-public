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
  readonly #operations = new Map<string, Promise<void>>()

  constructor(options: { repository: AgentRepository; keychain: KeychainAdapter }) {
    this.#repository = options.repository
    this.#keychain = options.keychain
  }

  async list(agentId: string): Promise<SecretReferenceStatus[]> {
    this.#repository.getDetail(agentId)
    const result: SecretReferenceStatus[] = []
    for (const reference of this.#repository.listSecretReferences(agentId)) {
      const locator = { service: reference.keychainService, account: reference.keychainAccount }
      result.push({
        ...reference,
        configured: await this.#serialized(locator, () => this.#keychain.has(locator)),
      })
    }
    return result
  }

  async configure(
    input: ConfigureAgentSecretInput & { secret: string },
  ): Promise<SecretReferenceStatus> {
    this.#repository.getDetail(input.agentId)
    const locator = { service: defaultKeychainService, account: input.keychainAccount }
    return this.#serialized(locator, async () => {
      const existing = this.#repository
        .listSecretReferences(input.agentId)
        .find(
          (reference) =>
            reference.keychainService === defaultKeychainService &&
            reference.keychainAccount === input.keychainAccount,
        )
      await this.#keychain.set(locator, input.secret, input.label)
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
        await this.#keychain.delete(locator)
        throw error
      }
    })
  }

  async delete(referenceId: string): Promise<{ referenceId: string; deleted: boolean }> {
    const reference = this.#repository.getSecretReference(referenceId)
    const locator = { service: reference.keychainService, account: reference.keychainAccount }
    return this.#serialized(locator, async () => {
      const deleted = await this.#keychain.delete(locator)
      this.#repository.deleteSecretReference(referenceId)
      return { referenceId, deleted }
    })
  }

  async readForRuntime(referenceId: string): Promise<string | null> {
    const reference = this.#repository.getSecretReference(referenceId)
    const locator = { service: reference.keychainService, account: reference.keychainAccount }
    return this.#serialized(locator, () => this.#keychain.get(locator))
  }

  async #serialized<T>(
    locator: { service: string; account: string },
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = `${locator.service}\0${locator.account}`
    const previous = this.#operations.get(key) ?? Promise.resolve()
    const task = previous.catch(() => undefined).then(operation)
    const marker = task.then(
      () => undefined,
      () => undefined,
    )
    this.#operations.set(key, marker)
    try {
      return await task
    } finally {
      if (this.#operations.get(key) === marker) this.#operations.delete(key)
    }
  }
}
