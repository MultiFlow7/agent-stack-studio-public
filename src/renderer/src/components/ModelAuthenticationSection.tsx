import {
  ArrowClockwise,
  CheckCircle,
  Key,
  Plug,
  ShieldCheck,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import type {
  AgentModelReadiness,
  HarnessModelCapability,
  ModelAuthFailureCode,
  ModelAuthMethod,
  ModelConfiguration,
} from '../../../shared/model-auth'
import { modelIdSchema } from '../../../shared/model-auth'
import type { ModelAuthView } from '../../../shared/model-auth-ipc'

export type ModelAuthenticationMethod = ModelAuthMethod

export type ModelAuthenticationRecoveryAction =
  | 'resolve-stack'
  | 'select-harness'
  | 'install-supported-harness'
  | 'select-provider'
  | 'select-model'
  | 'configure-api-key'
  | 'launch-official-login'
  | 'reuse-harness-login'
  | 'verify-model'
  | 'retry-model-verification'

export interface ModelAuthenticationOption {
  id: string
  label: string
}

export interface ModelAuthenticationMethodOption {
  id: ModelAuthenticationMethod
  label: string
  description: string
}

export interface ModelAuthenticationReadinessItem {
  id: 'stack' | 'harness' | 'credential' | 'model-call'
  label: string
  status: 'ready' | 'blocked' | 'pending'
  detail: string
  recoveryAction: ModelAuthenticationRecoveryAction | null
}

export interface ModelAuthenticationView {
  harness: { id: string; label: string } | null
  providers: Array<
    ModelAuthenticationOption & {
      models: ModelAuthenticationOption[]
      acceptsCustomModelIds: boolean
      customModelIdHelp: string
    }
  >
  methods: ModelAuthenticationMethodOption[]
  selectedProviderId: string | null
  selectedModelId: string | null
  selectedMethod: ModelAuthenticationMethod | null
  credential: {
    status:
      | 'unconfigured'
      | 'configuring'
      | 'authenticated'
      | 'invalid'
      | 'expired'
      | 'network-failed'
      | 'cancelled'
    detail: string
  }
  verification: {
    status:
      | 'unverified'
      | 'verifying'
      | 'succeeded'
      | 'invalid-credential'
      | 'model-forbidden'
      | 'network-failed'
      | 'cancelled'
    detail: string
  }
  readiness: {
    status: 'ready' | 'blocked'
    items: ModelAuthenticationReadinessItem[]
  }
  failure: { message: string; recoveryAction: ModelAuthenticationRecoveryAction } | null
}

function authRecoveryAction(
  method: ModelAuthenticationMethod | null,
): ModelAuthenticationRecoveryAction {
  if (method === 'official-login') return 'launch-official-login'
  if (method === 'existing-login') return 'reuse-harness-login'
  return 'configure-api-key'
}

function blockerRecoveryAction(
  code: ModelAuthFailureCode,
  method: ModelAuthenticationMethod | null,
): ModelAuthenticationRecoveryAction {
  if (code === 'harness-not-selected') return 'select-harness'
  if (code === 'harness-not-installed' || code === 'harness-version-unsupported') {
    return 'install-supported-harness'
  }
  if (code === 'provider-not-selected') return 'select-provider'
  if (code === 'model-not-selected' || code === 'model-forbidden') return 'select-model'
  if (
    code === 'authentication-required' ||
    code === 'credential-invalid' ||
    code === 'credential-expired'
  ) {
    return authRecoveryAction(method)
  }
  return 'retry-model-verification'
}

const verificationDetails: Record<AgentModelReadiness['verification']['state'], string> = {
  'not-run': '尚未发送最小验证请求。',
  verifying: '正在发送最小请求…',
  'minimal-call-succeeded': '最小模型调用已成功。',
  'credential-invalid': '凭证无效，未完成模型调用。',
  'credential-expired': '凭证已过期，未完成模型调用。',
  'model-forbidden': '当前账号无权访问所选模型。',
  'network-failed': '网络连接失败，可以保留配置后重试。',
  cancelled: '验证已取消，配置未改变。',
}

function modelAuthenticationView(
  capability: HarnessModelCapability | null,
  readiness: AgentModelReadiness,
): ModelAuthenticationView {
  const selectedProvider = capability?.providers.find(
    ({ id }) => id === readiness.configuration?.providerId,
  )
  const method = readiness.configuration?.credentialRequirement.method ?? null
  const authentication = readiness.authentication
  const credentialStatus: ModelAuthenticationView['credential']['status'] =
    authentication?.state === 'checking'
      ? 'configuring'
      : authentication?.state === 'credential-valid'
        ? 'authenticated'
        : authentication?.state === 'credential-invalid'
          ? 'invalid'
          : authentication?.state === 'credential-expired'
            ? 'expired'
            : authentication?.state === 'cancelled'
              ? 'cancelled'
              : authentication?.failure?.code === 'network-failed'
                ? 'network-failed'
                : 'unconfigured'
  const verificationStatus: ModelAuthenticationView['verification']['status'] =
    readiness.verification.state === 'minimal-call-succeeded'
      ? 'succeeded'
      : readiness.verification.state === 'not-run'
        ? 'unverified'
        : readiness.verification.state === 'credential-invalid' ||
            readiness.verification.state === 'credential-expired'
          ? 'invalid-credential'
          : readiness.verification.state
  const failure = readiness.verification.failure ?? authentication?.failure ?? null

  return {
    harness: capability ? { id: capability.harnessId, label: capability.harnessLabel } : null,
    providers:
      capability?.providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        models: provider.models,
        acceptsCustomModelIds: provider.customModelIds.availability === 'available',
        customModelIdHelp: provider.customModelIds.detail,
      })) ?? [],
    methods:
      selectedProvider?.authMethods
        .filter(({ availability }) => availability === 'available')
        .map(({ method: id, label, detail: description }) => ({ id, label, description })) ?? [],
    selectedProviderId: readiness.configuration?.providerId ?? null,
    selectedModelId: readiness.configuration?.modelId ?? null,
    selectedMethod: method,
    credential: {
      status: credentialStatus,
      detail: authentication?.detail ?? '当前 Mac 尚未配置模型认证。',
    },
    verification: {
      status: verificationStatus,
      detail:
        readiness.verification.failure?.message ??
        verificationDetails[readiness.verification.state],
    },
    readiness: {
      status: readiness.ready ? 'ready' : 'blocked',
      items: [
        {
          id: 'stack',
          label: 'Stack 与兼容性',
          status: readiness.stackCompatible ? 'ready' : 'blocked',
          detail: readiness.stackCompatible
            ? '可移植 Stack 与兼容性检查已通过。'
            : '先处理 Stack 或兼容性阻断。',
          recoveryAction: readiness.stackCompatible ? null : 'resolve-stack',
        },
        {
          id: 'harness',
          label: 'Harness 可执行',
          status: readiness.harnessExecutable ? 'ready' : 'blocked',
          detail: readiness.harnessExecutable
            ? `${capability?.harnessLabel ?? 'Harness'} 已安装且版本受支持。`
            : (readiness.blockers.find(({ code }) =>
                [
                  'harness-not-selected',
                  'harness-not-installed',
                  'harness-version-unsupported',
                ].includes(code),
              )?.message ?? '未检测到可执行的受支持 Harness。'),
          recoveryAction: readiness.harnessExecutable
            ? null
            : blockerRecoveryAction(
                readiness.blockers.find(({ code }) => code.startsWith('harness-'))?.code ??
                  'harness-not-selected',
                method,
              ),
        },
        {
          id: 'credential',
          label: '模型认证',
          status:
            authentication?.state === 'credential-valid'
              ? 'ready'
              : authentication?.state === 'checking'
                ? 'pending'
                : 'blocked',
          detail: authentication?.detail ?? '当前 Mac 尚未认证。',
          recoveryAction:
            authentication?.state === 'credential-valid' || authentication?.state === 'checking'
              ? null
              : authRecoveryAction(method),
        },
        {
          id: 'model-call',
          label: '最小模型调用',
          status:
            readiness.verification.state === 'minimal-call-succeeded'
              ? 'ready'
              : readiness.verification.state === 'verifying'
                ? 'pending'
                : 'blocked',
          detail:
            readiness.verification.failure?.message ??
            verificationDetails[readiness.verification.state],
          recoveryAction:
            readiness.verification.state === 'minimal-call-succeeded' ||
            readiness.verification.state === 'verifying'
              ? null
              : readiness.verification.state === 'model-forbidden'
                ? 'select-model'
                : 'verify-model',
        },
      ],
    },
    failure: failure
      ? {
          message: failure.message,
          recoveryAction: blockerRecoveryAction(failure.code, method),
        }
      : null,
  }
}

