import { z } from 'zod'
import { harnessIdSchema } from './native-agent'

export const modelProviderIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,79}$/)

export const modelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)

export const modelAuthMethodSchema = z.enum(['api-key', 'official-login', 'existing-login'])

export const modelConfigurationSchema = z
  .object({
    providerId: modelProviderIdSchema,
    modelId: modelIdSchema,
    credentialRequirement: z
      .object({
        method: modelAuthMethodSchema,
        credentialKind: z.enum(['api-key', 'harness-session']),
      })
      .strict()
      .superRefine((requirement, context) => {
        const expectedKind = requirement.method === 'api-key' ? 'api-key' : 'harness-session'
        if (requirement.credentialKind !== expectedKind) {
          context.addIssue({
            code: 'custom',
            path: ['credentialKind'],
            message: '认证方式与凭证需求不匹配。',
          })
        }
      }),
  })
  .strict()

export const harnessModelSelectionSchema = modelConfigurationSchema
  .extend({
    harnessId: harnessIdSchema,
  })
  .strict()

export const modelAuthFailureCodeSchema = z.enum([
  'stack-incompatible',
  'harness-not-selected',
  'harness-not-installed',
  'harness-version-unsupported',
  'provider-not-selected',
  'model-not-selected',
  'authentication-required',
  'verification-required',
  'credential-invalid',
  'credential-expired',
  'model-forbidden',
  'network-failed',
  'operation-cancelled',
  'operation-timed-out',
  'secret-leak-detected',
  'harness-failed',
])

export const modelAuthFailureSchema = z
  .object({
    code: modelAuthFailureCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    recoveryAction: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict()

export const modelAuthenticationStateSchema = z.enum([
  'not-configured',
  'checking',
  'credential-valid',
  'credential-invalid',
  'credential-expired',
  'cancelled',
  'unavailable',
])

export const modelAuthenticationStatusSchema = z
  .object({
    harnessId: harnessIdSchema,
    providerId: modelProviderIdSchema,
    authMethod: modelAuthMethodSchema,
    state: modelAuthenticationStateSchema,
    detail: z.string().trim().min(1).max(1_000),
    checkedAt: z.iso.datetime(),
    failure: modelAuthFailureSchema.nullable(),
  })
  .strict()

export const modelVerificationStateSchema = z.enum([
  'not-run',
  'verifying',
  'minimal-call-succeeded',
  'credential-invalid',
  'credential-expired',
  'model-forbidden',
  'network-failed',
  'cancelled',
])

export const modelVerificationStatusSchema = z
  .object({
    state: modelVerificationStateSchema,
    configurationHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    checkedAt: z.iso.datetime().nullable(),
    failure: modelAuthFailureSchema.nullable(),
  })
  .strict()

export const modelReadinessBlockerSchema = z
  .object({
    code: modelAuthFailureCodeSchema,
    message: z.string().trim().min(1).max(1_000),
    recoveryAction: z.string().trim().min(1).max(500),
  })
  .strict()

export const agentModelReadinessStateSchema = z.enum([
  'stack-incompatible',
  'harness-not-selected',
  'harness-not-installed',
  'harness-version-unsupported',
  'provider-not-selected',
  'model-not-selected',
  'unauthenticated',
  'configuring',
  'verifying',
  'credential-valid',
  'minimal-call-succeeded',
  'credential-invalid',
  'credential-expired',
  'model-forbidden',
  'network-failed',
  'cancelled',
])

export const agentModelReadinessSchema = z
  .object({
    state: agentModelReadinessStateSchema,
    ready: z.boolean(),
    stackCompatible: z.boolean(),
    harnessExecutable: z.boolean(),
    configuration: modelConfigurationSchema.nullable(),
    authentication: modelAuthenticationStatusSchema.nullable(),
    verification: modelVerificationStatusSchema,
    blockers: z.array(modelReadinessBlockerSchema).max(12),
  })
  .strict()
  .superRefine((readiness, context) => {
    const factsReady =
      readiness.stackCompatible &&
      readiness.harnessExecutable &&
      readiness.configuration !== null &&
      readiness.authentication?.state === 'credential-valid' &&
      readiness.verification.state === 'minimal-call-succeeded'
    if (readiness.ready !== factsReady) {
      context.addIssue({
        code: 'custom',
        path: ['ready'],
        message: 'Agent 模型就绪必须同时满足兼容性、Harness、配置、认证和最小调用事实。',
      })
    }
    if (readiness.ready && readiness.state !== 'minimal-call-succeeded') {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Agent 模型就绪状态必须是 minimal-call-succeeded。',
      })
    }
  })

