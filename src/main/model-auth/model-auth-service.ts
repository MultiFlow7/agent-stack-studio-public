import path from 'node:path'
import { harnessIdFromAdapter } from '../../core/known-harnesses'
import { stableHash, type ProjectModelConfiguration } from '../../core/project-model'
import { StudioCoreError } from '../../core/project-errors'
import {
  KNOWN_HARNESS_MODEL_CATALOG,
  assertSupportedModelSelection,
  buildAgentModelReadiness,
  harnessModelSelectionSchema,
  modelAuthenticationStatusSchema,
  modelVerificationStatusSchema,
  type AgentModelReadiness,
  type HarnessModelSelection,
  type ModelAuthFailure,
  type ModelAuthenticationStatus,
  type ModelVerificationStatus,
} from '../../shared/model-auth'
import type { HarnessId, HarnessProbe } from '../../shared/native-agent'
import type { StudioProjectState } from '../../shared/studio-project'
import type {
  AgentRepository,
  ModelVerificationRecord,
  ProviderCredentialBinding,
} from '../persistence/agent-repository'
import type { SecretService } from '../secrets/secret-service'
import type { HostDriverCredential } from '../../adapters/harness/host-driver'

export type ModelAuthGatewayCredential =
  | { kind: 'api-key'; value: string }
  | { kind: 'harness-login' }

export interface ModelAuthGatewayRequest {
  selection: HarnessModelSelection
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
  credential: ModelAuthGatewayCredential
}

/**
 * Trusted Main-process boundary. Implementations may invoke only fixed Harness adapters.
 * configureAuthentication and authenticationStatus must not perform a billable model call.
 */
export interface ModelAuthGateway {
  probe(harnessId: HarnessId): Promise<HarnessProbe>
  configureAuthentication(input: ModelAuthGatewayRequest): Promise<ModelAuthenticationStatus>
  authenticationStatus(input: ModelAuthGatewayRequest): Promise<ModelAuthenticationStatus>
  verify(input: ModelAuthGatewayRequest): Promise<ModelVerificationStatus>
}

export interface ModelAuthProjectGateway {
  current(): Promise<StudioProjectState>
  updateModelConfiguration(
    configuration: ProjectModelConfiguration,
    expectedRevision: number,
  ): Promise<StudioProjectState>
}

export type ModelAuthConfigureInput =
  | { method: 'api-key'; secret: string; timeoutMs?: number; signal?: AbortSignal }
  | {
      method: 'official-login' | 'existing-login'
      timeoutMs?: number
      signal?: AbortSignal
    }

interface ModelAuthContext {
  state: StudioProjectState
  projectId: string
  agentId: string
  projectPath: string
  selection: HarnessModelSelection | null
}

interface ReadinessOverrides {
  authentication?: ModelAuthenticationStatus | null
  verification?: ModelVerificationStatus
  ignoreOperation?: boolean
}

interface ModelAuthObservation {
  configurationHash: string
  authentication?: ModelAuthenticationStatus | null
  verification?: ModelVerificationStatus
}

const DEFAULT_TIMEOUT_MS = 30_000

export function modelAuthConfigurationHash(selection: HarnessModelSelection): string {
  return stableHash(harnessModelSelectionSchema.parse(selection))
}

export class ModelAuthService {
  readonly #repository: AgentRepository
  readonly #secrets: SecretService
  readonly #projects: ModelAuthProjectGateway
  readonly #gateway: ModelAuthGateway
  readonly #now: () => Date
  readonly #operations = new Map<string, 'configuring' | 'verifying'>()
  readonly #observations = new Map<string, ModelAuthObservation>()

  constructor(options: {
    repository: AgentRepository
    secrets: SecretService
    projects: ModelAuthProjectGateway
    gateway: ModelAuthGateway
    now?: () => Date
  }) {
    this.#repository = options.repository
    this.#secrets = options.secrets
    this.#projects = options.projects
    this.#gateway = options.gateway
    this.#now = options.now ?? (() => new Date())
  }

