import {
  ArrowClockwise,
  CheckCircle,
  ClockCounterClockwise,
  FileText,
  GitDiff,
  Play,
  Stop,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Agent } from '../../../shared/agent'
import type { RunHistoryDetail, RunRecord } from '../../../shared/run'
import { localExecutionModeDescriptions } from '../../../shared/trusted-execution'
import { executionModeLabels, runStatusLabels } from '../copy'

interface RunsViewProps {
  agentId?: string
}

const activeStatuses = new Set<RunRecord['status']>(['queued', 'starting', 'running', 'cancelling'])

function statusIcon(status: RunRecord['status']) {
  if (status === 'succeeded') return <CheckCircle aria-hidden="true" weight="fill" />
  if (status === 'failed' || status === 'timed-out')
    return <XCircle aria-hidden="true" weight="fill" />
  if (status === 'cancelled') return <Stop aria-hidden="true" weight="fill" />
  return <ClockCounterClockwise aria-hidden="true" />
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

function runDuration(run: RunRecord): number | null {
  return run.startedAt && run.finishedAt
    ? Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
    : null
}

function formatDuration(value: number | null): string {
  if (value === null) return '—'
  if (value < 1_000) return `${value} ms`
  return `${(value / 1_000).toFixed(value < 10_000 ? 2 : 1)} 秒`
}

function executionBinding(detail: RunHistoryDetail): string {
  const execution = detail.run.manifest.execution
  switch (execution.kind) {
    case 'agent-loop':
      return execution.controllerServiceKey
    case 'workflow':
      return `Workflow ${execution.workflowVersionId?.slice(0, 8) ?? '未绑定'}`
    case 'hybrid':
      return `Workflow ${execution.workflowVersionId?.slice(0, 8) ?? '未绑定'} → Agent Loop`
    case 'external-harness':
      return execution.trustedExecution ? '内置 Harness X（已授信）' : '未授信'
  }
}

export function RunsView({ agentId }: RunsViewProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState(agentId ?? '')
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const [detail, setDetail] = useState<RunHistoryDetail>()
  const [prompt, setPrompt] = useState('检查本地 Stack 并生成一份可复现的运行摘要。')
  const [timeoutMs, setTimeoutMs] = useState(10_000)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string>()
  const [isStarting, setStarting] = useState(false)
  const [isCancelling, setCancelling] = useState(false)

  const load = useCallback(async () => {
    try {
      const [nextAgents, nextRuns] = await Promise.all([
        window.studio.agents.list(),
        window.studio.runs.list(agentId ?? null),
      ])
      setAgents(nextAgents)
      setRuns(nextRuns)
      setSelectedAgentId((current) => current || agentId || nextAgents[0]?.id || '')
      setStatus('ready')
      setError(undefined)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取本地 Run。')
      setStatus('error')
    }
  }, [agentId])

  const loadDetail = useCallback(async (runId: string) => {
    try {
      setDetail(await window.studio.runs.get(runId))
      setError(undefined)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取 Run 详情。')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const hasActiveRun = useMemo(() => runs.some((run) => activeStatuses.has(run.status)), [runs])

  useEffect(() => {
    if (!hasActiveRun) return
    const timer = window.setInterval(() => {
      void load()
      if (selectedRunId) void loadDetail(selectedRunId)
    }, 400)
    return () => window.clearInterval(timer)
  }, [hasActiveRun, load, loadDetail, selectedRunId])

  async function startRun(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!selectedAgentId) return
    setStarting(true)
    setError(undefined)
    try {
      const run = await window.studio.runs.start({
        agentId: selectedAgentId,
        prompt,
        timeoutMs,
      })
      setSelectedRunId(run.id)
      await Promise.all([load(), loadDetail(run.id)])
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '无法启动本地 Run。')
    } finally {
      setStarting(false)
    }
  }

  async function cancelRun(runId: string): Promise<void> {
    setCancelling(true)
    setError(undefined)
    try {
      setDetail(await window.studio.runs.cancel(runId))
      await load()
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : '无法取消 Run。')
    } finally {
      setCancelling(false)
    }
  }

  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]))
  const selectedAgent = agents.find(({ id }) => id === selectedAgentId)

  return (
    <div className="runs-page">
      {!agentId ? (
        <header className="page-header">
          <div>
            <h1>运行记录</h1>
            <p>查看这台 Mac 上的 Runtime 冷启动、事件与 Artifact。</p>
          </div>
        </header>
      ) : null}

      <form className="run-launcher" onSubmit={(event) => void startRun(event)}>
        <div className="run-launcher__copy">
          <span className="eyebrow">本地执行</span>
          <h2>启动可复现 Run</h2>
          <p>使用不可变 Agent 版本与已通过预检的 Runtime Plan；每次启动全新子进程。</p>
        </div>
        {selectedAgent ? (
          <div className="run-mode-boundary" role="note">
            <strong>{executionModeLabels[selectedAgent.executionMode]}</strong>
            <span>{localExecutionModeDescriptions[selectedAgent.executionMode]}</span>
            <small>只执行 Studio 白名单内置 Adapter；导入仓库仍只做静态检查。</small>
          </div>
        ) : null}
        {!agentId ? (
          <label className="field">
            <span>Agent</span>
            <select
              disabled={agents.length === 0}
              onChange={(event) => setSelectedAgentId(event.target.value)}
              required
              value={selectedAgentId}
            >
              {agents.length === 0 ? <option value="">尚无 Agent</option> : null}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field run-launcher__prompt">
          <span>样例任务</span>
          <textarea
            maxLength={1_000}
            onChange={(event) => setPrompt(event.target.value)}
            required
            rows={3}
            value={prompt}
          />
        </label>
        <label className="field run-launcher__timeout">
          <span>超时</span>
          <select onChange={(event) => setTimeoutMs(Number(event.target.value))} value={timeoutMs}>
            <option value={500}>500 毫秒</option>
            <option value={1_000}>1 秒</option>
            <option value={5_000}>5 秒</option>
            <option value={10_000}>10 秒</option>
            <option value={30_000}>30 秒</option>
          </select>
        </label>
        <button
          className="button button--primary run-launcher__button"
          disabled={isStarting || !selectedAgentId}
          type="submit"
        >
          <Play aria-hidden="true" size={17} weight="fill" />
          {isStarting ? '正在启动…' : '启动本地 Run'}
        </button>
      </form>

      {error ? (
        <div className="detail-feedback detail-feedback--error" role="alert">
          <WarningCircle aria-hidden="true" size={18} />
          <span>{error}</span>
          {status === 'error' ? (
            <button className="button button--quiet" onClick={() => void load()} type="button">
              <ArrowClockwise aria-hidden="true" size={16} /> 重试
            </button>
          ) : null}
        </div>
      ) : null}

      {status === 'loading' ? (
        <section aria-busy="true" aria-label="正在载入 Run" className="run-loading">
          <div className="skeleton skeleton--title" />
          <div className="skeleton" />
        </section>
      ) : null}

      {status === 'ready' && runs.length === 0 ? (
        <section className="run-empty">
          <ClockCounterClockwise aria-hidden="true" size={28} />
          <h2>还没有本地 Run</h2>
          <p>创建不可变版本并让 Stack 通过预检后，可从上方启动内置样例。</p>
        </section>
      ) : null}

      {status === 'ready' && runs.length > 0 ? (
        <section className="run-table" aria-label="本地 Run 列表">
          <div className="run-table__heading">
            <strong>{runs.length} 条运行记录</strong>
            <span>记录与 Artifact 均保存在本机</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">状态</th>
                  {!agentId ? <th scope="col">Agent</th> : null}
                  <th scope="col">版本 / Manifest</th>
                  <th scope="col">开始时间</th>
                  <th scope="col">总耗时</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <span className={`run-status run-status--${run.status}`}>
                        {statusIcon(run.status)}
                        {runStatusLabels[run.status]}
                      </span>
                    </td>
                    {!agentId ? <td>{agentNames.get(run.agentId) ?? '未知 Agent'}</td> : null}
                    <td>
                      <button
                        className="run-link"
                        onClick={() => {
                          setSelectedRunId(run.id)
                          void loadDetail(run.id)
                        }}
                        type="button"
                      >
                        <strong>版本 {run.manifest.agentVersionNumber}</strong>
                        <code>{run.manifest.contentHash.slice(0, 12)}</code>
                      </button>
                    </td>
                    <td>{formatTime(run.startedAt ?? run.createdAt)}</td>
                    <td>{formatDuration(runDuration(run))}</td>
                    <td>
                      <div className="run-actions">
                        <button
                          className="button button--quiet"
                          onClick={() => {
                            setSelectedRunId(run.id)
                            void loadDetail(run.id)
                          }}
                          type="button"
                        >
                          查看
                        </button>
                        {activeStatuses.has(run.status) ? (
                          <button
                            className="button button--danger-quiet"
                            disabled={isCancelling || run.status === 'cancelling'}
                            onClick={() => void cancelRun(run.id)}
                            type="button"
                          >
                            <Stop aria-hidden="true" size={15} /> 取消
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {selectedRunId ? (
        <section className="run-detail" aria-live="polite">
          <header>
            <div>
              <span className="eyebrow">Run 详情</span>
              <h2>{detail ? runStatusLabels[detail.run.status] : '正在读取…'}</h2>
            </div>
            {detail ? <code>{detail.run.id}</code> : null}
          </header>
          {detail?.run.failure ? (
            <div className="run-failure" role="alert">
              <WarningCircle aria-hidden="true" size={18} />
              <span>
                <strong>{detail.run.failure.code}</strong>
                {detail.run.failure.message}
              </span>
            </div>
          ) : null}
          {detail ? (
            <>
              <section aria-label="复现变量与 Drift" className="run-history">
                <header>
                  <div>
                    <span className="eyebrow">只读历史投影</span>
                    <h3>复现变量与 Drift</h3>
                    <p>
                      变量来自不可变 Manifest；实验 Drift 由该 Run 的 Manifest 对照锁定基准重算。
                    </p>
                  </div>
                  <GitDiff aria-hidden="true" size={22} />
                </header>
                <div className="run-history__body">
                  <dl className="run-history__variables">
                    <div className="run-history__prompt">
                      <dt>Prompt</dt>
                      <dd>{detail.history.variables.prompt}</dd>
                    </div>
                    <div>
                      <dt>随机种子</dt>
                      <dd>{detail.history.variables.randomSeed}</dd>
                    </div>
                    <div>
                      <dt>超时</dt>
                      <dd>{formatDuration(detail.history.variables.timeoutMs)}</dd>
                    </div>
                    <div>
                      <dt>重试 / 并发</dt>
                      <dd>
                        {detail.history.variables.retryLimit} /{' '}
                        {detail.history.variables.concurrency}
                      </dd>
                    </div>
                    <div>
                      <dt>总耗时</dt>
                      <dd>{formatDuration(detail.history.durationMs)}</dd>
                    </div>
                  </dl>
                  <div className="run-history__drift">
                    <span>Drift Check</span>
                    {detail.history.experiment ? (
                      <>
                        <strong>
                          {detail.history.experiment.drift.status === 'clean'
                            ? '无非预期变化'
                            : '检测到非预期变化'}
                        </strong>
                        <p>
                          {detail.history.experiment.name} · Prompt 变量{' '}
                          {detail.history.experiment.promptIndex + 1} · 第{' '}
                          {detail.history.experiment.repetition} 次
                        </p>
                        {detail.history.experiment.drift.issues.length > 0 ? (
                          <ul>
                            {detail.history.experiment.drift.issues.map((issue) => (
                              <li key={issue.control}>{issue.message}</li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <strong>不适用</strong>
                        <p>此 Run 不属于实验矩阵，没有锁定实验基准；不会伪造 Drift 结论。</p>
                      </>
                    )}
                  </div>
                </div>
              </section>
              <div className="run-detail__grid">
                <div className="run-events">
                  <h3>事件时间线</h3>
                  <ol>
                    {detail.events.map((event) => (
                      <li key={event.id}>
                        <span>{event.sequence}</span>
                        <div>
                          <strong>{event.message}</strong>
                          <small>{formatTime(event.createdAt)}</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
                <aside className="run-facts">
                  <h3>执行边界</h3>
                  <dl>
                    <div>
                      <dt>模式</dt>
                      <dd>{executionModeLabels[detail.run.manifest.execution.kind]}</dd>
                    </div>
                    <div>
                      <dt>不可变绑定</dt>
                      <dd>{executionBinding(detail)}</dd>
                    </div>
                    <div>
                      <dt>Runtime</dt>
                      <dd>Cordis {detail.run.manifest.environment.cordisVersion}</dd>
                    </div>
                    <div>
                      <dt>网络</dt>
                      <dd>禁止</dd>
                    </div>
                    <div>
                      <dt>文件系统</dt>
                      <dd>仅 Artifact</dd>
                    </div>
                    <div>
                      <dt>超时</dt>
                      <dd>{detail.run.manifest.reproducibility.timeoutMs / 1_000} 秒</dd>
                    </div>
                    <div>
                      <dt>完成时间</dt>
                      <dd>{formatTime(detail.run.finishedAt)}</dd>
                    </div>
                  </dl>
                  <h3>Artifacts</h3>
                  {detail.artifacts.length > 0 ? (
                    <ul className="artifact-list">
                      {detail.artifacts.map((artifact) => (
                        <li key={artifact.id}>
                          <FileText aria-hidden="true" size={17} />
                          <span>
                            <strong>{artifact.relativePath}</strong>
                            <small>
                              {artifact.sizeBytes} bytes · {artifact.contentHash.slice(0, 10)}
                            </small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="run-detail__empty">尚未生成 Artifact。</p>
                  )}
                  <details className="manifest-details">
                    <summary>查看 Runtime Manifest</summary>
                    <pre>{JSON.stringify(detail.run.manifest, null, 2)}</pre>
                  </details>
                </aside>
              </div>
            </>
          ) : (
            <div className="skeleton" />
          )}
        </section>
      ) : null}
    </div>
  )
}