export const buildAgentModelReadinessInputSchema = z
  .object({
    stackCompatible: z.boolean(),
    harnessStatus: z.enum(['not-selected', 'not-installed', 'unsupported-version', 'ready']),
    configurationState: z.enum(['provider-not-selected', 'model-not-selected', 'configured']),
    configuration: modelConfigurationSchema.nullable(),
    authentication: modelAuthenticationStatusSchema.nullable(),
    verification: modelVerificationStatusSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.configurationState === 'configured') !== (input.configuration !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['configuration'],
        message: '配置选择状态与 modelConfiguration 事实不一致。',
      })
    }
  })

export const modelCapabilityAvailabilitySchema = z.enum(['available', 'unavailable'])

export const modelAuthMethodCapabilitySchema = z
  .object({
    method: modelAuthMethodSchema,
    label: z.string().trim().min(1).max(120),
    availability: modelCapabilityAvailabilitySchema,
    detail: z.string().trim().min(1).max(500),
  })
  .strict()

export const modelCapabilitySchema = z
  .object({
    id: modelIdSchema,
    label: z.string().trim().min(1).max(160),
  })
  .strict()

export const customModelIdCapabilitySchema = z
  .object({
    availability: modelCapabilityAvailabilitySchema,
    detail: z.string().trim().min(1).max(500),
  })
  .strict()

export const modelProviderCapabilitySchema = z
  .object({
    id: modelProviderIdSchema,
    label: z.string().trim().min(1).max(120),
    models: z.array(modelCapabilitySchema).min(1).max(20),
    defaultModelId: modelIdSchema,
    customModelIds: customModelIdCapabilitySchema,
    authMethods: z.array(modelAuthMethodCapabilitySchema).min(1).max(3),
  })
  .strict()
  .superRefine((provider, context) => {
    if (!provider.models.some(({ id }) => id === provider.defaultModelId)) {
      context.addIssue({
        code: 'custom',
        path: ['defaultModelId'],
        message: '默认模型必须存在于 Provider allowlist。',
      })
    }
    if (new Set(provider.models.map(({ id }) => id)).size !== provider.models.length) {
      context.addIssue({ code: 'custom', path: ['models'], message: '模型 ID 不得重复。' })
    }
    if (
      new Set(provider.authMethods.map(({ method }) => method)).size !== provider.authMethods.length
    ) {
      context.addIssue({ code: 'custom', path: ['authMethods'], message: '认证方式不得重复。' })
    }
  })

export const harnessModelCapabilitySchema = z
  .object({
    harnessId: harnessIdSchema,
    harnessLabel: z.string().trim().min(1).max(120),
    requiredVersion: z.string().trim().min(1).max(80),
    providers: z.array(modelProviderCapabilitySchema).min(1).max(12),
  })
  .strict()
  .superRefine((harness, context) => {
    if (new Set(harness.providers.map(({ id }) => id)).size !== harness.providers.length) {
      context.addIssue({ code: 'custom', path: ['providers'], message: 'Provider ID 不得重复。' })
    }
  })

export const harnessModelCatalogSchema = z.array(harnessModelCapabilitySchema).length(3)