  catalog(): typeof KNOWN_HARNESS_MODEL_CATALOG {
    return KNOWN_HARNESS_MODEL_CATALOG
  }

  async select(input: {
    selection: HarnessModelSelection
    expectedRevision: number
  }): Promise<AgentModelReadiness> {
    const selection = assertSupportedModelSelection(input.selection)
    const context = await this.#context(false)
    const selectedHarness = this.#selectedHarness(context.state)
    if (selectedHarness !== selection.harnessId) {
      throw new StudioCoreError(
        'HARNESS_NOT_AVAILABLE',
        '模型配置必须属于当前选中的 Native Harness。',
        { suggestedActions: [{ description: '先在 Agent 构建区选择对应 Harness。' }] },
      )
    }
    await this.#projects.updateModelConfiguration(
      {
        providerId: selection.providerId,
        modelId: selection.modelId,
        credentialRequirement: selection.credentialRequirement,
      },
      input.expectedRevision,
    )
    return this.status()
  }

  async configure(input: ModelAuthConfigureInput): Promise<AgentModelReadiness> {
    const context = await this.#context(true)
    const selection = context.selection!
    if (selection.credentialRequirement.method !== input.method) {
      throw new StudioCoreError(
        'HARNESS_AUTHENTICATION_REQUIRED',
        '当前项目的认证需求与配置操作不匹配。',
      )
    }
    this.#assertIdle(context.projectId)
    this.#observations.delete(context.projectId)
    this.#operations.set(context.projectId, 'configuring')
    try {
      let binding: ProviderCredentialBinding
      if (input.method === 'api-key') {
        binding = (
          await this.#secrets.configureProviderApiKey({
            agentId: context.agentId,
            projectId: context.projectId,
            harnessId: selection.harnessId,
            providerId: selection.providerId,
            secret: input.secret,
          })
        ).binding
      } else {
        binding = this.#secrets.bindProviderAuthentication({
          agentId: context.agentId,
          projectId: context.projectId,
          harnessId: selection.harnessId,
          providerId: selection.providerId,
          authMethod: input.method,
        }).binding
        if (input.method === 'official-login') {
          this.#repository.clearModelVerifications(binding.id)
        }
      }
      const authentication = await this.#withCredential(
        context,
        binding,
        input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        input.signal,
        (request) => this.#gateway.configureAuthentication(request),
      )
      this.#assertAuthenticationIdentity(selection, authentication)
      this.#saveAuthentication(binding, selection, authentication)
      this.#observe(context.projectId, selection, { authentication })
      return this.#readiness(context, { authentication, ignoreOperation: true })
    } finally {
      this.#operations.delete(context.projectId)
    }
  }

  async status(): Promise<AgentModelReadiness> {
    const context = await this.#context(false)
    return this.#readiness(context)
  }

  async inspect(
    options: {
      timeoutMs?: number
      signal?: AbortSignal
    } = {},
  ): Promise<AgentModelReadiness> {
    const context = await this.#context(false)
    if (!context.selection) return this.#readiness(context)
    const binding = await this.#usableBinding(context)
    if (!binding) return this.#readiness(context)
    this.#assertIdle(context.projectId)
    this.#operations.set(context.projectId, 'configuring')
    try {
      const authentication = await this.#withCredential(
        context,
        binding,
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        options.signal,
        (request) => this.#gateway.authenticationStatus(request),
      )
      this.#assertAuthenticationIdentity(context.selection, authentication)
      this.#saveAuthentication(binding, context.selection, authentication)
      this.#observe(context.projectId, context.selection, { authentication })
      return this.#readiness(context, { authentication, ignoreOperation: true })
    } finally {
      this.#operations.delete(context.projectId)
    }
  }

  async verify(input: {
    costAcknowledged: boolean
    timeoutMs?: number
    signal?: AbortSignal
  }): Promise<AgentModelReadiness> {
    if (!input.costAcknowledged) {
      throw new StudioCoreError(
        'USAGE_ERROR',
        '验证模型连接可能产生少量 Provider 调用费用，必须由用户主动确认。',
      )
    }
    const inspected = await this.inspect({ timeoutMs: input.timeoutMs, signal: input.signal })
    if (inspected.authentication?.state !== 'credential-valid') return inspected

    const context = await this.#context(true)
    const binding = await this.#usableBinding(context)
    if (!binding) return this.#readiness(context)
    this.#assertIdle(context.projectId)
    this.#operations.set(context.projectId, 'verifying')
    try {
      const verification = modelVerificationStatusSchema.parse(
        await this.#withCredential(
          context,
          binding,
          input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          input.signal,
          (request) => this.#gateway.verify(request),
        ),
      )
      const expectedHash = this.#configurationHash(context.selection!)
      if (verification.configurationHash !== expectedHash) {
        throw new StudioCoreError('HARNESS_FAILED', 'Harness 返回的验证事实与当前模型配置不匹配。')
      }
      this.#saveVerification(binding, verification)
      this.#observe(context.projectId, context.selection!, {
        authentication: inspected.authentication,
        verification,
      })
      return this.#readiness(context, {
        authentication: inspected.authentication,
        verification,
        ignoreOperation: true,
      })
    } finally {
      this.#operations.delete(context.projectId)
    }
  }

  async assertReadyForFreeze(): Promise<AgentModelReadiness> {
    const readiness = await this.status()
    if (readiness.ready) return readiness
    const blocker = readiness.blockers[0]
    throw new StudioCoreError(
      'STACK_INVALID',
      blocker?.message ?? '当前 Agent 尚未完成模型认证与最小调用验证。',
      {
        suggestedActions: blocker ? [{ description: blocker.recoveryAction }] : [],
        details: { modelReadiness: readiness.state },
      },
    )
  }

  async withExecutionCredential<T>(
    input: { projectId: string; selection: HarnessModelSelection },
    operation: (credential: HostDriverCredential) => Promise<T>,
  ): Promise<T> {
    const context = await this.#context(true)
    if (
      context.projectId !== input.projectId ||
      this.#configurationHash(context.selection!) !== this.#configurationHash(input.selection)
    ) {
      throw new StudioCoreError(
        'HARNESS_AUTHENTICATION_REQUIRED',
        '当前 Provider 凭证绑定与执行的模型配置不匹配。',
      )
    }
    const readiness = await this.status()
    if (!readiness.ready) {
      const blocker = readiness.blockers[0]
      throw new StudioCoreError(
        'HARNESS_AUTHENTICATION_REQUIRED',
        blocker?.message ?? 'Agent 尚未完成模型验证。',
        {
          suggestedActions: blocker ? [{ description: blocker.recoveryAction }] : [],
          details: { modelReadiness: readiness.state },
        },
      )
    }
    const binding = await this.#usableBinding(context)
    if (!binding) {
      throw new StudioCoreError(
        'HARNESS_AUTHENTICATION_REQUIRED',
        '当前 Mac 上缺少与模型配置匹配的凭证绑定。',
      )
    }
    if (binding.authMethod !== 'api-key') return operation({ kind: 'harness-login' })
    return this.#secrets.withProviderCredential(
      {
        bindingId: binding.id,
        projectId: context.projectId,
        harnessId: input.selection.harnessId,
        providerId: input.selection.providerId,
      },
      (secret) => operation({ kind: 'api-key', value: secret }),
    )
  }

  async #context(requireSelection: boolean): Promise<ModelAuthContext> {
    const state = await this.#projects.current()
    if (!state.project || !state.projectPath || !state.localAgentId) {
      throw new StudioCoreError('PROJECT_NOT_FOUND', '请先打开并绑定 Studio 项目。')
    }
    const harnessId = this.#selectedHarness(state)
    const selection =
      harnessId && state.project.modelConfiguration
        ? harnessModelSelectionSchema.parse({
            harnessId,
            ...state.project.modelConfiguration,
          })
        : null
    if (requireSelection && !selection) {
      throw new StudioCoreError(
        'HARNESS_AUTHENTICATION_REQUIRED',
        '请先选择 Harness、Provider、模型和认证方式。',
      )
    }
    return {
      state,
      projectId: state.project.id,
      agentId: state.localAgentId,
      projectPath: state.projectPath,
      selection,
    }
  }

  #selectedHarness(state: StudioProjectState): HarnessId | null {
    const project = state.project
    if (!project) return null
    const controller = project.stack.capabilityOwners.find(
      ({ capability }) => capability === 'execution-controller',
    )
    const descriptor = controller
      ? project.components.find(({ id }) => id === controller.componentId)?.descriptor
      : undefined
    return harnessIdFromAdapter(descriptor?.runtimeAdapter ?? null)
  }

  async #usableBinding(context: ModelAuthContext): Promise<ProviderCredentialBinding | null> {
    const selection = context.selection
    if (!selection) return null
    const binding = this.#repository.findProviderCredentialBinding(
      context.projectId,
      selection.harnessId,
      selection.providerId,
    )
    if (!binding || binding.authMethod !== selection.credentialRequirement.method) return null
    if (binding.authMethod === 'api-key') {
      const status = await this.#secrets.providerBindingStatus(binding.id)
      if (!status.secretConfigured) return null
    }
    return binding
  }

  async #readiness(
    context: ModelAuthContext,
    overrides: ReadinessOverrides = {},
  ): Promise<AgentModelReadiness> {
    const selection = context.selection
    const selectedHarness = this.#selectedHarness(context.state)
    let harnessStatus: 'not-selected' | 'not-installed' | 'unsupported-version' | 'ready' =
      selectedHarness ? 'ready' : 'not-selected'
    if (selectedHarness) {
      const probe = await this.#gateway.probe(selectedHarness)
      harnessStatus =
        probe.status === 'not-installed'
          ? 'not-installed'
          : probe.status === 'unsupported-version'
            ? 'unsupported-version'
            : 'ready'
    }

    const binding = selection ? await this.#usableBinding(context) : null
    const persisted =
      selection && binding
        ? this.#repository.getModelVerification(binding.id, this.#configurationHash(selection))
        : null
    const observation = binding ? this.#observation(context.projectId, selection) : null
    let authentication =
      overrides.authentication !== undefined
        ? overrides.authentication
        : observation?.authentication !== undefined
          ? observation.authentication
          : this.#authenticationFromRecord(selection, persisted)
    let verification =
      overrides.verification ?? observation?.verification ?? this.#verificationFromRecord(persisted)

    if (!overrides.ignoreOperation && selection) {
      const operation = this.#operations.get(context.projectId)
      if (operation === 'configuring') {
        authentication = this.#authentication(selection, 'checking', '正在检查本机认证状态。')
      } else if (operation === 'verifying') {
        verification = modelVerificationStatusSchema.parse({
          state: 'verifying',
          configurationHash: this.#configurationHash(selection),
          checkedAt: null,
          failure: null,
        })
      }
    }

    return buildAgentModelReadiness({
      stackCompatible: selectedHarness ? context.state.validation?.status === 'ready' : true,
      harnessStatus,
      configurationState: selection ? 'configured' : 'provider-not-selected',
      configuration: selection
        ? {
            providerId: selection.providerId,
            modelId: selection.modelId,
            credentialRequirement: selection.credentialRequirement,
          }
        : null,
      authentication,
      verification,
    })
  }

  async #withCredential<T>(
    context: ModelAuthContext,
    binding: ProviderCredentialBinding,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    operation: (request: ModelAuthGatewayRequest) => Promise<T>,
  ): Promise<T> {
    const selection = context.selection!
    const base = {
      selection,
      cwd: path.dirname(context.projectPath),
      timeoutMs,
      ...(signal ? { signal } : {}),
    }
    if (binding.authMethod !== 'api-key') {
      return operation({ ...base, credential: { kind: 'harness-login' } })
    }
    return this.#secrets.withProviderCredential(
      {
        bindingId: binding.id,
        projectId: context.projectId,
        harnessId: selection.harnessId,
        providerId: selection.providerId,
      },
      (secret) => operation({ ...base, credential: { kind: 'api-key', value: secret } }),
    )
  }

  #configurationHash(selection: HarnessModelSelection): string {
    return modelAuthConfigurationHash(selection)
  }

  #observe(
    projectId: string,
    selection: HarnessModelSelection,
    observation: Omit<ModelAuthObservation, 'configurationHash'>,
  ): void {
    const configurationHash = this.#configurationHash(selection)
    const previous = this.#observations.get(projectId)
    this.#observations.set(projectId, {
      ...(previous?.configurationHash === configurationHash ? previous : {}),
      ...observation,
      configurationHash,
    })
  }

  #observation(
    projectId: string,
    selection: HarnessModelSelection | null,
  ): ModelAuthObservation | null {
    if (!selection) return null
    const observation = this.#observations.get(projectId)
    return observation?.configurationHash === this.#configurationHash(selection)
      ? observation
      : null
  }

  #assertAuthenticationIdentity(
    selection: HarnessModelSelection,
    rawAuthentication: ModelAuthenticationStatus,
  ): asserts rawAuthentication is ModelAuthenticationStatus {
    const authentication = modelAuthenticationStatusSchema.parse(rawAuthentication)
    if (
      authentication.harnessId !== selection.harnessId ||
      authentication.providerId !== selection.providerId ||
      authentication.authMethod !== selection.credentialRequirement.method
    ) {
      throw new StudioCoreError('HARNESS_FAILED', 'Harness 返回的认证事实与当前模型配置不匹配。')
    }
  }

  #saveAuthentication(
    binding: ProviderCredentialBinding,
    selection: HarnessModelSelection,
    authentication: ModelAuthenticationStatus,
  ): void {
    const status =
      authentication.state === 'credential-valid'
        ? 'credential-valid'
        : authentication.state === 'credential-invalid'
          ? 'credential-invalid'
          : authentication.state === 'credential-expired'
            ? 'credential-expired'
            : authentication.state === 'cancelled'
              ? 'cancelled'
              : null
    if (!status) return
    const configurationHash = this.#configurationHash(selection)
    const existing = this.#repository.getModelVerification(binding.id, configurationHash)
    if (status === 'credential-valid' && existing?.status === 'minimal-call-succeeded') return
    this.#repository.saveModelVerification({
      bindingId: binding.id,
      configurationHash,
      status,
      failureCode: authentication.failure?.code ?? null,
      checkedAt: authentication.checkedAt,
    })
  }

  #saveVerification(
    binding: ProviderCredentialBinding,
    verification: ModelVerificationStatus,
  ): void {
    if (verification.state === 'not-run' || verification.state === 'verifying') return
    this.#repository.saveModelVerification({
      bindingId: binding.id,
      configurationHash: verification.configurationHash!,
      status: verification.state,
      failureCode: verification.failure?.code ?? null,
      checkedAt: verification.checkedAt ?? this.#now().toISOString(),
    })
  }

  #authenticationFromRecord(
    selection: HarnessModelSelection | null,
    record: ModelVerificationRecord | null,
  ): ModelAuthenticationStatus | null {
    if (!selection || !record) return null
    if (record.expiresAt && record.expiresAt <= this.#now().toISOString()) {
      return this.#authentication(
        selection,
        'credential-expired',
        '当前本机凭证验证已过期。',
        this.#failure('credential-expired'),
        record.checkedAt,
      )
    }
    if (record.status === 'credential-invalid' || record.status === 'credential-expired') {
      return this.#authentication(
        selection,
        record.status,
        this.#failure(record.status).message,
        this.#failure(record.status),
        record.checkedAt,
      )
    }
    if (record.status === 'cancelled') {
      return this.#authentication(
        selection,
        'cancelled',
        '上次认证或验证操作已取消。',
        this.#failure('operation-cancelled'),
        record.checkedAt,
      )
    }
    return this.#authentication(
      selection,
      'credential-valid',
      '本机凭证已通过 Harness 检查。',
      null,
      record.checkedAt,
    )
  }

  #verificationFromRecord(record: ModelVerificationRecord | null): ModelVerificationStatus {
    if (!record || record.status === 'credential-valid') {
      return modelVerificationStatusSchema.parse({
        state: 'not-run',
        configurationHash: record?.configurationHash ?? null,
        checkedAt: record?.checkedAt ?? null,
        failure: null,
      })
    }
    const state = record.status
    const failureCode =
      state === 'cancelled'
        ? 'operation-cancelled'
        : state === 'minimal-call-succeeded'
          ? null
          : state
    return modelVerificationStatusSchema.parse({
      state,
      configurationHash: record.configurationHash,
      checkedAt: record.checkedAt,
      failure: failureCode ? this.#failure(failureCode) : null,
    })
  }

  #authentication(
    selection: HarnessModelSelection,
    state: ModelAuthenticationStatus['state'],
    detail: string,
    failure: ModelAuthFailure | null = null,
    checkedAt = this.#now().toISOString(),
  ): ModelAuthenticationStatus {
    return modelAuthenticationStatusSchema.parse({
      harnessId: selection.harnessId,
      providerId: selection.providerId,
      authMethod: selection.credentialRequirement.method,
      state,
      detail,
      checkedAt,
      failure,
    })
  }

  #failure(code: NonNullable<ModelAuthFailure['code']>): ModelAuthFailure {
    const definitions: Record<ModelAuthFailure['code'], Omit<ModelAuthFailure, 'code'>> = {
      'stack-incompatible': {
        message: '当前 Stack 存在兼容性问题。',
        recoveryAction: '先修复 Stack 兼容性问题。',
        retryable: true,
      },
      'harness-not-selected': {
        message: '尚未选择 Harness。',
        recoveryAction: '选择 Native Harness。',
        retryable: true,
      },
      'harness-not-installed': {
        message: 'Harness 未安装。',
        recoveryAction: '安装 Studio 支持的固定版本。',
        retryable: true,
      },
      'harness-version-unsupported': {
        message: 'Harness 版本不受支持。',
        recoveryAction: '切换到 Studio 固定支持的版本。',
        retryable: true,
      },
      'provider-not-selected': {
        message: '尚未选择 Provider。',
        recoveryAction: '选择 Provider。',
        retryable: true,
      },
      'model-not-selected': {
        message: '尚未选择模型。',
        recoveryAction: '选择模型。',
        retryable: true,
      },
      'authentication-required': {
        message: '当前 Provider 尚未认证。',
        recoveryAction: '使用所选认证方式完成配置。',
        retryable: true,
      },
      'verification-required': {
        message: '尚未完成最小模型调用。',
        recoveryAction: '确认费用提示后验证模型连接。',
        retryable: true,
      },
      'credential-invalid': {
        message: 'Provider 拒绝了当前凭证。',
        recoveryAction: '重新输入 API Key 或重新登录。',
        retryable: true,
      },
      'credential-expired': {
        message: '当前凭证已过期。',
        recoveryAction: '更新 API Key 或重新登录。',
        retryable: true,
      },
      'model-forbidden': {
        message: '当前账号无权使用所选模型。',
        recoveryAction: '选择有权限的模型或调整账号权限。',
        retryable: true,
      },
      'network-failed': {
        message: '无法连接模型 Provider。',
        recoveryAction: '检查网络后重试。',
        retryable: true,
      },
      'operation-cancelled': {
        message: '操作已取消。',
        recoveryAction: '准备好后重试。',
        retryable: true,
      },
      'operation-timed-out': {
        message: '操作超时。',
        recoveryAction: '检查网络后重试。',
        retryable: true,
      },
      'secret-leak-detected': {
        message: 'Harness 输出包含凭证原文，已拒绝返回。',
        recoveryAction: '停止使用该 Harness 并更新凭证。',
        retryable: false,
      },
      'harness-failed': {
        message: 'Harness 认证检查失败。',
        recoveryAction: '检查 Harness 后重试。',
        retryable: true,
      },
    }
    return { code, ...definitions[code] }
  }

  #assertIdle(projectId: string): void {
    if (this.#operations.has(projectId)) {
      throw new StudioCoreError('REVISION_CONFLICT', '当前项目已有模型认证操作正在进行。')
    }
  }
}
