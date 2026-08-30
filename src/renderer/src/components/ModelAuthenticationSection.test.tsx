import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { harnessModelCapability } from '../../../shared/model-auth'
import type { StudioApi } from '../../../shared/ipc'
import {
  modelAuthViewSchema,
  type ModelAuthVerifyInput,
  type ModelAuthView,
} from '../../../shared/model-auth-ipc'
import {
  ConnectedModelAuthenticationSection,
  ModelAuthenticationSection,
  type ModelAuthenticationView,
} from './ModelAuthenticationSection'

function view(overrides: Partial<ModelAuthenticationView> = {}): ModelAuthenticationView {
  return {
    harness: { id: 'pi', label: 'Pi' },
    providers: [
      {
        id: 'openai',
        label: 'OpenAI',
        models: [
          { id: 'gpt-5', label: 'GPT-5' },
          { id: 'gpt-5-mini', label: 'GPT-5 mini' },
        ],
        acceptsCustomModelIds: true,
        customModelIdHelp: '可输入 Pi 与 OpenAI Provider 接受的完整模型 ID。',
      },
    ],
    methods: [
      {
        id: 'api-key',
        label: 'API Key',
        description: '使用 macOS 安全输入并保存到钥匙串。',
      },
      {
        id: 'existing-login',
        label: '复用已有 Harness 登录状态',
        description: '只检查 Harness 当前登录，不读取 token。',
      },
    ],
    selectedProviderId: 'openai',
    selectedModelId: 'gpt-5',
    selectedMethod: 'api-key',
    credential: { status: 'unconfigured', detail: '当前 Mac 尚未配置 API Key。' },
    verification: { status: 'unverified', detail: '尚未发送最小验证请求。' },
    readiness: {
      status: 'blocked',
      items: [
        {
          id: 'stack',
          label: 'Stack 与兼容性',
          status: 'ready',
          detail: '已通过。',
          recoveryAction: null,
        },
        {
          id: 'harness',
          label: 'Harness 可执行',
          status: 'ready',
          detail: 'Pi 0.84.2 可执行。',
          recoveryAction: null,
        },
        {
          id: 'credential',
          label: '模型认证',
          status: 'blocked',
          detail: '当前 Mac 尚未认证。',
          recoveryAction: 'configure-api-key',
        },
        {
          id: 'model-call',
          label: '最小模型调用',
          status: 'blocked',
          detail: '尚未验证。',
          recoveryAction: 'verify-model',
        },
      ],
    },
    failure: null,
    ...overrides,
  }
}

function handlers() {
  return {
    onSelectProvider: vi.fn(() => Promise.resolve()),
    onSelectModel: vi.fn(() => Promise.resolve()),
    onSelectMethod: vi.fn(() => Promise.resolve()),
    onConfigureApiKey: vi.fn(() => Promise.resolve()),
    onLaunchOfficialLogin: vi.fn(() => Promise.resolve()),
    onReuseHarnessLogin: vi.fn(() => Promise.resolve()),
    onVerify: vi.fn(() => Promise.resolve()),
    onCancel: vi.fn(() => Promise.resolve()),
    onRecovery: vi.fn(),
  }
}

function connectedView(
  verification: ModelAuthView['readiness']['verification'] = {
    state: 'not-run',
    configurationHash: null,
    checkedAt: null,
    failure: null,
  },
): ModelAuthView {
  const configuration = {
    providerId: 'openai',
    modelId: 'gpt-5.5',
    credentialRequirement: { method: 'api-key' as const, credentialKind: 'api-key' as const },
  }
  return modelAuthViewSchema.parse({
    harness: { id: 'pi', label: 'Pi' },
    capability: harnessModelCapability('pi'),
    probe: null,
    selection: configuration,
    readiness: {
      state:
        verification.state === 'verifying'
          ? 'verifying'
          : verification.state === 'cancelled'
            ? 'cancelled'
            : 'credential-valid',
      ready: false,
      stackCompatible: true,
      harnessExecutable: true,
      configuration,
      authentication: {
        harnessId: 'pi',
        providerId: 'openai',
        authMethod: 'api-key',
        state: 'credential-valid',
        detail: 'API Key 有效。',
        checkedAt: '2026-08-26T04:00:00.000Z',
        failure: null,
      },
      verification,
      blockers: [
        {
          code: 'verification-required',
          message: '尚未验证模型连接。',
          recoveryAction: '主动验证模型连接。',
        },
      ],
    },
  })
}