export interface ModelAuthenticationSectionProps {
  view: ModelAuthenticationView
  pendingAction?:
    | 'selection'
    | 'configure-api-key'
    | 'official-login'
    | 'reuse-login'
    | 'verify'
    | 'cancel'
  onSelectProvider: (providerId: string) => Promise<void>
  onSelectModel: (modelId: string) => Promise<void>
  onSelectMethod: (method: ModelAuthenticationMethod) => Promise<void>
  onConfigureApiKey: () => Promise<void>
  onLaunchOfficialLogin: () => Promise<void>
  onReuseHarnessLogin: () => Promise<void>
  onVerify: () => Promise<void>
  onCancel: () => Promise<void>
  onRecovery: (action: ModelAuthenticationRecoveryAction) => void
}

interface ConnectedModelAuthenticationSectionProps {
  expectedRevision: number
  onProjectChanged: () => Promise<void>
}

function credentialRequirement(method: ModelAuthenticationMethod) {
  return {
    method,
    credentialKind: method === 'api-key' ? ('api-key' as const) : ('harness-session' as const),
  }
}

export function ConnectedModelAuthenticationSection({
  expectedRevision,
  onProjectChanged,
}: ConnectedModelAuthenticationSectionProps) {
  const api = window.studio.modelAuth
  const [ipcView, setIpcView] = useState<ModelAuthView>()
  const [pendingAction, setPendingAction] =
    useState<ModelAuthenticationSectionProps['pendingAction']>()
  const [error, setError] = useState<string>()
  const [errorRecovery, setErrorRecovery] = useState<ModelAuthenticationRecoveryAction>(
    'retry-model-verification',
  )
  const activeVerification = useRef<string | undefined>(undefined)
  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (!api) return
    const request = ++requestId.current
    try {
      const next = await api.status()
      if (request !== requestId.current) return
      setIpcView(next)
      setError(undefined)
    } catch (cause) {
      if (request !== requestId.current) return
      setError(cause instanceof Error ? cause.message : '无法读取模型认证状态。')
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [expectedRevision, load])

  if (!api) return null
  if (!ipcView) {
    return error ? (
      <section className="model-auth-section model-auth-section--load-error">
        <div className="model-auth-failure" role="alert">
          <XCircle aria-hidden="true" size={19} weight="fill" />
          <span>{error}</span>
          <button className="button button--secondary" onClick={() => void load()} type="button">
            重试
          </button>
        </div>
      </section>
    ) : (
      <div className="loading-state" aria-busy="true">
        正在读取模型与认证…
      </div>
    )
  }

  const updateSelection = async (
    configuration: ModelConfiguration,
    recoveryAction: ModelAuthenticationRecoveryAction,
  ): Promise<void> => {
    setPendingAction('selection')
    setError(undefined)
    try {
      const next = await api.select({ expectedRevision, modelConfiguration: configuration })
      setIpcView(next)
      await onProjectChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法更新模型配置。')
      setErrorRecovery(recoveryAction)
    } finally {
      setPendingAction(undefined)
    }
  }

  const selectedProvider = ipcView.capability?.providers.find(
    ({ id }) => id === ipcView.selection?.providerId,
  )
  const projected = modelAuthenticationView(ipcView.capability, ipcView.readiness)
  if (error) {
    projected.failure = { message: error, recoveryAction: errorRecovery }
  }

  const runAction = async (
    pending: Exclude<ModelAuthenticationSectionProps['pendingAction'], undefined>,
    recoveryAction: ModelAuthenticationRecoveryAction,
    action: () => Promise<ModelAuthView>,
  ): Promise<void> => {
    setPendingAction(pending)
    setError(undefined)
    try {
      setIpcView(await action())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型认证操作失败。')
      setErrorRecovery(recoveryAction)
    } finally {
      setPendingAction(undefined)
    }
  }

  const configureApiKey = () =>
    runAction(
      'configure-api-key',
      'configure-api-key',
      async () => (await api.configureApiKey()).view,
    )
  const launchOfficialLogin = () =>
    runAction(
      'official-login',
      'launch-official-login',
      async () => (await api.launchOfficialLogin()).view,
    )
  const refreshAuthentication = () =>
    runAction('reuse-login', 'reuse-harness-login', () => api.refresh())
  const verify = async (): Promise<void> => {
    const verificationRequestId = crypto.randomUUID()
    activeVerification.current = verificationRequestId
    setPendingAction('verify')
    setError(undefined)
    setIpcView((current) =>
      current
        ? {
            ...current,
            readiness: {
              ...current.readiness,
              state: 'verifying',
              ready: false,
              verification: {
                state: 'verifying',
                configurationHash: null,
                checkedAt: null,
                failure: null,
              },
            },
          }
        : current,
    )
    try {
      const result = await api.verify({
        requestId: verificationRequestId,
        costAcknowledged: true,
        timeoutMs: 120_000,
      })
      if (activeVerification.current === verificationRequestId) setIpcView(result.view)
    } catch (cause) {
      if (activeVerification.current === verificationRequestId) {
        setError(cause instanceof Error ? cause.message : '无法验证模型连接。')
        setErrorRecovery('retry-model-verification')
      }
    } finally {
      if (activeVerification.current === verificationRequestId) {
        activeVerification.current = undefined
        setPendingAction(undefined)
      }
    }
  }
  const cancel = async (): Promise<void> => {
    const verificationRequestId = activeVerification.current
    if (!verificationRequestId) return
    setPendingAction('cancel')
    try {
      await api.cancel(verificationRequestId)
      activeVerification.current = undefined
      setIpcView(await api.status())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法取消模型验证。')
      setErrorRecovery('retry-model-verification')
    } finally {
      setPendingAction(undefined)
    }
  }

  const recover = (action: ModelAuthenticationRecoveryAction): void => {
    if (action === 'resolve-stack' || action === 'select-harness') {
      document.getElementById('stack-editor-heading')?.focus()
      return
    }
    if (action === 'select-provider') {
      document.getElementById('model-auth-provider')?.focus()
      return
    }
    if (action === 'select-model') {
      document.getElementById('model-auth-model')?.focus()
      return
    }
    if (action === 'configure-api-key') void configureApiKey()
    else if (action === 'launch-official-login') void launchOfficialLogin()
    else if (action === 'reuse-harness-login') void refreshAuthentication()
    else if (action === 'install-supported-harness') {
      document.getElementById('stack-editor-heading')?.focus()
    } else void verify()
  }

  return (
    <ModelAuthenticationSection
      onCancel={cancel}
      onConfigureApiKey={configureApiKey}
      onLaunchOfficialLogin={launchOfficialLogin}
      onRecovery={recover}
      onReuseHarnessLogin={refreshAuthentication}
      onSelectMethod={(method) => {
        if (!ipcView.selection) return Promise.resolve()
        return updateSelection(
          {
            ...ipcView.selection,
            credentialRequirement: credentialRequirement(method),
          },
          authRecoveryAction(method),
        )
      }}
      onSelectModel={(modelId) => {
        if (!ipcView.selection) return Promise.resolve()
        return updateSelection({ ...ipcView.selection, modelId }, 'select-model')
      }}
      onSelectProvider={(providerId) => {
        const provider = ipcView.capability?.providers.find(({ id }) => id === providerId)
        const method = provider?.authMethods.find(
          ({ availability }) => availability === 'available',
        )?.method
        if (!provider || !method) return Promise.resolve()
        return updateSelection(
          {
            providerId,
            modelId: provider.defaultModelId,
            credentialRequirement: credentialRequirement(method),
          },
          'select-provider',
        )
      }}
      onVerify={verify}
      pendingAction={pendingAction}
      view={{
        ...projected,
        methods:
          selectedProvider?.authMethods
            .filter(({ availability }) => availability === 'available')
            .map(({ method: id, label, detail: description }) => ({
              id,
              label,
              description,
            })) ?? projected.methods,
      }}
    />
  )
}

