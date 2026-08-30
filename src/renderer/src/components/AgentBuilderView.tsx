import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Circle,
  FloppyDisk,
  Key,
  MagnifyingGlass,
  Plus,
  SpinnerGap,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentProfile } from '../../../shared/agent-profile'
import {
  agentSetupSteps,
  emptyAgentSetupProfile,
  type AgentSetupStep,
  type AgentSetupView,
} from '../../../shared/agent-setup'
import {
  harnessModelCapability,
  type HarnessModelSelection,
  type ModelAuthMethod,
} from '../../../shared/model-auth'
import type { HarnessId } from '../../../shared/native-agent'
import type { SetupCapabilityItem } from '../../../shared/setup-capability'
import { McpServerEditor } from './McpServerEditor'

const stepCopy: Record<AgentSetupStep, { index: string; label: string; description: string }> = {
  basics: { index: '01', label: '基本信息', description: '名称与用途' },
  harness: { index: '02', label: 'Harness', description: '选择本机执行入口' },
  model: { index: '03', label: '模型', description: 'Provider、认证与验证' },
  capabilities: { index: '04', label: '能力（可选增强）', description: '从目录选择或新建内容' },
  review: { index: '05', label: '完成检查', description: '核对创建门槛' },
}

const harnessStatusCopy = {
  ready: '可用',
  'authentication-required': '可用，待认证',
  'not-installed': '未安装',
  'unsupported-version': '版本不受支持',
} as const

const authStateCopy = {
  'not-configured': '尚未认证',
  checking: '正在检查',
  'credential-valid': '认证有效',
  'credential-invalid': '凭证无效',
  'credential-expired': '认证已过期',
  cancelled: '检查已取消',
  unavailable: '认证状态不可用',
} as const

const capabilityKindCopy: Record<SetupCapabilityItem['kind'], string> = {
  prompt: 'Prompt',
  memory: 'Memory',
  skill: 'Skill',
  mcp: 'MCP',
  component: '项目组件',
}

const capabilitySupportCopy: Record<SetupCapabilityItem['support']['level'], string> = {
  native: '原生支持',
  adapted: '受控适配',
  degraded: '降级支持',
  unavailable: '不支持',
}

function credentialKind(method: ModelAuthMethod): 'api-key' | 'harness-session' {
  return method === 'api-key' ? 'api-key' : 'harness-session'
}

function defaultSelection(harnessId: HarnessId): HarnessModelSelection {
  const capability = harnessModelCapability(harnessId)
  const provider = capability.providers[0]
  const authMethod = provider.authMethods.find(({ availability }) => availability === 'available')!
  return {
    harnessId,
    providerId: provider.id,
    modelId: provider.defaultModelId,
    credentialRequirement: {
      method: authMethod.method,
      credentialKind: credentialKind(authMethod.method),
    },
  }
}

interface AgentBuilderViewProps {
  sessionId?: string
  onExit: (message?: string) => void
  onCompleted: (agentId: string) => Promise<void>
}