describe('ModelAuthenticationSection', () => {
  it('connects selection and native API Key configuration without a Renderer secret value', async () => {
    const initial = connectedView()
    const select = vi.fn(() => Promise.resolve(initial))
    const configureApiKey = vi.fn(() =>
      Promise.resolve({ status: 'completed' as const, view: initial }),
    )
    window.studio = {
      modelAuth: {
        status: vi.fn(() => Promise.resolve(initial)),
        select,
        configureApiKey,
        launchOfficialLogin: vi.fn(),
        refresh: vi.fn(() => Promise.resolve(initial)),
        verify: vi.fn(),
        cancel: vi.fn(),
      },
    } as unknown as StudioApi
    const onProjectChanged = vi.fn(() => Promise.resolve())
    const user = userEvent.setup()
    render(
      <ConnectedModelAuthenticationSection
        expectedRevision={12}
        onProjectChanged={onProjectChanged}
      />,
    )

    const providerSelect = await screen.findByLabelText('Provider')
    expect(screen.getByRole('radio', { name: /API Key/ })).toBeVisible()
    expect(screen.getByRole('radio', { name: /Pi 登录/ })).toBeVisible()
    expect(screen.queryByRole('radio', { name: /官方登录/ })).not.toBeInTheDocument()

    const modelInput = screen.getByLabelText('模型 ID')
    await user.clear(modelInput)
    await user.type(modelInput, 'gpt-5.6-sol{Enter}')
    expect(select).toHaveBeenCalledWith({
      expectedRevision: 12,
      modelConfiguration: {
        providerId: 'openai',
        modelId: 'gpt-5.6-sol',
        credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
      },
    })
    await waitFor(() => expect(onProjectChanged).toHaveBeenCalledTimes(1))
    select.mockClear()
    onProjectChanged.mockClear()

    await user.selectOptions(providerSelect, 'anthropic')
    expect(select).toHaveBeenCalledWith({
      expectedRevision: 12,
      modelConfiguration: {
        providerId: 'anthropic',
        modelId: harnessModelCapability('pi').providers.find(({ id }) => id === 'anthropic')!
          .defaultModelId,
        credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
      },
    })
    await waitFor(() => expect(onProjectChanged).toHaveBeenCalledTimes(1))

    const credentialRegion = document.querySelector<HTMLElement>('.model-auth-credential')!
    await user.click(within(credentialRegion).getByRole('button', { name: /API Key/ }))
    expect(configureApiKey).toHaveBeenCalledWith()
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })

  it('acknowledges cost only on explicit verify and cancels the same request id', async () => {
    const initial = connectedView()
    let finishVerification:
      | ((result: { status: 'completed'; view: ModelAuthView }) => void)
      | undefined
    const verify = vi.fn(
      (input: ModelAuthVerifyInput) =>
        new Promise<{ status: 'completed'; view: ModelAuthView }>((resolve) => {
          void input
          finishVerification = resolve
        }),
    )
    const cancelled = connectedView({
      state: 'cancelled',
      configurationHash: null,
      checkedAt: '2026-08-26T04:01:00.000Z',
      failure: null,
    })
    const cancel = vi.fn(() => Promise.resolve({ cancelled: true }))
    window.studio = {
      modelAuth: {
        status: vi.fn(() => Promise.resolve(cancelled)),
        select: vi.fn(),
        configureApiKey: vi.fn(),
        launchOfficialLogin: vi.fn(),
        refresh: vi.fn(),
        verify,
        cancel,
      },
    } as unknown as StudioApi
    const user = userEvent.setup()
    render(<ConnectedModelAuthenticationSection expectedRevision={12} onProjectChanged={vi.fn()} />)

    expect(verify).not.toHaveBeenCalled()
    const verificationRegion = await waitFor(() => {
      const region = document.querySelector<HTMLElement>('.model-auth-verification')
      expect(region).not.toBeNull()
      return region!
    })
    await user.click(within(verificationRegion).getByRole('button', { name: '验证模型连接' }))
    const verifyInput = verify.mock.calls[0]?.[0]
    expect(verifyInput).toMatchObject({ costAcknowledged: true, timeoutMs: 120_000 })
    expect(verifyInput?.requestId).toMatch(/^[0-9a-f-]{36}$/)
    const requestId = verifyInput?.requestId
    await user.click(await screen.findByRole('button', { name: '取消验证' }))
    expect(cancel).toHaveBeenCalledWith(requestId)
    finishVerification?.({ status: 'completed', view: initial })
  })

  it('shows only supported authentication methods and never accepts a secret in Renderer', async () => {
    const callbacks = handlers()
    const user = userEvent.setup()
    render(<ModelAuthenticationSection view={view()} {...callbacks} />)

    expect(screen.getByRole('heading', { name: '模型与认证' })).toBeVisible()
    expect(screen.getByRole('radio', { name: /API Key/ })).toBeVisible()
    expect(screen.getByRole('radio', { name: /复用已有 Harness 登录状态/ })).toBeVisible()
    expect(screen.queryByRole('radio', { name: /官方账号登录/ })).not.toBeInTheDocument()
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByLabelText(/密钥原文/)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Provider'), 'openai')
    const modelInput = screen.getByLabelText('模型 ID')
    await user.clear(modelInput)
    await user.type(modelInput, 'gpt-5-mini{Enter}')
    expect(callbacks.onSelectProvider).toHaveBeenCalledWith('openai')
    expect(callbacks.onSelectModel).toHaveBeenCalledWith('gpt-5-mini')

    await user.clear(modelInput)
    await user.type(modelInput, 'gpt 5.6 sol{Enter}')
    expect(screen.getByText(/模型 ID 需以字母或数字开头/)).toBeVisible()

    const credentialRegion = document.querySelector<HTMLElement>('.model-auth-credential')
    expect(credentialRegion).not.toBeNull()
    const configure = within(credentialRegion!).getByRole('button', {
      name: '配置 API Key',
    })
    configure.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(callbacks.onConfigureApiKey).toHaveBeenCalledTimes(1))
    expect(configure).toHaveFocus()
  })

  it('discloses model cost before an explicit verification and keeps cancellation keyboard-safe', async () => {
    const callbacks = handlers()
    const verifying = view({
      credential: { status: 'authenticated', detail: 'API Key 已保存到当前 Mac。' },
      verification: { status: 'verifying', detail: '正在发送最小请求…' },
    })
    const user = userEvent.setup()
    const { rerender } = render(<ModelAuthenticationSection view={view()} {...callbacks} />)

    expect(screen.getByText(/可能产生少量模型调用费用。只有点击后才会调用/)).toBeVisible()
    expect(callbacks.onVerify).not.toHaveBeenCalled()

    rerender(<ModelAuthenticationSection pendingAction="verify" view={verifying} {...callbacks} />)
    expect(screen.getByRole('button', { name: '正在验证…' })).toBeDisabled()
    const cancel = screen.getByRole('button', { name: '取消验证' })
    cancel.focus()
    await user.keyboard('{Enter}')
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
    rerender(
      <ModelAuthenticationSection
        view={{
          ...verifying,
          verification: { status: 'cancelled', detail: '已取消，配置未改变。' },
        }}
        {...callbacks}
      />,
    )
    const verificationRegion = document.querySelector<HTMLElement>('.model-auth-verification')
    expect(verificationRegion).not.toBeNull()
    await waitFor(() =>
      expect(
        within(verificationRegion!).getByRole('button', { name: '验证模型连接' }),
      ).toHaveFocus(),
    )
  })

  it('focuses a fact-specific failure and exposes the matching recovery action', async () => {
    const callbacks = handlers()
    const user = userEvent.setup()
    render(
      <ModelAuthenticationSection
        view={view({
          failure: {
            message: '当前账号无权使用 GPT-5。选择其他模型后重试。',
            recoveryAction: 'select-model',
          },
          verification: {
            status: 'model-forbidden',
            detail: '当前账号无权使用所选模型。',
          },
        })}
        {...callbacks}
      />,
    )

    const alert = screen.getByRole('alert')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(alert).toHaveTextContent('当前账号无权使用 GPT-5')
    const recovery = screen.getByRole('button', { name: '选择模型' })
    recovery.focus()
    await user.keyboard('{Enter}')
    expect(callbacks.onRecovery).toHaveBeenCalledWith('select-model')
    expect(screen.getByRole('heading', { name: 'Agent 尚未就绪' })).toBeVisible()
  })
})
