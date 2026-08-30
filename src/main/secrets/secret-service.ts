import {
  defaultKeychainService,
  type KeychainAdapter,
} from '../../adapters/keychain/macos-keychain-adapter'
import type {
  ConfigureAgentSecretInput,
  SecretReferenceStatus,
} from '../../shared/secret-reference'
import { StudioCoreError } from '../../core/project-errors'
import type {
  AgentRepository,
  ProviderCredentialBinding,
  ProviderCredentialBindingAuthMethod,
} from '../persistence/agent-repository'

export interface ProviderCredentialBindingStatus {
  binding: ProviderCredentialBinding
  secretConfigured: boolean | null
}

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

  async configureProviderApiKey(input: {
    agentId: string
    projectId: string
    harnessId: ProviderCredentialBinding['harnessId']
    providerId: string
    secret: string
  }): Promise<ProviderCredentialBindingStatus> {
    const link = this.#repository.projectLink(input.agentId)
    if (!link || link.projectId !== input.projectId) {
      throw new StudioCoreError(
        'PROJECT_INVALID',
        '只能为当前 Agent 绑定的 Studio 项目配置 Provider 凭证。',
      )
    }
    // Parse the complete local binding identity before touching Keychain. The lookup is
    // intentionally read-only and validates project, Harness, and Provider identifiers.
    const existingBinding = this.#repository.findProviderCredentialBinding(
      input.projectId,
      input.harnessId,
      input.providerId,
    )
    // Re-entering a Key changes a local fact that is deliberately absent from SQLite,
    // so invalidate any previous model-call evidence before replacing the Keychain value.
    if (existingBinding) this.#repository.clearModelVerifications(existingBinding.id)
    const account = this.#providerAccount(input.projectId, input.harnessId, input.providerId)
    const label = `${input.harnessId} / ${input.providerId} 模型凭证`
    const existingReference = this.#repository
      .listSecretReferences(input.agentId)
      .find(
        (reference) =>
          reference.keychainService === defaultKeychainService &&
          reference.keychainAccount === account,
      )
    const previousSecret = existingReference
      ? await this.readForRuntime(existingReference.id)
      : null
    const reference = await this.configure({
      agentId: input.agentId,
      label,
      keychainAccount: account,
      secret: input.secret,
    })
    try {
      const binding = this.#repository.saveProviderCredentialBinding({
        agentId: input.agentId,
        projectId: input.projectId,
        harnessId: input.harnessId,
        providerId: input.providerId,
        authMethod: 'api-key',
        secretReferenceId: reference.id,
      })
      return { binding, secretConfigured: true }
    } catch (error) {
      if (!existingReference) {
        await this.delete(reference.id).catch(() => undefined)
      } else {
        const locator = {
          service: existingReference.keychainService,
          account: existingReference.keychainAccount,
        }
        await this.#serialized(locator, () =>
          previousSecret === null
            ? this.#keychain.delete(locator).then(() => undefined)
            : this.#keychain.set(locator, previousSecret, existingReference.label),
        )
      }
      throw error
    }
  }

  bindProviderAuthentication(input: {
    agentId: string
    projectId: string
    harnessId: ProviderCredentialBinding['harnessId']
    providerId: string
    authMethod: Exclude<ProviderCredentialBindingAuthMethod, 'api-key'>
  }): ProviderCredentialBindingStatus {
    const binding = this.#repository.saveProviderCredentialBinding({
      ...input,
      secretReferenceId: null,
    })
    return { binding, secretConfigured: null }
  }

  async providerBindingStatus(bindingId: string): Promise<ProviderCredentialBindingStatus> {
    const binding = this.#repository.getProviderCredentialBinding(bindingId)
    if (!binding.secretReferenceId) return { binding, secretConfigured: null }
    const reference = this.#repository.getSecretReference(binding.secretReferenceId)
    const locator = { service: reference.keychainService, account: reference.keychainAccount }
    return {
      binding,
      secretConfigured: await this.#serialized(locator, () => this.#keychain.has(locator)),
    }
  }

  async withProviderCredential<T>(
    expected: {
      bindingId: string
      projectId: string
      harnessId: ProviderCredentialBinding['harnessId']
      providerId: string
    },
    consume: (secret: string) => Promise<T>,
  ): Promise<T> {
    const binding = this.#repository.getProviderCredentialBinding(expected.bindingId)
    if (
      binding.projectId !== expected.projectId ||
      binding.harnessId !== expected.harnessId ||
      binding.providerId !== expected.providerId ||
      binding.authMethod !== 'api-key' ||
      !binding.secretReferenceId
    ) {
      throw new StudioCoreError(
        'HARNESS_AUTHENTICATION_REQUIRED',
        '当前 Provider 凭证绑定与项目模型配置不匹配。',
      )
    }
    const reference = this.#repository.getSecretReference(binding.secretReferenceId)
    if (reference.agentId !== binding.agentId) {
      throw new StudioCoreError('HARNESS_AUTHENTICATION_REQUIRED', 'Provider 凭证绑定已失效。')
    }
    const locator = { service: reference.keychainService, account: reference.keychainAccount }
    return this.#serialized(locator, async () => {
      const secret = await this.#keychain.get(locator)
      if (!secret) {
        throw new StudioCoreError(
          'HARNESS_AUTHENTICATION_REQUIRED',
          '当前 Mac 的钥匙串中缺少该 Provider 凭证。',
        )
      }
      let result: T
      try {
        result = await consume(secret)
      } catch (error) {
        if (this.#containsSecret(error, secret)) {
          throw new StudioCoreError(
            'HARNESS_FAILED',
            'Harness 错误包含凭证原文，诊断已被拒绝跨越受信边界。',
          )
        }
        throw error
      }
      if (this.#containsSecret(result, secret)) {
        throw new StudioCoreError(
          'HARNESS_FAILED',
          'Harness 输出包含凭证原文，结果已拒绝跨越受信边界。',
        )
      }
      return result
    })
  }

  async deleteProviderBinding(
    bindingId: string,
    options: { deleteSecret?: boolean } = {},
  ): Promise<{ bindingId: string; secretDeleted: boolean | null }> {
    const binding = this.#repository.deleteProviderCredentialBinding(bindingId)
    if (!binding.secretReferenceId || !options.deleteSecret) {
      return { bindingId: binding.id, secretDeleted: null }
    }
    const result = await this.delete(binding.secretReferenceId)
    return { bindingId: binding.id, secretDeleted: result.deleted }
  }

  #providerAccount(
    projectId: string,
    harnessId: ProviderCredentialBinding['harnessId'],
    providerId: string,
  ): string {
    const account = `model:${projectId}:${harnessId}:${providerId}`
    return account
  }

  #containsSecret(value: unknown, secret: string, depth = 0): boolean {
    if (depth > 6) return false
    if (typeof value === 'string') return value.includes(secret)
    if (value instanceof Error) {
      return (
        value.message.includes(secret) ||
        (value.cause !== undefined && this.#containsSecret(value.cause, secret, depth + 1))
      )
    }
    if (Array.isArray(value)) {
      return value.some((item) => this.#containsSecret(item, secret, depth + 1))
    }
    if (value && typeof value === 'object') {
      return Object.values(value).some((item) => this.#containsSecret(item, secret, depth + 1))
    }
    return false
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