const recoveryLabels: Record<ModelAuthenticationRecoveryAction, string> = {
  'resolve-stack': '处理 Stack 阻断',
  'select-harness': '选择 Harness',
  'install-supported-harness': '安装受支持版本',
  'select-provider': '选择 Provider',
  'select-model': '选择模型',
  'configure-api-key': '配置 API Key',
  'launch-official-login': '使用官方账号登录',
  'reuse-harness-login': '检查已有登录',
  'verify-model': '验证模型连接',
  'retry-model-verification': '重试验证',
}

function ReadinessIcon({ status }: { status: ModelAuthenticationReadinessItem['status'] }) {
  if (status === 'ready') return <CheckCircle aria-hidden="true" size={18} weight="fill" />
  if (status === 'pending') return <ArrowClockwise aria-hidden="true" size={18} />
  return <WarningCircle aria-hidden="true" size={18} weight="fill" />
}

export function ModelAuthenticationSection({
  view,
  pendingAction,
  onSelectProvider,
  onSelectModel,
  onSelectMethod,
  onConfigureApiKey,
  onLaunchOfficialLogin,
  onReuseHarnessLogin,
  onVerify,
  onCancel,
  onRecovery,
}: ModelAuthenticationSectionProps) {
  const errorNotice = useRef<HTMLDivElement>(null)
  const configureApiKeyButton = useRef<HTMLButtonElement>(null)
  const officialLoginButton = useRef<HTMLButtonElement>(null)
  const reuseLoginButton = useRef<HTMLButtonElement>(null)
  const verifyButton = useRef<HTMLButtonElement>(null)
  const [modelDraft, setModelDraft] = useState(view.selectedModelId ?? '')
  const [modelInputError, setModelInputError] = useState<string>()

  const selectedProvider = useMemo(
    () => view.providers.find(({ id }) => id === view.selectedProviderId) ?? null,
    [view.providers, view.selectedProviderId],
  )
  const busy = Boolean(pendingAction)
  const canVerify = Boolean(
    view.harness &&
      view.selectedProviderId &&
      view.selectedModelId &&
      view.selectedMethod &&
      view.credential.status === 'authenticated' &&
      view.verification.status !== 'verifying',
  )

  useEffect(() => {
    if (!view.failure) return
    const frame = window.requestAnimationFrame(() => errorNotice.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [view.failure])

  useEffect(() => {
    setModelDraft(view.selectedModelId ?? '')
    setModelInputError(undefined)
  }, [view.selectedModelId, view.selectedProviderId])

  const changeProvider = (event: ChangeEvent<HTMLSelectElement>) => {
    void onSelectProvider(event.target.value)
  }

  const applyModel = async (): Promise<void> => {
    if (busy || !selectedProvider) return
    const parsed = modelIdSchema.safeParse(modelDraft)
    if (!parsed.success) {
      setModelInputError(
        '模型 ID 需以字母或数字开头，只能包含字母、数字、点、下划线、冒号、斜杠和连字符。',
      )
      return
    }
    const recommended = selectedProvider.models.some(({ id }) => id === parsed.data)
    if (!recommended && !selectedProvider.acceptsCustomModelIds) {
      setModelInputError('该 Provider 只允许选择 Studio 推荐的模型。')
      return
    }
    setModelInputError(undefined)
    if (parsed.data === view.selectedModelId) return
    await onSelectModel(parsed.data)
  }

  const applyModelFromKeyboard = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void applyModel()
  }

  const runCredentialAction = async (
    action: () => Promise<void>,
    trigger: { current: HTMLButtonElement | null },
  ): Promise<void> => {
    try {
      await action()
    } finally {
      window.requestAnimationFrame(() => trigger.current?.focus())
    }
  }

  const restoreVerifyFocus = (): void => {
    window.requestAnimationFrame(() => verifyButton.current?.focus())
  }

  return (
    <section aria-busy={busy} aria-labelledby="model-auth-heading" className="model-auth-section">
      <header className="model-auth-section__header">
        <div>
          <h2 id="model-auth-heading">模型与认证</h2>
          <p>
            为{view.harness ? ` ${view.harness.label}` : '当前 Harness'}
            选择模型和当前 Mac 的认证方式。密钥原文不会进入 Renderer。
          </p>
        </div>
        <span
          className={`model-auth-overall model-auth-overall--${view.readiness.status}`}
          aria-label={`Agent ${view.readiness.status === 'ready' ? '就绪' : '尚未就绪'}`}
        >
          {view.readiness.status === 'ready' ? (
            <CheckCircle aria-hidden="true" size={17} weight="fill" />
          ) : (
            <WarningCircle aria-hidden="true" size={17} weight="fill" />
          )}
          Agent {view.readiness.status === 'ready' ? '就绪' : '尚未就绪'}
        </span>
      </header>

      {!view.harness ? (
        <div className="model-auth-prerequisite">
          <WarningCircle aria-hidden="true" size={20} weight="fill" />
          <span>
            <strong>先选择 Native Harness</strong>
            <small>选择后，Studio 会显示它真实支持的 Provider 和认证方式。</small>
          </span>
          <button
            className="button button--secondary"
            onClick={() => onRecovery('select-harness')}
            type="button"
          >
            选择 Harness
          </button>
        </div>
      ) : (
        <>
          <div className="model-auth-fields">
            <label className="field" htmlFor="model-auth-provider">
              <span>Provider</span>
              <select
                disabled={busy}
                id="model-auth-provider"
                onChange={changeProvider}
                value={view.selectedProviderId ?? ''}
              >
                <option disabled value="">
                  选择 Provider
                </option>
                {view.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="field model-auth-model-field">
              <label htmlFor="model-auth-model">模型 ID</label>
              <div className="model-auth-model-entry">
                <input
                  aria-describedby={`model-auth-model-help${modelInputError ? ' model-auth-model-error' : ''}`}
                  aria-invalid={modelInputError ? 'true' : undefined}
                  disabled={busy || !selectedProvider}
                  id="model-auth-model"
                  list="model-auth-model-options"
                  onChange={(event) => {
                    setModelDraft(event.target.value)
                    setModelInputError(undefined)
                  }}
                  onKeyDown={applyModelFromKeyboard}
                  placeholder="例如 gpt-5.6-sol"
                  spellCheck={false}
                  type="text"
                  value={modelDraft}
                />
                <button
                  className="button button--secondary"
                  disabled={busy || !selectedProvider || modelDraft.trim() === view.selectedModelId}
                  onClick={() => void applyModel()}
                  type="button"
                >
                  {selectedProvider?.models.some(({ id }) => id === modelDraft.trim())
                    ? '切换模型'
                    : '添加并使用'}
                </button>
              </div>
              <datalist id="model-auth-model-options">
                {(selectedProvider?.models ?? []).map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </datalist>
              <small className="field__help" id="model-auth-model-help">
                {selectedProvider?.customModelIdHelp ?? '先选择 Provider。'}
              </small>
              {modelInputError ? (
                <small className="field__error" id="model-auth-model-error">
                  {modelInputError}
                </small>
              ) : null}
            </div>
          </div>

          <fieldset className="model-auth-methods" disabled={busy}>
            <legend>认证方式</legend>
            {view.methods.map((method) => (
              <label key={method.id}>
                <input
                  checked={view.selectedMethod === method.id}
                  name="model-auth-method"
                  onChange={() => void onSelectMethod(method.id)}
                  type="radio"
                />
                <span>
                  <strong>{method.label}</strong>
                  <small>{method.description}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="model-auth-credential" aria-live="polite">
            <span className="model-auth-credential__icon" aria-hidden="true">
              <Key size={19} />
            </span>
            <span className="model-auth-credential__body">
              <strong>当前 Mac 的认证</strong>
              <small>{view.credential.detail}</small>
            </span>
            <div className="model-auth-credential__actions">
              {view.selectedMethod === 'api-key' ? (
                <button
                  className="button button--secondary"
                  disabled={busy}
                  onClick={() => void runCredentialAction(onConfigureApiKey, configureApiKeyButton)}
                  ref={configureApiKeyButton}
                  type="button"
                >
                  <Key aria-hidden="true" size={16} />
                  {pendingAction === 'configure-api-key'
                    ? '等待 macOS 安全输入…'
                    : view.credential.status === 'authenticated'
                      ? '替换 API Key'
                      : '配置 API Key'}
                </button>
              ) : null}
              {view.selectedMethod === 'official-login' ? (
                <>
                  <button
                    className="button button--secondary"
                    disabled={busy}
                    onClick={() =>
                      void runCredentialAction(onLaunchOfficialLogin, officialLoginButton)
                    }
                    ref={officialLoginButton}
                    type="button"
                  >
                    <ShieldCheck aria-hidden="true" size={16} />
                    {pendingAction === 'official-login' ? '正在打开官方登录…' : '使用官方账号登录'}
                  </button>
                  <button
                    className="button button--quiet"
                    disabled={busy}
                    onClick={() =>
                      void runCredentialAction(onReuseHarnessLogin, officialLoginButton)
                    }
                    type="button"
                  >
                    <ArrowClockwise aria-hidden="true" size={16} />
                    {pendingAction === 'reuse-login' ? '正在检查…' : '检查登录状态'}
                  </button>
                </>
              ) : null}
              {view.selectedMethod === 'existing-login' ? (
                <button
                  className="button button--secondary"
                  disabled={busy}
                  onClick={() => void runCredentialAction(onReuseHarnessLogin, reuseLoginButton)}
                  ref={reuseLoginButton}
                  type="button"
                >
                  <ArrowClockwise aria-hidden="true" size={16} />
                  {pendingAction === 'reuse-login' ? '正在检查…' : '检查已有登录'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="model-auth-verification">
            <span className="model-auth-verification__icon" aria-hidden="true">
              <Plug size={19} />
            </span>
            <span className="model-auth-verification__body">
              <strong>验证模型连接</strong>
              <small>{view.verification.detail}</small>
              <span className="model-auth-cost-notice" id="model-auth-cost-notice">
                验证会发送一条最小请求，可能产生少量模型调用费用。只有点击后才会调用。
              </span>
            </span>
            <div className="model-auth-verification__actions">
              <button
                aria-describedby="model-auth-cost-notice"
                className="button button--primary"
                disabled={!canVerify || busy}
                onClick={() => void onVerify().finally(restoreVerifyFocus)}
                ref={verifyButton}
                type="button"
              >
                <Plug aria-hidden="true" size={16} />
                {pendingAction === 'verify' ? '正在验证…' : '验证模型连接'}
              </button>
              {view.verification.status === 'verifying' ? (
                <button
                  className="button button--secondary"
                  disabled={pendingAction === 'cancel'}
                  onClick={() => void onCancel().finally(restoreVerifyFocus)}
                  type="button"
                >
                  {pendingAction === 'cancel' ? '正在取消…' : '取消验证'}
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}

      {view.failure ? (
        <div className="model-auth-failure" ref={errorNotice} role="alert" tabIndex={-1}>
          <XCircle aria-hidden="true" size={19} weight="fill" />
          <span>{view.failure.message}</span>
          <button
            className="button button--secondary"
            onClick={() => onRecovery(view.failure!.recoveryAction)}
            type="button"
          >
            {recoveryLabels[view.failure.recoveryAction]}
          </button>
        </div>
      ) : null}

      <div className="model-auth-readiness" aria-labelledby="model-auth-readiness-heading">
        <div className="model-auth-readiness__heading">
          <h3 id="model-auth-readiness-heading">
            {view.readiness.status === 'ready' ? 'Agent 就绪' : 'Agent 尚未就绪'}
          </h3>
          <p>冻结前同时检查 Stack、Harness、模型认证和最小模型调用。</p>
        </div>
        <ul>
          {view.readiness.items.map((item) => (
            <li className={`model-auth-readiness__item--${item.status}`} key={item.id}>
              <ReadinessIcon status={item.status} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
              {item.recoveryAction ? (
                <button
                  className="button button--quiet"
                  onClick={() => onRecovery(item.recoveryAction!)}
                  type="button"
                >
                  {recoveryLabels[item.recoveryAction]}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
