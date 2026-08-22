import {
  ArrowClockwise,
  CheckCircle,
  DownloadSimple,
  Flask,
  Play,
  Plus,
  ShieldCheck,
  Stop,
  WarningCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Agent } from '../../../shared/agent'
import type { ExperimentCell, ExperimentDetail, ExperimentRecord } from '../../../shared/experiment'
import { experimentCellStatusLabels, experimentStatusLabels } from '../copy'

interface ExperimentsViewProps {
  agentId?: string
  experimentId?: string
}

const activeStatuses = new Set<ExperimentRecord['status']>(['running', 'cancelling'])
const terminalCellStatuses = new Set<ExperimentCell['status']>([
  'succeeded',
  'failed',
  'cancelled',
  'blocked',
])
const issueCellStatuses = new Set<ExperimentCell['status']>(['failed', 'cancelled', 'blocked'])
type MatrixFilter = 'all' | 'active' | 'succeeded' | 'issues'

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

function deltaLabel(value: number | null): string {
  if (value === null) return '—'
  if (value === 0) return '基准'
  return `${value > 0 ? '+' : ''}${value} ms`
}

export function ExperimentsView({ agentId, experimentId }: ExperimentsViewProps) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([])
  const [detail, setDetail] = useState<ExperimentDetail>()
  const [selectedAgentId, setSelectedAgentId] = useState(agentId ?? '')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string>()
  const [feedback, setFeedback] = useState<string>()
  const [showCreate, setShowCreate] = useState(false)
  const [busyAction, setBusyAction] = useState<string>()
  const [name, setName] = useState('Prompt 与随机种子对照实验')
  const [question, setQuestion] = useState(
    '在 Stack 保持不变时，Prompt 和随机种子如何影响运行耗时？',
  )
  const [baselinePrompt, setBaselinePrompt] = useState(
    '检查本地 Stack 并生成一份可复现的运行摘要。',
  )
  const [candidatePrompts, setCandidatePrompts] = useState(
    '检查本地 Stack，并用三点列出可复现性证据。',
  )
  const [seedText, setSeedText] = useState('17, 29')
  const [repetitions, setRepetitions] = useState(1)
  const [matrixFilter, setMatrixFilter] = useState<MatrixFilter>('all')
  const [matrixQuery, setMatrixQuery] = useState('')
  const listRequest = useRef(0)
  const detailRequest = useRef(0)

  const load = useCallback(async () => {
    const request = ++listRequest.current
    try {
      const [nextAgents, nextExperiments] = await Promise.all([
        window.studio.agents.list(),
        window.studio.experiments.list(agentId ?? null),
      ])
      if (request !== listRequest.current) return
      setAgents(nextAgents)
      setExperiments(nextExperiments)
      setSelectedAgentId((current) => current || agentId || nextAgents[0]?.id || '')
      setStatus('ready')
      setError(undefined)
    } catch (loadError) {
      if (request !== listRequest.current) return
      setError(loadError instanceof Error ? loadError.message : '无法读取本地实验。')
      setStatus('error')
    }
  }, [agentId])

  const loadDetail = useCallback(async (experimentId: string) => {
    const request = ++detailRequest.current
    try {
      const nextDetail = await window.studio.experiments.get(experimentId)
      if (request !== detailRequest.current) return
      setDetail(nextDetail)
      setMatrixFilter('all')
      setMatrixQuery('')
      setError(undefined)
    } catch (loadError) {
      if (request !== detailRequest.current) return
      setError(loadError instanceof Error ? loadError.message : '无法读取实验详情。')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (experimentId) void loadDetail(experimentId)
  }, [experimentId, loadDetail])

  const hasActiveExperiment = useMemo(
    () => experiments.some((experiment) => activeStatuses.has(experiment.status)),
    [experiments],
  )

  useEffect(() => {
    if (!hasActiveExperiment) return
    const timer = window.setInterval(() => {
      void load()
      if (detail) void loadDetail(detail.experiment.id)
    }, 400)
    return () => window.clearInterval(timer)
  }, [detail, hasActiveExperiment, load, loadDetail])

  async function createExperiment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const promptVariants = candidatePrompts
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean)
    const randomSeeds = seedText.split(',').map((value) => Number(value.trim()))
    if (
      promptVariants.length === 0 ||
      randomSeeds.some((value) => !Number.isInteger(value) || value < 0)
    ) {
      setError('请提供至少一个 Prompt 候选，并用逗号分隔非负整数种子。')
      return
    }
    setBusyAction('create')
    setError(undefined)
    setFeedback(undefined)
    try {
      const created = await window.studio.experiments.create({
        agentId: selectedAgentId,
        name,
        researchQuestion: question,
        baselinePrompt,
        promptVariants,
        randomSeeds,
        repetitions,
        timeoutMs: 10_000,
      })
      setDetail(created)
      setMatrixFilter('all')
      setMatrixQuery('')
      setShowCreate(false)
      setFeedback(`实验已锁定，共 ${created.cells.length} 个运行单元。`)
      await load()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '无法创建实验。')
    } finally {
      setBusyAction(undefined)
    }
  }

  async function act(action: 'drift' | 'start' | 'cancel'): Promise<void> {
    if (!detail) return
    setBusyAction(action)
    setError(undefined)
    setFeedback(undefined)
    try {
      const next =
        action === 'drift'
          ? await window.studio.experiments.refreshDrift(detail.experiment.id)
          : action === 'start'
            ? await window.studio.experiments.start(detail.experiment.id)
            : await window.studio.experiments.cancel(detail.experiment.id)
      setDetail(next)
      setFeedback(
        action === 'drift'
          ? 'Drift Check 已更新。'
          : action === 'start'
            ? '实验矩阵已开始运行。'
            : '已请求取消实验。',
      )
      await load()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '实验操作失败。')
    } finally {
      setBusyAction(undefined)
    }
  }

  async function exportResult(format: 'json' | 'csv'): Promise<void> {
    if (!detail) return
    setBusyAction(format)
    setError(undefined)
    try {
      const result = await window.studio.experiments.export(detail.experiment.id, format)
      if (result.status === 'saved') setFeedback(`已导出 ${result.fileName}。`)
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '无法导出实验。')
    } finally {
      setBusyAction(undefined)
    }
  }

  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]))
  const selected = detail?.experiment
  const matrixSummary = useMemo(() => {
    const cells = detail?.cells ?? []
    const terminal = cells.filter(({ status: cellStatus }) =>
      terminalCellStatuses.has(cellStatus),
    ).length
    const succeeded = cells.filter(({ status: cellStatus }) => cellStatus === 'succeeded').length
    const issues = cells.filter(({ status: cellStatus }) =>
      issueCellStatuses.has(cellStatus),
    ).length
    const durations = cells.flatMap(({ status: cellStatus, durationMs }) =>
      cellStatus === 'succeeded' && durationMs !== null ? [durationMs] : [],
    )
    return {
      planned: cells.length,
      terminal,
      succeeded,
      issues,
      successRate: terminal === 0 ? null : succeeded / terminal,
      averageDurationMs:
        durations.length === 0
          ? null
          : Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length),
    }
  }, [detail])
  const filteredCells = useMemo(() => {
    const query = matrixQuery.trim().toLocaleLowerCase('zh-CN')
    return (detail?.cells ?? []).filter((cell) => {
      const matchesStatus =
        matrixFilter === 'all' ||
        (matrixFilter === 'active' && !terminalCellStatuses.has(cell.status)) ||
        (matrixFilter === 'succeeded' && cell.status === 'succeeded') ||
        (matrixFilter === 'issues' && issueCellStatuses.has(cell.status))
      if (!matchesStatus) return false
      if (!query) return true
      return [
        cell.promptValue,
        String(cell.randomSeed),
        cell.runId ?? '',
        cell.failureMessage ?? '',
      ]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
        .includes(query)
    })
  }, [detail, matrixFilter, matrixQuery])

  return (
    <div className="experiments-page">
      {!agentId ? (
        <header className="page-header">
          <div>
            <h1>实验</h1>
            <p>锁定控制变量，只比较明确选择的变化。</p>
          </div>
          <button
            className="button button--primary"
            onClick={() => setShowCreate(true)}
            type="button"
          >
            <Plus aria-hidden="true" size={17} /> 创建实验
          </button>
        </header>
      ) : (
        <div className="context-actions">
          <button
            className="button button--primary"
            onClick={() => setShowCreate(true)}
            type="button"
          >
            <Plus aria-hidden="true" size={17} /> 从当前版本创建实验
          </button>
        </div>
      )}

      {showCreate ? (
        <form className="experiment-create" onSubmit={(event) => void createExperiment(event)}>
          <header>
            <div>
              <h2>定义对照实验</h2>
              <p>保存后定义不可编辑；Stack 草稿仍可修改，但运行前会重新检查 Drift。</p>
            </div>
            <span>
              {(1 + candidatePrompts.split('\n').filter((value) => value.trim()).length) *
                seedText.split(',').filter(Boolean).length *
                repetitions}{' '}
              个运行单元
            </span>
          </header>
          <div className="experiment-form-grid">
            {!agentId ? (
              <label className="field">
                <span>基准 Agent</span>
                <select
                  required
                  value={selectedAgentId}
                  onChange={(event) => setSelectedAgentId(event.target.value)}
                >
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="field">
              <span>实验名称</span>
              <input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="field experiment-form-grid__wide">
              <span>研究问题</span>
              <input
                required
                maxLength={500}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </label>
            <label className="field experiment-form-grid__wide">
              <span>基准 Prompt（控制组）</span>
              <textarea
                required
                rows={2}
                maxLength={1_000}
                value={baselinePrompt}
                onChange={(event) => setBaselinePrompt(event.target.value)}
              />
            </label>
            <label className="field experiment-form-grid__wide">
              <span>Prompt 变量候选（每行一个，最多三个）</span>
              <textarea
                required
                rows={3}
                value={candidatePrompts}
                onChange={(event) => setCandidatePrompts(event.target.value)}
              />
            </label>
            <label className="field">
              <span>随机种子（逗号分隔）</span>
              <input
                required
                value={seedText}
                onChange={(event) => setSeedText(event.target.value)}
              />
            </label>
            <label className="field">
              <span>每组重复次数</span>
              <select
                value={repetitions}
                onChange={(event) => setRepetitions(Number(event.target.value))}
              >
                <option value={1}>1 次</option>
                <option value={2}>2 次</option>
                <option value={3}>3 次</option>
              </select>
            </label>
          </div>
          <footer>
            <button
              className="button button--secondary"
              onClick={() => setShowCreate(false)}
              type="button"
            >
              取消创建
            </button>
            <button
              className="button button--primary"
              disabled={busyAction === 'create' || !selectedAgentId}
              type="submit"
            >
              {busyAction === 'create' ? '正在锁定…' : '锁定定义并创建矩阵'}
            </button>
          </footer>
        </form>
      ) : null}

      {error ? (
        <div className="detail-feedback detail-feedback--error" role="alert">
          <WarningCircle aria-hidden="true" size={18} />
          {error}
          {status === 'error' ? (
            <button className="button button--quiet" onClick={() => void load()} type="button">
              <ArrowClockwise aria-hidden="true" size={16} /> 重试
            </button>
          ) : null}
        </div>
      ) : null}
      {feedback ? (
        <div className="detail-feedback" role="status">
          <CheckCircle aria-hidden="true" size={18} weight="fill" />
          {feedback}
        </div>
      ) : null}

      {status === 'loading' ? (
        <section className="experiment-loading" aria-busy="true" aria-label="正在载入实验">
          <div className="skeleton skeleton--title" />
          <div className="skeleton" />
        </section>
      ) : null}
      {status === 'ready' && experiments.length === 0 && !showCreate ? (
        <section className="experiment-empty">
          <Flask aria-hidden="true" size={30} />
          <h2>还没有对照实验</h2>
          <p>从已通过预检的 Agent Version 锁定控制变量，再选择 Prompt 与随机种子。</p>
          <button
            className="button button--primary"
            onClick={() => setShowCreate(true)}
            type="button"
          >
            创建第一个实验
          </button>
        </section>
      ) : null}

      {status === 'ready' && experiments.length > 0 ? (
        <section className="experiment-list" aria-label="实验列表">
          <header>
            <strong>{experiments.length} 个本地实验</strong>
            <span>定义按不可变版本锁定</span>
          </header>
          <ul>
            {experiments.map((experiment) => (
              <li key={experiment.id}>
                <button
                  aria-current={selected?.id === experiment.id ? 'true' : undefined}
                  onClick={() => void loadDetail(experiment.id)}
                  type="button"
                >
                  <span>
                    <strong>{experiment.name}</strong>
                    <small>
                      {agentNames.get(experiment.agentId) ?? '当前 Agent'} ·{' '}
                      {experiment.researchQuestion}
                    </small>
                  </span>
                  <span className={`experiment-status experiment-status--${experiment.status}`}>
                    {experimentStatusLabels[experiment.status]}
                  </span>
                  <time>{formatTime(experiment.createdAt)}</time>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail ? (
        <article className="experiment-detail">
          <header className="experiment-detail__header">
            <div>
              <h2>{selected?.name}</h2>
              <p>{selected?.researchQuestion}</p>
            </div>
            <div className="experiment-detail__actions">
              <button
                className="button button--secondary"
                disabled={Boolean(busyAction)}
                onClick={() => void act('drift')}
                type="button"
              >
                <ShieldCheck aria-hidden="true" size={16} /> 检查 Drift
              </button>
              {selected?.status === 'ready' || selected?.status === 'blocked' ? (
                <button
                  className="button button--primary"
                  disabled={Boolean(busyAction) || selected.drift.status === 'blocked'}
                  onClick={() => void act('start')}
                  type="button"
                >
                  <Play aria-hidden="true" size={16} weight="fill" /> 运行矩阵
                </button>
              ) : null}
              {selected?.status === 'running' ? (
                <button
                  className="button button--danger-quiet"
                  disabled={Boolean(busyAction)}
                  onClick={() => void act('cancel')}
                  type="button"
                >
                  <Stop aria-hidden="true" size={16} /> 取消实验
                </button>
              ) : null}
            </div>
          </header>

          <section
            className={`drift-panel drift-panel--${selected?.drift.status}`}
            aria-live="polite"
          >
            <div>
              {selected?.drift.status === 'clean' ? (
                <CheckCircle aria-hidden="true" size={21} weight="fill" />
              ) : (
                <WarningCircle aria-hidden="true" size={21} weight="fill" />
              )}
              <span>
                <strong>
                  {selected?.drift.status === 'clean' ? 'Drift Check 通过' : '检测到非预期变化'}
                </strong>
                <small>检查时间：{formatTime(selected?.drift.checkedAt ?? null)}</small>
              </span>
            </div>
            {selected?.drift.issues.length ? (
              <ul>
                {selected.drift.issues.map((issue, index) => (
                  <li key={`${issue.control}-${index}`}>
                    <strong>{issue.control}</strong>
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p>基准版本、Stack、组件、Runtime、权限和数据集均未变化。</p>
            )}
          </section>

          <section className="locked-controls">
            <header>
              <h3>已锁定控制变量</h3>
              <span>实验定义 v{selected?.definition.definitionVersion}</span>
            </header>
            <dl>
              <div>
                <dt>Agent Version</dt>
                <dd>
                  版本 {selected?.definition.controls.agentVersion.versionNumber} ·{' '}
                  {selected?.definition.controls.agentVersion.contentHash.slice(0, 10)}
                </dd>
              </div>
              <div>
                <dt>Runtime Plan</dt>
                <dd>{selected?.definition.controls.stack.runtimePlanHash.slice(0, 10)}</dd>
              </div>
              <div>
                <dt>组件</dt>
                <dd>{selected?.definition.controls.components.length} 个 Descriptor 哈希</dd>
              </div>
              <div>
                <dt>执行模式</dt>
                <dd>{selected?.definition.controls.executionMode}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>Cordis {selected?.definition.controls.runtime.cordisVersion}</dd>
              </div>
              <div>
                <dt>权限</dt>
                <dd>网络禁止，文件仅 Artifact</dd>
              </div>
              <div>
                <dt>数据集</dt>
                <dd>built-in-prompt-v1@1</dd>
              </div>
            </dl>
          </section>

          <section aria-label="实验进度与复现定义" className="experiment-evidence-summary">
            <header>
              <div>
                <h3>进度与复现定义</h3>
                <p>汇总使用已保存单元；定义来自创建时锁定的不可变实验输入。</p>
              </div>
              <strong>{selected ? experimentStatusLabels[selected.status] : '—'}</strong>
            </header>
            <div className="experiment-evidence-summary__body">
              <dl aria-label="矩阵进度指标" className="experiment-progress-facts">
                <div>
                  <dt>计划单元</dt>
                  <dd>{matrixSummary.planned}</dd>
                </div>
                <div>
                  <dt>已终态</dt>
                  <dd>
                    {matrixSummary.terminal} / {matrixSummary.planned}
                  </dd>
                </div>
                <div>
                  <dt>成功 / 需关注</dt>
                  <dd>
                    {matrixSummary.succeeded} / {matrixSummary.issues}
                  </dd>
                </div>
                <div>
                  <dt>终态成功率</dt>
                  <dd>
                    {matrixSummary.successRate === null
                      ? '—'
                      : `${Math.round(matrixSummary.successRate * 100)}%`}
                  </dd>
                </div>
                <div>
                  <dt>成功平均耗时</dt>
                  <dd>
                    {matrixSummary.averageDurationMs === null
                      ? '—'
                      : `${matrixSummary.averageDurationMs} ms`}
                  </dd>
                </div>
              </dl>
              <dl aria-label="锁定复现定义" className="experiment-reproduction-facts">
                <div>
                  <dt>Prompt 变量</dt>
                  <dd>{selected?.definition.promptVariants.length ?? 0} 个</dd>
                </div>
                <div>
                  <dt>随机种子</dt>
                  <dd>{selected?.definition.randomSeeds.join(', ')}</dd>
                </div>
                <div>
                  <dt>每组重复</dt>
                  <dd>{selected?.definition.repetitions} 次</dd>
                </div>
                <div>
                  <dt>单元超时</dt>
                  <dd>{selected ? `${selected.definition.timeoutMs} ms` : '—'}</dd>
                </div>
                <div>
                  <dt>评价器</dt>
                  <dd>{selected?.definition.evaluator.id.replace('studio://evaluators/', '')}</dd>
                </div>
                <div>
                  <dt>开始 / 结束</dt>
                  <dd>
                    {formatTime(selected?.startedAt ?? null)} /{' '}
                    {formatTime(selected?.finishedAt ?? null)}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="experiment-matrix">
            <header>
              <div>
                <h3>运行矩阵</h3>
                <p>Prompt × 随机种子 × 重复次数，每个单元使用全新 Runtime。</p>
              </div>
              <span>
                {matrixSummary.terminal} / {matrixSummary.planned} 已终态
              </span>
            </header>
            <div className="experiment-matrix-toolbar" role="search">
              <label className="field">
                <span>筛选矩阵</span>
                <input
                  aria-label="筛选实验矩阵"
                  onChange={(event) => setMatrixQuery(event.target.value)}
                  placeholder="Prompt、种子、Run 或失败原因"
                  value={matrixQuery}
                />
              </label>
              <label className="field">
                <span>状态范围</span>
                <select
                  aria-label="矩阵状态范围"
                  onChange={(event) => setMatrixFilter(event.target.value as MatrixFilter)}
                  value={matrixFilter}
                >
                  <option value="all">全部状态</option>
                  <option value="active">待运行 / 运行中</option>
                  <option value="succeeded">仅成功</option>
                  <option value="issues">需关注：失败 / 取消 / Drift 阻断</option>
                </select>
              </label>
              <span aria-live="polite">
                显示 {filteredCells.length} / {detail.cells.length} 个单元
              </span>
              {matrixFilter !== 'all' || matrixQuery ? (
                <button
                  className="button button--quiet"
                  onClick={() => {
                    setMatrixFilter('all')
                    setMatrixQuery('')
                  }}
                  type="button"
                >
                  清除筛选
                </button>
              ) : null}
            </div>
            {filteredCells.length > 0 ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Prompt</th>
                      <th scope="col">种子</th>
                      <th scope="col">重复</th>
                      <th scope="col">状态</th>
                      <th scope="col">耗时</th>
                      <th scope="col">Run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCells.map((cell) => (
                      <tr key={cell.id}>
                        <td>
                          <strong>
                            {cell.promptIndex === 0 ? '基准' : `候选 ${cell.promptIndex}`}
                          </strong>
                          <small>{cell.promptValue}</small>
                        </td>
                        <td>
                          <code>{cell.randomSeed}</code>
                        </td>
                        <td>{cell.repetition}</td>
                        <td>
                          <span className={`cell-status cell-status--${cell.status}`}>
                            {experimentCellStatusLabels[cell.status]}
                          </span>
                          {cell.failureMessage ? (
                            <small className="cell-failure">{cell.failureMessage}</small>
                          ) : null}
                        </td>
                        <td>{cell.durationMs === null ? '—' : `${cell.durationMs} ms`}</td>
                        <td>{cell.runId ? <code>{cell.runId.slice(0, 8)}</code> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="experiment-matrix-empty">
                <strong>没有符合条件的运行单元</strong>
                <p>调整 Prompt、种子或状态范围；实验原始记录没有改变。</p>
              </div>
            )}
          </section>

          <section className="experiment-comparison">
            <header>
              <div>
                <h3>基础对比</h3>
                <p>以首个 Prompt 与首个种子的平均耗时为基准；不推断统计显著性。</p>
              </div>
              <div>
                <button
                  className="button button--quiet"
                  disabled={Boolean(busyAction)}
                  onClick={() => void exportResult('json')}
                  type="button"
                >
                  <DownloadSimple aria-hidden="true" size={15} /> 导出 JSON
                </button>
                <button
                  className="button button--quiet"
                  disabled={Boolean(busyAction)}
                  onClick={() => void exportResult('csv')}
                  type="button"
                >
                  <DownloadSimple aria-hidden="true" size={15} /> 导出 CSV
                </button>
              </div>
            </header>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">组合</th>
                    <th scope="col">成功率</th>
                    <th scope="col">平均耗时</th>
                    <th scope="col">相对基准</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.comparison.map((row) => (
                    <tr key={`${row.promptIndex}-${row.randomSeed}`}>
                      <td>
                        {row.promptIndex === 0 ? '基准' : `候选 ${row.promptIndex}`} · seed{' '}
                        {row.randomSeed}
                      </td>
                      <td>
                        {Math.round(row.successRate * 100)}% ({row.succeededRuns}/{row.totalRuns})
                      </td>
                      <td>
                        {row.averageDurationMs === null ? '—' : `${row.averageDurationMs} ms`}
                      </td>
                      <td
                        className={
                          row.deltaFromBaselineMs !== null && row.deltaFromBaselineMs > 0
                            ? 'metric-worse'
                            : ''
                        }
                      >
                        {deltaLabel(row.deltaFromBaselineMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </article>
      ) : null}
    </div>
  )
}