export function AgentBuilderView({ sessionId, onExit, onCompleted }: AgentBuilderViewProps) {
  const [setup, setSetup] = useState<AgentSetupView>()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [harnessId, setHarnessId] = useState<HarnessId | null>(null)
  const [selection, setSelection] = useState<HarnessModelSelection | null>(null)
  const [profile, setProfile] = useState<AgentProfile>(emptyAgentSetupProfile)
  const [capabilitySelectionIds, setCapabilitySelectionIds] = useState<string[]>([])
  const [capabilityQuery, setCapabilityQuery] = useState('')
  const [capabilityKind, setCapabilityKind] = useState<'all' | SetupCapabilityItem['kind']>('all')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [costAcknowledged, setCostAcknowledged] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'busy' | 'error'>('loading')
  const [error, setError] = useState<string>()
  const [requestId, setRequestId] = useState<string>()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const loadRef = useRef<Promise<AgentSetupView> | undefined>(undefined)
  const busyRef = useRef(false)
  const api = window.studio.agentSetup

  function apply(next: AgentSetupView): AgentSetupView {
    setSetup(next)
    setName(next.session.name)
    setDescription(next.session.description)
    setHarnessId(next.session.harnessId)
    setSelection(next.session.selection)
    setProfile(next.session.profile)
    setCapabilitySelectionIds(next.session.capabilitySelections.map(({ id }) => id))
    if (!busyRef.current) setStatus('ready')
    setError(undefined)
    return next
  }

  useEffect(() => {
    if (!api) {
      setStatus('error')
      setError('当前应用版本没有 Agent 引导设置能力。请重新启动或更新应用。')
      return
    }
    loadRef.current ??= sessionId ? api.get(sessionId) : api.start()
    let active = true
    void loadRef.current
      .then((next) => {
        if (active) apply(next)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setStatus('error')
        setError(reason instanceof Error ? reason.message : '无法开始 Agent 设置。')
      })
    return () => {
      active = false
    }
  }, [api, sessionId])

  const currentStep = setup?.session.step
  useEffect(() => {
    if (!currentStep) return
    headingRef.current?.focus()
  }, [currentStep])

  useEffect(() => {
    if (!error) return
    errorRef.current?.focus()
  }, [error])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || status === 'busy') return
      if (requestId && api) {
        event.preventDefault()
        void api.cancel(requestId)
        return
      }
      if (!setup) return
      const index = agentSetupSteps.indexOf(setup.session.step)
      if (index > 0) {
        event.preventDefault()
        void moveTo(agentSetupSteps[index - 1])
      } else {
        event.preventDefault()
        void cancelOrExit()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  })

  const capability = useMemo(
    () => (harnessId ? harnessModelCapability(harnessId) : null),
    [harnessId],
  )
  const provider = capability?.providers.find(({ id }) => id === selection?.providerId)
  const currentIndex = setup ? agentSetupSteps.indexOf(setup.session.step) : 0
  const selectedCapabilityItems = useMemo(() => {
    if (!setup) return []
    const items = new Map([
      ...setup.capabilityCatalog.items.map((item) => [item.id, item] as const),
      ...setup.session.capabilitySelections.map((item) => [item.id, item] as const),
    ])
    return capabilitySelectionIds.flatMap((id) => {
      const item = items.get(id)
      return item ? [item] : []
    })
  }, [capabilitySelectionIds, setup])
  const filteredCapabilityItems = useMemo(() => {
    if (!setup) return []
    const query = capabilityQuery.trim().toLocaleLowerCase()
    return setup.capabilityCatalog.items.filter(
      (item) =>
        (capabilityKind === 'all' || item.kind === capabilityKind) &&
        (!query ||
          [item.name, item.summary, item.sourceLabel]
            .join('\n')
            .toLocaleLowerCase()
            .includes(query)),
    )
  }, [capabilityKind, capabilityQuery, setup])

  async function persist(step = setup?.session.step): Promise<AgentSetupView> {
    if (!api || !setup || !step) throw new Error('Agent 设置尚未载入。')
    return apply(
      await api.update({
        id: setup.session.id,
        expectedRevision: setup.session.revision,
        step,
        name,
        description,
        harnessId,
        selection,
        profile,
        capabilitySelectionIds,
      }),
    )
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busyRef.current) return
    busyRef.current = true
    setStatus('busy')
    setError(undefined)
    try {
      await action()
      setStatus('ready')
    } catch (reason) {
      setStatus('ready')
      setError(reason instanceof Error ? reason.message : 'Agent 设置操作失败。')
    } finally {
      busyRef.current = false
    }
  }

  async function moveTo(step: AgentSetupStep): Promise<void> {
    await run(async () => {
      await persist(step)
    })
  }

  async function next(): Promise<void> {
    if (!setup || currentIndex >= agentSetupSteps.length - 1) return
    await moveTo(agentSetupSteps[currentIndex + 1])
  }

  async function authenticate(): Promise<void> {
    if (!api || !selection) return
    await run(async () => {
      const current = await persist('model')
      const method = selection.credentialRequirement.method
      const result =
        method === 'api-key'
          ? await api.configureApiKey(current.session.id)
          : method === 'official-login'
            ? await api.launchOfficialLogin(current.session.id)
            : {
                status: 'completed' as const,
                view: await api.refreshAuthentication(current.session.id),
              }
      apply(result.view)
    })
  }

  async function verify(): Promise<void> {
    if (!api || !setup || !costAcknowledged) return
    const nextRequestId = crypto.randomUUID()
    setRequestId(nextRequestId)
    await run(async () => {
      const current = await persist('model')
      const result = await api.verify({
        id: current.session.id,
        requestId: nextRequestId,
        costAcknowledged: true,
        timeoutMs: 120_000,
      })
      apply(result.view)
    })
    setRequestId(undefined)
  }

  async function saveAndExit(): Promise<void> {
    if (!api || !setup) return
    await run(async () => {
      const current = await persist()
      await api.save(current.session.id, current.session.revision)
      onExit('设置草稿已保存。你可以随时继续设置。')
    })
  }

  async function cancelOrExit(): Promise<void> {
    if (!api || !setup) return
    if (setup.session.status === 'saved') {
      onExit()
      return
    }
    await run(async () => {
      await api.discard(setup.session.id)
      onExit('已取消创建，没有产生 Agent 或项目。')
    })
  }

  async function discardSaved(): Promise<void> {
    if (!api || !setup) return
    await run(async () => {
      await api.discard(setup.session.id)
      onExit('设置草稿已删除，没有产生 Agent 或项目。')
    })
  }

  async function complete(): Promise<void> {
    if (!api || !setup || !setup.readiness.ready) return
    await run(async () => {
      const current = await persist('review')
      const result = await api.complete(current.session.id)
      await onCompleted(result.agentId)
    })
  }

  function chooseHarness(nextHarnessId: HarnessId) {
    setHarnessId(nextHarnessId)
    setSelection(defaultSelection(nextHarnessId))
    setCostAcknowledged(false)
  }

  function selectCapability(item: SetupCapabilityItem): void {
    if (item.support.level === 'unavailable') return
    if (item.kind === 'mcp') {
      setProfile((current) => ({
        ...current,
        mcpServers: current.mcpServers.some(({ id }) => id === item.server.id)
          ? current.mcpServers
          : [...current.mcpServers, item.server],
      }))
    }
    setCapabilitySelectionIds((current) =>
      current.includes(item.id) ? current : [...current, item.id],
    )
  }

  function removeCapability(id: string): void {
    const selected = selectedCapabilityItems.find((item) => item.id === id)
    if (selected?.kind === 'mcp') {
      setProfile((current) => ({
        ...current,
        mcpServers: current.mcpServers.filter(
          ({ id: serverId }) => serverId !== selected.server.id,
        ),
      }))
    }
    setCapabilitySelectionIds((current) => current.filter((item) => item !== id))
  }

  async function validateMcp(serverId: string): Promise<void> {
    if (!api) return
    const nextRequestId = crypto.randomUUID()
    setRequestId(nextRequestId)
    await run(async () => {
      const current = await persist('capabilities')
      apply(
        await api.validateMcp({
          id: current.session.id,
          serverId,
          requestId: nextRequestId,
          timeoutMs: 15_000,
        }),
      )
    })
    setRequestId(undefined)
  }

  function clearManualCapabilities(): void {
    setProfile({
      ...profile,
      instructions: '',
      memoryMarkdown: '',
      skills: [],
    })
    setAdvancedOpen(false)
  }

  function chooseProvider(providerId: string) {
    if (!capability) return
    const nextProvider = capability.providers.find(({ id }) => id === providerId)!
    const method = nextProvider.authMethods.find(
      ({ availability }) => availability === 'available',
    )!
    setSelection({
      harnessId: capability.harnessId,
      providerId: nextProvider.id,
      modelId: nextProvider.defaultModelId,
      credentialRequirement: {
        method: method.method,
        credentialKind: credentialKind(method.method),
      },
    })
    setCostAcknowledged(false)
  }

  if (!setup) {
    return (
      <section
        aria-busy={status === 'loading'}
        className={`agent-builder agent-builder--${status}`}
      >
        <div className="agent-builder__loading">
          {status === 'loading' ? (
            <SpinnerGap aria-hidden="true" className="spin" size={24} />
          ) : (
            <WarningCircle aria-hidden="true" size={24} />
          )}
          <h1>{status === 'loading' ? '正在准备引导设置…' : '无法打开引导设置'}</h1>
          {error ? <p role="alert">{error}</p> : null}
          <button className="button button--secondary" onClick={() => onExit()} type="button">
            返回 Agent
          </button>
        </div>
      </section>
    )
  }

  const step = setup.session.step
  const authentication = setup.session.authentication
  const verification = setup.session.verification

  return (
    <section className="agent-builder">
      <header className="agent-builder__masthead">
        <div>
          <span className="eyebrow">引导式创建 · {stepCopy[step].index} / 05</span>
          <h1 ref={headingRef} tabIndex={-1}>
            {stepCopy[step].label}
          </h1>
          <p>{stepCopy[step].description}</p>
        </div>
        <div className="agent-builder__masthead-actions">
          <span className={`status-label status-label--${setup.session.status}`}>
            {setup.session.status === 'saved' ? '设置未完成' : '尚未保存'}
          </span>
          <button
            aria-label={setup.session.status === 'saved' ? '退出设置' : '取消创建'}
            className="button button--quiet"
            disabled={status === 'busy'}
            onClick={() => void cancelOrExit()}
            type="button"
          >
            <X aria-hidden="true" size={16} />
            {setup.session.status === 'saved' ? '退出设置' : '取消创建'}
          </button>
        </div>
      </header>

      <div className="agent-builder__layout">
        <nav aria-label="Agent 创建步骤" className="agent-builder__steps">
          <ol>
            {agentSetupSteps.map((item, index) => {
              const active = item === step
              const available = index <= currentIndex
              return (
                <li key={item}>
                  <button
                    aria-current={active ? 'step' : undefined}
                    className={active ? 'is-active' : undefined}
                    disabled={!available || status === 'busy'}
                    onClick={() => void moveTo(item)}
                    type="button"
                  >
                    <span>{stepCopy[item].index}</span>
                    <strong>{stepCopy[item].label}</strong>
                    <small>{stepCopy[item].description}</small>
                  </button>
                </li>
              )
            })}
          </ol>
          <p>冻结版本与发布仍在创建完成后单独进行。</p>
        </nav>

        <div className="agent-builder__main">
          {error ? (
            <div className="error-summary" ref={errorRef} role="alert" tabIndex={-1}>
              <strong>这一步还不能完成</strong>
              <span>{error}</span>
            </div>
          ) : null}
          <div aria-live="polite" className="sr-only">
            {status === 'busy' ? '正在保存设置。' : `${stepCopy[step].label}已载入。`}
          </div>

          {step === 'basics' ? (
            <div className="agent-builder__panel">
              <div className="agent-builder__intro">
                <h2>先说清楚它要做什么</h2>
                <p>这里只保存设置会话；在你完成全部检查前，不会创建 Agent 或工作空间。</p>
              </div>
              <div className="field">
                <label htmlFor="setup-agent-name">名称</label>
                <input
                  autoFocus
                  id="setup-agent-name"
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
                <span className="field__help">用于本机 Agent 列表，最多 80 个字符。</span>
              </div>
              <div className="field">
                <label htmlFor="setup-agent-description">用途</label>
                <textarea
                  id="setup-agent-description"
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  value={description}
                />
                <span className="field__help">选填。描述输入、输出和主要使用场景。</span>
              </div>
            </div>
          ) : null}

          {step === 'harness' ? (
            <div className="agent-builder__panel">
              <div className="agent-builder__intro">
                <h2>选择 Native Harness</h2>
                <p>状态来自本机固定版本探测；未安装或版本不受支持时不能继续。</p>
              </div>
              <fieldset className="agent-builder__choice-list">
                <legend className="sr-only">Harness</legend>
                {setup.probes.map((probe) => {
                  const unavailable =
                    probe.status === 'not-installed' || probe.status === 'unsupported-version'
                  return (
                    <label key={probe.id}>
                      <input
                        checked={harnessId === probe.id}
                        disabled={status === 'busy'}
                        name="setup-harness"
                        onChange={() => chooseHarness(probe.id)}
                        type="radio"
                      />
                      <span className="agent-builder__choice-body">
                        <strong>{probe.label}</strong>
                        <small>{probe.detail}</small>
                      </span>
                      <span
                        className={`status-label${unavailable ? ' status-label--blocked' : ''}`}
                      >
                        {harnessStatusCopy[probe.status]}
                        {probe.version ? ` · ${probe.version}` : ''}
                      </span>
                    </label>
                  )
                })}
              </fieldset>
            </div>
          ) : null}

          {step === 'model' && capability && selection && provider ? (
            <div className="agent-builder__panel">
              <div className="agent-builder__intro">
                <h2>连接模型</h2>
                <p>认证只通过原生安全入口或 Harness 官方登录；Renderer 不接收 API Key 原文。</p>
              </div>
              <div className="agent-builder__model-grid">
                <div className="field">
                  <label htmlFor="setup-provider">Provider</label>
                  <select
                    id="setup-provider"
                    onChange={(event) => chooseProvider(event.target.value)}
                    value={selection.providerId}
                  >
                    {capability.providers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="setup-model">模型</label>
                  <input
                    id="setup-model"
                    list="setup-model-list"
                    onChange={(event) =>
                      setSelection({ ...selection, modelId: event.target.value.trim() })
                    }
                    value={selection.modelId}
                  />
                  <datalist id="setup-model-list">
                    {provider.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </datalist>
                </div>
              </div>
              <fieldset className="agent-builder__auth-methods">
                <legend>认证方式</legend>
                {provider.authMethods.map((method) => (
                  <label key={method.method}>
                    <input
                      checked={selection.credentialRequirement.method === method.method}
                      disabled={method.availability !== 'available'}
                      name="setup-auth-method"
                      onChange={() => {
                        setSelection({
                          ...selection,
                          credentialRequirement: {
                            method: method.method,
                            credentialKind: credentialKind(method.method),
                          },
                        })
                        setCostAcknowledged(false)
                      }}
                      type="radio"
                    />
                    <span>
                      <strong>{method.label}</strong>
                      <small>{method.detail}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="agent-builder__connection">
                <div>
                  <Key aria-hidden="true" size={20} />
                  <span>
                    <strong>
                      {authentication ? authStateCopy[authentication.state] : '尚未认证'}
                    </strong>
                    <small>{authentication?.detail ?? '保存模型配置后完成当前认证方式。'}</small>
                  </span>
                </div>
                <button
                  className="button button--secondary"
                  disabled={status === 'busy'}
                  onClick={() => void authenticate()}
                  type="button"
                >
                  {selection.credentialRequirement.method === 'api-key'
                    ? '通过安全输入保存 API Key'
                    : selection.credentialRequirement.method === 'official-login'
                      ? '打开官方登录'
                      : '检查现有登录'}
                </button>
              </div>
              <div className="agent-builder__verification">
                <div>
                  {verification.state === 'minimal-call-succeeded' ? (
                    <CheckCircle aria-hidden="true" size={20} weight="fill" />
                  ) : (
                    <Circle aria-hidden="true" size={20} />
                  )}
                  <span>
                    <strong>
                      {verification.state === 'minimal-call-succeeded'
                        ? '最小模型调用已通过'
                        : '最小模型调用尚未通过'}
                    </strong>
                    <small>
                      {verification.failure?.message ??
                        '验证会发起一次最小真实调用，可能产生少量 Provider 费用。'}
                    </small>
                  </span>
                </div>
                <label className="agent-builder__cost-check">
                  <input
                    checked={costAcknowledged}
                    onChange={(event) => setCostAcknowledged(event.target.checked)}
                    type="checkbox"
                  />
                  我了解这会产生一次最小模型调用
                </label>
                <div className="agent-builder__verification-actions">
                  {requestId ? (
                    <button
                      className="button button--quiet"
                      onClick={() => void api?.cancel(requestId)}
                      type="button"
                    >
                      取消验证
                    </button>
                  ) : null}
                  <button
                    className="button button--secondary"
                    disabled={!costAcknowledged || status === 'busy'}
                    onClick={() => void verify()}
                    type="button"
                  >
                    {requestId ? '正在验证…' : '验证模型连接'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {step === 'capabilities' ? (
            <div className="agent-builder__panel">
              <div className="agent-builder__intro">
                <span className="eyebrow">可选增强</span>
                <h2>从可审查的来源组合能力</h2>
                <p>可以不添加任何内容。选中项随草稿保存，完成创建时才原子安装或关联。</p>
              </div>

              {selectedCapabilityItems.length ? (
                <section aria-labelledby="setup-selected-capabilities">
                  <div className="agent-builder__section-heading">
                    <div>
                      <h3 id="setup-selected-capabilities">已选能力</h3>
                      <p>{selectedCapabilityItems.length} 项将在完成创建时安装或写入。</p>
                    </div>
                  </div>
                  <ul className="agent-builder__selected-capabilities">
                    {selectedCapabilityItems.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>{item.name}</strong>
                          <small>
                            {capabilityKindCopy[item.kind]} · {item.sourceLabel}
                          </small>
                        </div>
                        <span
                          className={`status-label status-label--support-${item.support.level}`}
                        >
                          {capabilitySupportCopy[item.support.level]}
                        </span>
                        <button
                          aria-label={`移除 ${item.name}`}
                          className="button button--quiet"
                          disabled={status === 'busy'}
                          onClick={() => removeCapability(item.id)}
                          type="button"
                        >
                          <Trash aria-hidden="true" size={15} />
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : (
                <div className="agent-builder__capability-empty" role="status">
                  <strong>尚未添加能力</strong>
                  <span>这不会阻止创建；Agent 仍可通过已验证的 Harness 与模型运行。</span>
                </div>
              )}

              <section aria-labelledby="setup-capability-catalog">
                <div className="agent-builder__section-heading">
                  <div>
                    <h3 id="setup-capability-catalog">能力目录</h3>
                    <p>内置模板、固定 Skill 方案和当前项目中的真实组件。</p>
                  </div>
                </div>
                <div className="agent-builder__catalog-controls">
                  <label
                    className="agent-builder__catalog-search"
                    htmlFor="setup-capability-search"
                  >
                    <MagnifyingGlass aria-hidden="true" size={16} />
                    <span className="sr-only">搜索能力目录</span>
                    <input
                      id="setup-capability-search"
                      onChange={(event) => setCapabilityQuery(event.target.value)}
                      type="search"
                      value={capabilityQuery}
                    />
                  </label>
                  <label className="field field--compact" htmlFor="setup-capability-kind">
                    <span className="sr-only">筛选能力类型</span>
                    <select
                      id="setup-capability-kind"
                      onChange={(event) =>
                        setCapabilityKind(event.target.value as typeof capabilityKind)
                      }
                      value={capabilityKind}
                    >
                      <option value="all">全部类型</option>
                      <option value="prompt">Prompt</option>
                      <option value="memory">Memory</option>
                      <option value="skill">Skill</option>
                      <option value="mcp">MCP</option>
                      <option value="component">项目组件</option>
                    </select>
                  </label>
                </div>
                {filteredCapabilityItems.length > 0 &&
                filteredCapabilityItems.every((item) =>
                  capabilitySelectionIds.includes(item.id),
                ) ? (
                  <p className="agent-builder__catalog-all-selected" role="status">
                    当前筛选结果已全部加入。可从上方已选清单移除。
                  </p>
                ) : null}
                {filteredCapabilityItems.length ? (
                  <ul className="agent-builder__capability-catalog">
                    {filteredCapabilityItems.map((item) => {
                      const selected = capabilitySelectionIds.includes(item.id)
                      const unavailable = item.support.level === 'unavailable'
                      return (
                        <li key={item.id}>
                          <div className="agent-builder__catalog-item-heading">
                            <div>
                              <span className="eyebrow">{capabilityKindCopy[item.kind]}</span>
                              <h4>{item.name}</h4>
                            </div>
                            <span
                              className={`status-label status-label--support-${item.support.level}`}
                            >
                              {capabilitySupportCopy[item.support.level]}
                            </span>
                          </div>
                          <p>{item.summary}</p>
                          <details>
                            <summary>查看来源与兼容详情</summary>
                            <dl>
                              <div>
                                <dt>来源</dt>
                                <dd>{item.sourceLabel}</dd>
                              </div>
                              <div>
                                <dt>证据</dt>
                                <dd>{item.sourceDetail}</dd>
                              </div>
                              <div>
                                <dt>{harnessId ?? 'Harness'} 支持</dt>
                                <dd>{item.support.detail}</dd>
                              </div>
                            </dl>
                          </details>
                          <button
                            className={
                              selected ? 'button button--quiet' : 'button button--secondary'
                            }
                            disabled={selected || unavailable || status === 'busy'}
                            onClick={() => selectCapability(item)}
                            type="button"
                          >
                            {selected ? (
                              <CheckCircle aria-hidden="true" size={16} weight="fill" />
                            ) : (
                              <Plus aria-hidden="true" size={16} />
                            )}
                            {selected ? '已加入' : unavailable ? '当前 Harness 不支持' : '加入'}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="agent-builder__catalog-empty" role="status">
                    <strong>
                      {setup.capabilityCatalog.items.length ? '没有匹配的能力' : '能力目录暂时为空'}
                    </strong>
                    <span>
                      {setup.capabilityCatalog.items.length
                        ? '试试清除搜索或切换类型。'
                        : '可以直接跳过，也可以在下方新建内容。'}
                    </span>
                  </div>
                )}
                <p
                  className={`agent-builder__project-catalog-state agent-builder__project-catalog-state--${setup.capabilityCatalog.projectComponents.state}`}
                  role={
                    setup.capabilityCatalog.projectComponents.state === 'error' ? 'alert' : 'status'
                  }
                >
                  <strong>项目组件：</strong> {setup.capabilityCatalog.projectComponents.message}
                </p>
              </section>

              <details
                className="agent-builder__advanced-capabilities"
                onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
                open={advancedOpen}
              >
                <summary>新建内容（高级）</summary>
                <div>
                  <p>这是手工编辑支路；保存的是 Profile 内容，不代表安装了目录插件。</p>
                  <div className="field">
                    <label htmlFor="setup-instructions">新建 Prompt / Instructions</label>
                    <textarea
                      id="setup-instructions"
                      maxLength={40_000}
                      onChange={(event) =>
                        setProfile({ ...profile, instructions: event.target.value })
                      }
                      rows={6}
                      value={profile.instructions}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="setup-memory">新建 Memory</label>
                    <textarea
                      id="setup-memory"
                      maxLength={120_000}
                      onChange={(event) =>
                        setProfile({ ...profile, memoryMarkdown: event.target.value })
                      }
                      rows={5}
                      value={profile.memoryMarkdown}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="setup-skill">新建 Skill（Markdown）</label>
                    <textarea
                      id="setup-skill"
                      maxLength={40_000}
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          skills: event.target.value.trim()
                            ? [
                                {
                                  id: 'primary-skill',
                                  name: '手工创建的 Skill',
                                  markdown: event.target.value,
                                  enabled: true,
                                },
                              ]
                            : [],
                        })
                      }
                      rows={5}
                      value={profile.skills[0]?.markdown ?? ''}
                    />
                  </div>
                  <div className="agent-builder__advanced-actions">
                    <button
                      className="button button--quiet"
                      disabled={
                        !profile.instructions && !profile.memoryMarkdown && !profile.skills.length
                      }
                      onClick={clearManualCapabilities}
                      type="button"
                    >
                      清除新建内容并关闭
                    </button>
                  </div>
                </div>
              </details>

              <McpServerEditor
                disabled={status === 'busy'}
                harnessId={harnessId}
                onChange={(mcpServers) => setProfile({ ...profile, mcpServers })}
                onValidate={(serverId) => void validateMcp(serverId)}
                servers={profile.mcpServers}
                validations={setup.session.mcpValidations}
              />

              <div className="field">
                <label htmlFor="setup-tool-policy">工具权限</label>
                <select
                  id="setup-tool-policy"
                  onChange={(event) =>
                    setProfile({
                      ...profile,
                      toolPolicy: event.target.value as AgentProfile['toolPolicy'],
                    })
                  }
                  value={profile.toolPolicy}
                >
                  <option value="read-only">只读</option>
                  <option value="workspace">允许修改当前工作区</option>
                </select>
                <span className="field__help">只影响已选或后续明确添加的工具。</span>
              </div>
            </div>
          ) : null}

          {step === 'review' ? (
            <div className="agent-builder__panel">
              <div className="agent-builder__intro">
                <h2>创建前最后检查</h2>
                <p>所有结论来自主进程的共享 readiness 与兼容性事实。</p>
              </div>
              <ul className="agent-builder__readiness">
                {[
                  ['名称', Boolean(setup.session.name.trim()), 'basics' as const],
                  ['Harness 可执行', setup.readiness.model.harnessExecutable, 'harness' as const],
                  ['Provider 与模型已保存', Boolean(setup.session.selection), 'model' as const],
                  [
                    '当前认证有效',
                    setup.session.authentication?.state === 'credential-valid',
                    'model' as const,
                  ],
                  [
                    '最小模型调用通过',
                    setup.session.verification.state === 'minimal-call-succeeded',
                    'model' as const,
                  ],
                  [
                    '可选能力',
                    !setup.readiness.blockers.some(({ id }) => id === 'capability'),
                    'capabilities' as const,
                  ],
                ].map(([label, passed, target]) => (
                  <li key={label as string}>
                    {passed ? (
                      <CheckCircle aria-hidden="true" size={20} weight="fill" />
                    ) : (
                      <WarningCircle aria-hidden="true" size={20} />
                    )}
                    <span>
                      <strong>{label}</strong>
                      <small>
                        {label === '可选能力' && !setup.readiness.hasCapability
                          ? '未添加（可稍后添加）'
                          : passed
                            ? '已满足'
                            : '需要处理'}
                      </small>
                    </span>
                    {!passed ? (
                      <button
                        className="button button--quiet"
                        onClick={() => void moveTo(target as AgentSetupStep)}
                        type="button"
                      >
                        前往处理
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {setup.readiness.blockers.length ? (
                <div className="agent-builder__blockers" role="status">
                  <strong>还不能完成创建</strong>
                  <ul>
                    {setup.readiness.blockers.map((blocker) => (
                      <li key={blocker.id}>
                        <span>{blocker.message}</span>
                        <button
                          className="button button--quiet"
                          onClick={() => void moveTo(blocker.step)}
                          type="button"
                        >
                          {blocker.recoveryAction}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="agent-builder__ready" role="status">
                  <CheckCircle aria-hidden="true" size={22} weight="fill" />
                  <span>
                    <strong>可以完成创建</strong>
                    <small>完成后进入工作台；冻结 Version 仍需稍后单独操作。</small>
                  </span>
                </div>
              )}
            </div>
          ) : null}

          <footer className="agent-builder__footer">
            <div>
              {setup.session.status === 'saved' ? (
                <button
                  className="button button--danger-quiet"
                  disabled={status === 'busy'}
                  onClick={() => void discardSaved()}
                  type="button"
                >
                  删除设置草稿
                </button>
              ) : null}
              <button
                className="button button--secondary"
                disabled={status === 'busy'}
                onClick={() => void saveAndExit()}
                type="button"
              >
                <FloppyDisk aria-hidden="true" size={16} />
                保存并退出
              </button>
            </div>
            <div>
              {currentIndex > 0 ? (
                <button
                  className="button button--quiet"
                  disabled={status === 'busy'}
                  onClick={() => void moveTo(agentSetupSteps[currentIndex - 1])}
                  type="button"
                >
                  <ArrowLeft aria-hidden="true" size={16} />
                  上一步
                </button>
              ) : null}
              {step !== 'review' ? (
                <button
                  className="button button--primary"
                  disabled={status === 'busy'}
                  onClick={() => void next()}
                  type="button"
                >
                  下一步
                  <ArrowRight aria-hidden="true" size={16} />
                </button>
              ) : (
                <button
                  aria-describedby={setup.readiness.ready ? undefined : 'setup-complete-help'}
                  className="button button--primary"
                  disabled={!setup.readiness.ready || status === 'busy'}
                  onClick={() => void complete()}
                  type="button"
                >
                  {status === 'busy' ? '正在创建…' : '完成创建'}
                </button>
              )}
            </div>
            {!setup.readiness.ready && step === 'review' ? (
              <span className="sr-only" id="setup-complete-help">
                请先处理完成检查中的阻断项。
              </span>
            ) : null}
          </footer>
        </div>
      </div>
    </section>
  )
}
