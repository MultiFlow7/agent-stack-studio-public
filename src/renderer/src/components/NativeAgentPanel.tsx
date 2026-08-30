import { ChatCircleDots, CheckCircle, FloppyDisk, Play, Stop } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { AgentProfile } from '../../../shared/agent-profile'
import type { HarnessId, HarnessProbe, NativeAgentResult } from '../../../shared/native-agent'
import type { StudioProjectState } from '../../../shared/studio-project'
import type { ModelAuthView } from '../../../shared/model-auth-ipc'
import { McpServerEditor } from './McpServerEditor'

function resultLabel(result: NativeAgentResult): string {
  if (result.status === 'succeeded') return result.kind === 'chat' ? '回复' : '运行结果'
  if (result.status === 'cancelled') return '已取消'
  if (result.status === 'timed-out') return '已超时'
  return '执行失败'
}

export function NativeAgentPanel({
  firstChat = false,
  onOpenSetup,
}: {
  firstChat?: boolean
  onOpenSetup?: () => void
}) {
  const api = window.studio.nativeAgent
  const projects = window.studio.studioProject
  const modelAuth = window.studio.modelAuth
  const [state, setState] = useState<StudioProjectState>()
  const [probes, setProbes] = useState<HarnessProbe[]>([])
  const [history, setHistory] = useState<NativeAgentResult[]>([])
  const [profile, setProfile] = useState<AgentProfile>()
  const [skillMarkdown, setSkillMarkdown] = useState('')
  const [kind, setKind] = useState<'chat' | 'run'>('chat')
  const [message, setMessage] = useState('请简要说明当前 Agent 可以帮助我完成什么。')
  const [sessionId, setSessionId] = useState<string>()
  const [activeRequest, setActiveRequest] = useState<string>()
  const [pending, setPending] = useState<string>()
  const [error, setError] = useState<string>()
  const [feedback, setFeedback] = useState<string>()
  const [modelAuthView, setModelAuthView] = useState<ModelAuthView>()
  const messageInput = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    if (!api || !projects) return
    try {
      const nextState = await projects.current()
      setState(nextState)
      if (nextState.project) {
        setProfile(nextState.project.profile)
        setSkillMarkdown(nextState.project.profile.skills[0]?.markdown ?? '')
      }
      const [nextProbes, nextHistory, nextModelAuthView] = await Promise.all([
        api.probes(),
        api.list({ kind: null }),
        modelAuth?.status(),
      ])
      setProbes(nextProbes)
      setHistory(nextHistory)
      setModelAuthView(nextModelAuthView)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法载入 Native Harness 状态。')
    }
  }, [api, modelAuth, projects])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!firstChat || !state?.project) return
    messageInput.current?.focus()
  }, [firstChat, state?.project])

  const harness = modelAuthView?.harness?.id ?? null
  const selectedProbe = useMemo(() => probes.find(({ id }) => id === harness), [harness, probes])
  const agentReady = modelAuthView?.readiness.ready === true
  const modelAuthLoading = Boolean(modelAuth) && !modelAuthView && !error

  if (!api || !projects) return null
  if (!state?.project || !profile) {
    return (
      <section className="native-agent-panel">
        <h2>真实 Harness</h2>
        <p>先打开一个 `.agent-stack` 项目，再选择 Harness 并开始聊天或单次运行。</p>
      </section>
    )
  }

  async function chooseHarness(harnessId: HarnessId): Promise<void> {
    setPending(`harness-${harnessId}`)
    setError(undefined)
    try {
      const next = await projects!.selectHarness({
        harnessId,
        expectedRevision: state!.project!.revision,
      })
      setState(next)
      if (modelAuth) setModelAuthView(await modelAuth.status())
      setFeedback(
        `已选择 ${harnessId === 'pi' ? 'Pi' : harnessId === 'openclaw' ? 'OpenClaw' : 'Codex CLI'}。`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法选择 Harness。')
    } finally {
      setPending(undefined)
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setPending('profile')
    setError(undefined)
    try {
      const nextProfile: AgentProfile = {
        ...profile!,
        skills: skillMarkdown.trim()
          ? [{ id: 'primary-skill', name: '主要 Skill', markdown: skillMarkdown, enabled: true }]
          : [],
      }
      const next = await projects!.updateProfile({
        profile: nextProfile,
        expectedRevision: state!.project!.revision,
      })
      setState(next)
      setProfile(next.project!.profile)
      setFeedback('Prompt、Memory、Skill 与 MCP 配置已写入项目事实。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存 Agent 配置。')
    } finally {
      setPending(undefined)
    }
  }

  async function execute(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const requestId = crypto.randomUUID()
    setActiveRequest(requestId)
    setPending('execute')
    setError(undefined)
    setFeedback(undefined)
    try {
      const result = await api!.execute({
        kind,
        message,
        requestId,
        ...(kind === 'chat' && sessionId ? { sessionId } : {}),
        timeoutMs: 120_000,
        ...(kind === 'run' ? { idempotencyKey: requestId } : {}),
      })
      if (kind === 'chat') setSessionId(result.sessionId)
      setHistory((current) => [result, ...current.filter(({ id }) => id !== result.id)])
      setFeedback(
        result.status === 'succeeded'
          ? `${result.harness} 已完成${kind === 'chat' ? '回复' : '单次运行'}。`
          : (result.failure?.message ?? resultLabel(result)),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Harness 执行失败。')
    } finally {
      setActiveRequest(undefined)
      setPending(undefined)
    }
  }

  async function cancel(): Promise<void> {
    if (!activeRequest) return
    await api!.cancel(activeRequest)
  }

  return (
    <section className="native-agent-panel" aria-labelledby="native-agent-heading">
      {firstChat ? (
        <div className="native-first-chat" role="status">
          <CheckCircle aria-hidden="true" size={19} weight="fill" />
          <span>
            <strong>Agent 已创建 · 开始首次聊天</strong>
            <small>创建与冻结版本彼此独立；你可以先确认真实 Harness 的第一次回复。</small>
          </span>
        </div>
      ) : null}
      <header>
        <div>
          <span className="eyebrow">Native-first</span>
          <h2 id="native-agent-heading">聊天与单次运行</h2>
          <p>直接调用已选择的真实 Harness；聊天保留原生 session，run 始终非交互。</p>
        </div>
        {selectedProbe ? (
          <span className={`native-harness-status native-harness-status--${selectedProbe.status}`}>
            {selectedProbe.status === 'ready'
              ? agentReady
                ? 'Agent 就绪'
                : 'Harness 可执行 · 模型未就绪'
              : selectedProbe.detail}
          </span>
        ) : null}
      </header>

      <div className="native-harness-grid" aria-label="选择 Harness">
        {probes.map((probe) => (
          <button
            aria-pressed={harness === probe.id}
            className="native-harness-card"
            disabled={Boolean(pending)}
            key={probe.id}
            onClick={() => void chooseHarness(probe.id)}
            type="button"
          >
            <strong>{probe.label}</strong>
            <span>{probe.version ?? probe.requiredVersion}</span>
            <small>{probe.detail}</small>
          </button>
        ))}
      </div>

      <form className="native-profile-form" onSubmit={(event) => void saveProfile(event)}>
        <div className="native-profile-grid">
          <label className="field">
            <span>Agent Prompt</span>
            <textarea
              maxLength={40_000}
              onChange={(event) => setProfile({ ...profile, instructions: event.target.value })}
              rows={4}
              value={profile.instructions}
            />
          </label>
          <label className="field">
            <span>Markdown Memory</span>
            <textarea
              maxLength={120_000}
              onChange={(event) => setProfile({ ...profile, memoryMarkdown: event.target.value })}
              rows={4}
              value={profile.memoryMarkdown}
            />
          </label>
          <label className="field">
            <span>主要 Skill（Markdown）</span>
            <textarea
              maxLength={40_000}
              onChange={(event) => setSkillMarkdown(event.target.value)}
              rows={4}
              value={skillMarkdown}
            />
          </label>
        </div>
        <McpServerEditor
          disabled={Boolean(pending)}
          harnessId={harness}
          onChange={(mcpServers) => setProfile({ ...profile, mcpServers })}
          servers={profile.mcpServers}
        />
        <label className="field native-tool-policy">
          <span>工具权限</span>
          <select
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
        </label>
        <button className="button button--secondary" disabled={Boolean(pending)} type="submit">
          <FloppyDisk aria-hidden="true" size={17} />
          保存 Agent 配置
        </button>
      </form>

      <form className="native-execute-form" onSubmit={(event) => void execute(event)}>
        {!agentReady ? (
          <div className="native-readiness-blocker" role="status">
            <strong>暂不能执行</strong>
            <span>
              {modelAuthLoading
                ? '正在核对创建结果与本机模型就绪状态…'
                : (modelAuthView?.readiness.blockers[0]?.message ??
                  '请先在 Agent 构建中完成 Stack、Harness、模型认证与最小模型验证。')}
            </span>
            {onOpenSetup ? (
              <button className="button button--secondary" onClick={onOpenSetup} type="button">
                前往 Harness 与模型
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="tabs" role="tablist" aria-label="执行方式">
          <button
            aria-selected={kind === 'chat'}
            className="tab"
            onClick={() => setKind('chat')}
            role="tab"
            type="button"
          >
            聊天
          </button>
          <button
            aria-selected={kind === 'run'}
            className="tab"
            onClick={() => setKind('run')}
            role="tab"
            type="button"
          >
            单次运行
          </button>
        </div>
        <label className="field">
          <span>{kind === 'chat' ? '消息' : '任务'}</span>
          <textarea
            maxLength={40_000}
            onChange={(event) => setMessage(event.target.value)}
            required
            ref={messageInput}
            rows={4}
            value={message}
          />
        </label>
        <div className="native-execute-actions">
          <button
            className="button button--primary"
            disabled={
              pending === 'execute' || !harness || selectedProbe?.status !== 'ready' || !agentReady
            }
            type="submit"
          >
            {kind === 'chat' ? (
              <ChatCircleDots aria-hidden="true" size={17} />
            ) : (
              <Play aria-hidden="true" size={17} weight="fill" />
            )}
            {pending === 'execute' ? '正在执行…' : kind === 'chat' ? '发送' : '运行一次'}
          </button>
          {activeRequest ? (
            <button
              className="button button--secondary"
              onClick={() => void cancel()}
              type="button"
            >
              <Stop aria-hidden="true" size={17} /> 取消
            </button>
          ) : null}
          {sessionId ? <small>聊天 session {sessionId.slice(0, 8)}</small> : null}
        </div>
      </form>

      {error ? (
        <div className="detail-feedback detail-feedback--error" role="alert">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="detail-feedback" role="status">
          {feedback}
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="native-history">
          <h3>最近的 Native 结果</h3>
          {history.slice(0, 10).map((result) => (
            <article key={result.id}>
              <header>
                <strong>{resultLabel(result)}</strong>
                <span>
                  {result.harness} · {new Date(result.startedAt).toLocaleString('zh-CN')}
                </span>
              </header>
              {result.modelLayer?.kind === 'codex-simulation' ? (
                <small>Codex simulation 测试模型层 · 不代表 Harness 原生 Provider 认证</small>
              ) : null}
              <p>{result.responseMarkdown || result.failure?.message}</p>
              {result.failure?.recoveryAction && onOpenSetup ? (
                <button className="button button--quiet" onClick={onOpenSetup} type="button">
                  {result.failure.recoveryAction}
                </button>
              ) : null}
              {result.degradedFeatures.map((item) => (
                <small key={item}>{item}</small>
              ))}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