export const KNOWN_HARNESS_MODEL_CATALOG = harnessModelCatalogSchema.parse([
  {
    harnessId: 'pi',
    harnessLabel: 'Pi',
    requiredVersion: '0.84.2',
    providers: [
      {
        id: 'openai',
        label: 'OpenAI API',
        defaultModelId: 'gpt-5.1',
        models: [
          { id: 'gpt-5.1', label: 'GPT-5.1' },
          { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
        ],
        customModelIds: {
          availability: 'available',
          detail: '可输入 Pi 与 OpenAI Provider 接受的完整模型 ID。',
        },
        authMethods: [
          {
            method: 'api-key',
            label: 'API Key',
            availability: 'available',
            detail: '通过 macOS Keychain 保存，并只注入一次 Pi 子进程。',
          },
          {
            method: 'existing-login',
            label: '复用 Pi 登录',
            availability: 'available',
            detail: '通过 Pi 官方 auth check 读取脱敏状态，不读取凭证原文。',
          },
        ],
      },
      {
        id: 'anthropic',
        label: 'Anthropic',
        defaultModelId: 'claude-sonnet-4-5',
        models: [
          { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
          { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
        ],
        customModelIds: {
          availability: 'available',
          detail: '可输入 Pi 与 Anthropic Provider 接受的完整模型 ID。',
        },
        authMethods: [
          {
            method: 'api-key',
            label: 'API Key',
            availability: 'available',
            detail: '通过 macOS Keychain 保存，并只注入一次 Pi 子进程。',
          },
          {
            method: 'existing-login',
            label: '复用 Pi 登录',
            availability: 'available',
            detail: '通过 Pi 官方 auth check 读取脱敏状态，不读取凭证原文。',
          },
        ],
      },
    ],
  },
  {
    harnessId: 'openclaw',
    harnessLabel: 'OpenClaw',
    requiredVersion: '>=2026.1.30',
    providers: [
      {
        id: 'openai-codex',
        label: 'OpenAI Codex',
        defaultModelId: 'gpt-5.1-codex',
        models: [
          { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
          { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
        ],
        customModelIds: {
          availability: 'available',
          detail: '可输入 OpenClaw Provider 接受的完整模型 ID。',
        },
        authMethods: [
          {
            method: 'official-login',
            label: 'OpenAI Codex 官方登录',
            availability: 'available',
            detail: 'Studio 启动固定的 OpenClaw 官方登录入口，token 仍由 OpenClaw 管理。',
          },
          {
            method: 'existing-login',
            label: '复用 OpenClaw 登录',
            availability: 'available',
            detail: '通过 OpenClaw models status 的结构化输出检查本机状态。',
          },
        ],
      },
    ],
  },
  {
    harnessId: 'codex',
    harnessLabel: 'Codex CLI',
    requiredVersion: '0.148.0-alpha.9',
    providers: [
      {
        id: 'openai',
        label: 'OpenAI（Codex）',
        defaultModelId: 'gpt-5.6-terra',
        models: [
          { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
          { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
          { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
          { id: 'gpt-5.5', label: 'GPT-5.5' },
          { id: 'gpt-5.4', label: 'GPT-5.4' },
        ],
        customModelIds: {
          availability: 'available',
          detail: '可输入 Codex CLI 接受的完整模型 ID。',
        },
        authMethods: [
          {
            method: 'official-login',
            label: 'ChatGPT 官方登录',
            availability: 'available',
            detail: 'Studio 只启动 codex login；第三方 token 由 Codex 自己管理。',
          },
          {
            method: 'existing-login',
            label: '复用 Codex 登录',
            availability: 'available',
            detail: '通过 codex login status 检查，不读取 Codex auth 文件。',
          },
        ],
      },
    ],
  },
])

export function harnessModelCapability(
  harnessId: z.infer<typeof harnessIdSchema>,
): HarnessModelCapability {
  return KNOWN_HARNESS_MODEL_CATALOG.find((capability) => capability.harnessId === harnessId)!
}

export function assertSupportedModelSelection(rawSelection: unknown): HarnessModelSelection {
  const selection = harnessModelSelectionSchema.parse(rawSelection)
  const harness = harnessModelCapability(selection.harnessId)
  const provider = harness.providers.find(({ id }) => id === selection.providerId)
  if (!provider)
    throw new Error(`${harness.harnessLabel} 不支持 Provider ${selection.providerId}。`)
  if (
    !provider.models.some(({ id }) => id === selection.modelId) &&
    provider.customModelIds.availability !== 'available'
  ) {
    throw new Error(`${provider.label} 不支持模型 ${selection.modelId}。`)
  }
  const authMethod = provider.authMethods.find(
    ({ method }) => method === selection.credentialRequirement.method,
  )
  if (!authMethod || authMethod.availability !== 'available') {
    throw new Error(`${provider.label} 不支持所选认证方式。`)
  }
  return selection
}

function readinessBlocker(
  code: z.infer<typeof modelAuthFailureCodeSchema>,
  message: string,
  recoveryAction: string,
) {
  return modelReadinessBlockerSchema.parse({ code, message, recoveryAction })
}

export function buildAgentModelReadiness(
  rawInput: z.input<typeof buildAgentModelReadinessInputSchema>,
): z.infer<typeof agentModelReadinessSchema> {
  const input = buildAgentModelReadinessInputSchema.parse(rawInput)
  const finish = (
    state: z.infer<typeof agentModelReadinessStateSchema>,
    blockers: Array<z.infer<typeof modelReadinessBlockerSchema>>,
  ) =>
    agentModelReadinessSchema.parse({
      state,
      ready: state === 'minimal-call-succeeded',
      stackCompatible: input.stackCompatible,
      harnessExecutable: input.harnessStatus === 'ready',
      configuration: input.configuration,
      authentication: input.authentication,
      verification: input.verification,
      blockers,
    })

  if (!input.stackCompatible) {
    return finish('stack-incompatible', [
      readinessBlocker(
        'stack-incompatible',
        '当前 Stack 存在兼容性问题。',
        '先修复 Stack 兼容性问题，再验证模型连接。',
      ),
    ])
  }
  if (input.harnessStatus === 'not-selected') {
    return finish('harness-not-selected', [
      readinessBlocker(
        'harness-not-selected',
        '尚未选择 Native Harness。',
        '选择 Pi、OpenClaw 或 Codex。',
      ),
    ])
  }
  if (input.harnessStatus === 'not-installed') {
    return finish('harness-not-installed', [
      readinessBlocker(
        'harness-not-installed',
        '所选 Native Harness 尚未安装。',
        '安装 Studio 支持的固定 Harness 版本。',
      ),
    ])
  }
  if (input.harnessStatus === 'unsupported-version') {
    return finish('harness-version-unsupported', [
      readinessBlocker(
        'harness-version-unsupported',
        '所选 Native Harness 版本不受支持。',
        '切换到 Studio 固定支持的 Harness 版本。',
      ),
    ])
  }
  if (input.configurationState === 'provider-not-selected') {
    return finish('provider-not-selected', [
      readinessBlocker('provider-not-selected', '尚未选择模型 Provider。', '选择一个 Provider。'),
    ])
  }
  if (input.configurationState === 'model-not-selected') {
    return finish('model-not-selected', [
      readinessBlocker('model-not-selected', '尚未选择模型。', '选择一个允许的模型。'),
    ])
  }
  if (!input.authentication || input.authentication.state === 'not-configured') {
    return finish('unauthenticated', [
      readinessBlocker(
        'authentication-required',
        '当前 Provider 尚未认证。',
        '使用所选认证方式完成配置。',
      ),
    ])
  }
  if (input.authentication.state === 'checking') return finish('configuring', [])
  if (input.authentication.state === 'credential-invalid') {
    const failure = input.authentication.failure
    return finish('credential-invalid', [
      readinessBlocker(
        'credential-invalid',
        failure?.message ?? 'Provider 拒绝了当前凭证。',
        failure?.recoveryAction ?? '重新输入 API Key 或重新登录。',
      ),
    ])
  }
  if (input.authentication.state === 'credential-expired') {
    const failure = input.authentication.failure
    return finish('credential-expired', [
      readinessBlocker(
        'credential-expired',
        failure?.message ?? '当前凭证已过期。',
        failure?.recoveryAction ?? '重新登录或更新 API Key。',
      ),
    ])
  }
  if (input.authentication.state === 'cancelled') {
    return finish('cancelled', [
      readinessBlocker('operation-cancelled', '认证操作已取消。', '准备好后可重新配置。'),
    ])
  }
  if (input.authentication.state === 'unavailable') {
    return finish('unauthenticated', [
      readinessBlocker(
        'authentication-required',
        '所选认证方式当前不可用。',
        '选择该 Harness 已证实支持的认证方式。',
      ),
    ])
  }
  if (input.verification.state === 'not-run') {
    return finish('credential-valid', [
      readinessBlocker(
        'verification-required',
        '凭证已配置，但尚未完成最小模型调用。',
        '阅读费用提示后，主动点击“验证模型连接”。',
      ),
    ])
  }
  if (input.verification.state === 'verifying') return finish('verifying', [])
  if (input.verification.state === 'minimal-call-succeeded') {
    return finish('minimal-call-succeeded', [])
  }
  const verificationFailure = input.verification.failure
  const defaults = {
    'credential-invalid': {
      message: 'Provider 拒绝了当前凭证。',
      recoveryAction: '重新输入 API Key 或重新登录。',
    },
    'credential-expired': {
      message: '当前凭证已过期。',
      recoveryAction: '重新登录或更新 API Key。',
    },
    'model-forbidden': {
      message: '当前账号无权使用所选模型。',
      recoveryAction: '选择有权限的模型，或调整 Provider 账号权限。',
    },
    'network-failed': {
      message: '无法连接模型 Provider。',
      recoveryAction: '检查网络后重试验证。',
    },
    cancelled: {
      message: '模型验证已取消。',
      recoveryAction: '准备好后重新验证。',
    },
  } as const
  const failureCode =
    input.verification.state === 'cancelled'
      ? ('operation-cancelled' as const)
      : input.verification.state
  const fallback = defaults[input.verification.state]
  return finish(input.verification.state, [
    readinessBlocker(
      failureCode,
      verificationFailure?.message ?? fallback.message,
      verificationFailure?.recoveryAction ?? fallback.recoveryAction,
    ),
  ])
}

export type ModelAuthMethod = z.infer<typeof modelAuthMethodSchema>
export type ModelConfiguration = z.infer<typeof modelConfigurationSchema>
export type HarnessModelSelection = z.infer<typeof harnessModelSelectionSchema>
export type BuildAgentModelReadinessInput = z.infer<typeof buildAgentModelReadinessInputSchema>
export type ModelAuthFailureCode = z.infer<typeof modelAuthFailureCodeSchema>
export type ModelAuthFailure = z.infer<typeof modelAuthFailureSchema>
export type ModelAuthenticationStatus = z.infer<typeof modelAuthenticationStatusSchema>
export type ModelVerificationStatus = z.infer<typeof modelVerificationStatusSchema>
export type AgentModelReadiness = z.infer<typeof agentModelReadinessSchema>
export type ModelProviderCapability = z.infer<typeof modelProviderCapabilitySchema>
export type HarnessModelCapability = z.infer<typeof harnessModelCapabilitySchema>
