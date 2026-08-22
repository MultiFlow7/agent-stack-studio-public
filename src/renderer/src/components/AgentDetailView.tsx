import {
  ArrowLeft,
  Archive,
  ArrowCounterClockwise,
  CheckCircle,
  Copy,
  FolderOpen,
  GitCommit,
  LockKey,
  PaperPlaneTilt,
  Trash,
} from '@phosphor-icons/react'
import { useEffect, useState, type FormEvent } from 'react'
import type { ExecutionMode } from '../../../shared/agent'
import type { AgentDetail } from '../../../shared/agent-detail'
import type { AgentStatusProjection } from '../../../shared/agent-status'
import {
  executionModeLabels,
  experimentStatusLabels,
  publishStatusLabels,
  runStatusLabels,
  stackStatusLabels,
} from '../copy'
import { ExperimentsView } from './ExperimentsView'
import { RunsView } from './RunsView'
import { AgentCompositionView } from './AgentCompositionView'
import { PublishPanel } from './PublishPanel'
import { SecretReferencesPanel } from './SecretReferencesPanel'
import { CapabilityView } from './CapabilityView'

interface AgentDetailViewProps {
  initialDetail: AgentDetail
  initialStatus: AgentStatusProjection
  onBack: () => void
  onChanged: () => Promise<void>
  onLifecycle: (scope: 'active' | 'archived', message: string) => Promise<void>
}

type DetailTab =
  | 'overview'
  | 'stack'
  | 'capabilities'
  | 'experiments'
  | 'runs'
  | 'publish'
  | 'settings'

const tabs: Array<{ id: DetailTab; label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'stack', label: 'Stack' },
  { id: 'capabilities', label: '能力' },
  { id: 'experiments', label: '实验' },
  { id: 'runs', label: '运行记录' },
  { id: 'publish', label: '发布' },
  { id: 'settings', label: '设置' },
]

export function AgentDetailView({
  initialDetail,
  initialStatus,
  onBack,
  onChanged,
  onLifecycle,
}: AgentDetailViewProps) {
  const [detail, setDetail] = useState(initialDetail)
  const [status, setStatus] = useState(initialStatus)
  const [tab, setTab] = useState<DetailTab>(() =>
    window.location.hash.startsWith('#stack:')
      ? 'stack'
      : window.location.hash.startsWith('#runs:')
        ? 'runs'
        : window.location.hash.startsWith('#experiments:')
          ? 'experiments'
          : window.location.hash.startsWith('#publish:')
            ? 'publish'
            : 'overview',
  )
  const [name, setName] = useState(detail.agent.name)
  const [description, setDescription] = useState(detail.agent.description)
  const [executionMode, setExecutionMode] = useState(detail.agent.executionMode)
  const [isSaving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [feedback, setFeedback] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (tab !== 'overview') return
    let active = true
    void window.studio.agents
      .status(detail.agent.id)
      .then((nextStatus) => {
        if (active) setStatus(nextStatus)
      })
      .catch((error: unknown) => {
        if (active) {
          setActionError(error instanceof Error ? error.message : '无法刷新 Agent 状态。')
        }
      })
    return () => {
      active = false
    }
  }, [detail.agent.id, tab])

  async function refresh(): Promise<void> {
    const [nextDetail, nextStatus] = await Promise.all([
      window.studio.agents.get(detail.agent.id),
      window.studio.agents.status(detail.agent.id),
    ])
    setDetail(nextDetail)
    setStatus(nextStatus)
    await onChanged()
  }

  async function createVersion(): Promise<void> {
    setSaving(true)
    setActionError(undefined)
    setFeedback(undefined)
    try {
      const version = await window.studio.agents.createVersion(detail.agent.id)
      await refresh()
      setFeedback(`已冻结不可变 Agent Version ${version.versionNumber}。`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法创建版本。')
    } finally {
      setSaving(false)
    }
  }

  async function duplicateAgent(): Promise<void> {
    setSaving(true)
    setActionError(undefined)
    try {
      const duplicate = await window.studio.agents.duplicate({ id: detail.agent.id })
      await onLifecycle('active', `已创建“${duplicate.agent.name}”，历史记录没有被复制。`)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法复制 Agent。')
    } finally {
      setSaving(false)
    }
  }

  async function archiveAgent(): Promise<void> {
    setSaving(true)
    setActionError(undefined)
    try {
      const result = await window.studio.agents.archive(detail.agent.id)
      await onLifecycle('active', result.message)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法归档 Agent。')
    } finally {
      setSaving(false)
    }
  }

  async function restoreAgent(): Promise<void> {
    setSaving(true)
    setActionError(undefined)
    try {
      const result = await window.studio.agents.restore(detail.agent.id)
      await onLifecycle('active', result.message)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法恢复 Agent。')
    } finally {
      setSaving(false)
    }
  }

  async function deleteAgent(): Promise<void> {
    setSaving(true)
    setActionError(undefined)
    try {
      const result = await window.studio.agents.delete(detail.agent.id)
      await onLifecycle('archived', result.message)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法永久删除 Agent。')
    } finally {
      setSaving(false)
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setActionError(undefined)
    setFeedback(undefined)
    try {
      const updated = await window.studio.agents.update({
        id: detail.agent.id,
        name,
        description,
        executionMode,
      })
      setDetail(updated)
      await onChanged()
      setFeedback('Agent 设置已保存到本地草稿。')
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '无法保存设置。')
    } finally {
      setSaving(false)
    }
  }

  const currentVersion = detail.versions[0]
  const projectBacked = detail.location?.sourcePath?.endsWith('.agent-stack') ?? false

  function moveTabFocus(current: DetailTab, direction: -1 | 1): void {
    const index = tabs.findIndex((item) => item.id === current)
    const next = tabs[(index + direction + tabs.length) % tabs.length]
    if (!next) return
    setTab(next.id)
    document.getElementById(`tab-${next.id}`)?.focus()
  }

  return (
    <div className="detail-page">
      <button className="back-button" onClick={onBack} type="button">
        <ArrowLeft aria-hidden="true" size={17} />
        返回全部 Agent
      </button>
      <header className="detail-header">
        <div>
          <div className="detail-title-line">
            <h1>{detail.agent.name}</h1>
          </div>
          <div className="detail-header__summary" aria-label="Agent 当前状态">
            <span className="status-label">
              {detail.agent.archivedAt ? '已归档' : `草稿修订 ${detail.draft.revision}`}
            </span>
            <span className="status-label">
              {status.currentVersion ? `版本 ${status.currentVersion.versionNumber}` : '无版本'}
            </span>
            <span className="status-label">Stack {stackStatusLabels[status.stack.status]}</span>
          </div>
          <p>{detail.agent.description || '暂无描述'}</p>
        </div>
        <div className="detail-header__actions">
          {detail.agent.archivedAt ? (
            <>
              <button
                className="button button--secondary"
                disabled={isSaving}
                onClick={() => void restoreAgent()}
                type="button"
              >
                <ArrowCounterClockwise aria-hidden="true" size={17} /> 恢复 Agent
              </button>
              <button
                className="button button--danger"
                disabled={isSaving}
                onClick={() => setConfirmDelete(true)}
                type="button"
              >
                <Trash aria-hidden="true" size={17} /> 永久删除
              </button>
            </>
          ) : (
            <>
              {!projectBacked ? (
                <button
                  className="button button--quiet"
                  disabled={isSaving}
                  onClick={() => void duplicateAgent()}
                  type="button"
                >
                  <Copy aria-hidden="true" size={17} /> 复制 Agent
                </button>
              ) : null}
              <button
                className="button button--quiet"
                disabled={isSaving}
                onClick={() => void archiveAgent()}
                type="button"
              >
                <Archive aria-hidden="true" size={17} /> 归档
              </button>
              <button
                className="button button--secondary"
                onClick={() => setTab('publish')}
                type="button"
              >
                <PaperPlaneTilt aria-hidden="true" size={17} /> 发布版本
              </button>
              <button
                className="button button--primary"
                disabled={isSaving}
                onClick={() => void createVersion()}
                type="button"
              >
                <Copy aria-hidden="true" size={17} />
                冻结 Agent Version
              </button>
            </>
          )}
        </div>
      </header>

      {confirmDelete ? (
        <div className="danger-confirmation" role="alert">
          <div>
            <strong>永久删除“{detail.agent.name}”？</strong>
            <p>
              仅当没有版本、运行、实验、发布或密钥历史引用时才能删除。此操作会移除本机工作空间，不能撤销。
            </p>
          </div>
          <div className="danger-confirmation__actions">
            <button
              autoFocus
              className="button button--secondary"
              disabled={isSaving}
              onClick={() => setConfirmDelete(false)}
              type="button"
            >
              取消
            </button>
            <button
              className="button button--danger"
              disabled={isSaving}
              onClick={() => void deleteAgent()}
              type="button"
            >
              {isSaving ? '正在删除…' : '永久删除此 Agent'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="tabs" role="tablist" aria-label="Agent 详情分区">
        {tabs.map((item) => (
          <button
            aria-selected={tab === item.id}
            className="tab"
            id={`tab-${item.id}`}
            key={item.id}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault()
                moveTabFocus(item.id, -1)
              }
              if (event.key === 'ArrowRight') {
                event.preventDefault()
                moveTabFocus(item.id, 1)
              }
              if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault()
                const target = event.key === 'Home' ? tabs[0] : tabs.at(-1)
                if (target) {
                  setTab(target.id)
                  document.getElementById(`tab-${target.id}`)?.focus()
                }
              }
            }}
            onClick={() => setTab(item.id)}
            role="tab"
            tabIndex={tab === item.id ? 0 : -1}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {actionError ? (
        <div className="detail-feedback detail-feedback--error" role="alert">
          {actionError}
        </div>
      ) : null}
      {feedback ? (
        <div className="detail-feedback" role="status">
          <CheckCircle aria-hidden="true" size={18} weight="fill" />
          {feedback}
        </div>
      ) : null}

      <section aria-labelledby={`tab-${tab}`} className="detail-content" role="tabpanel">
        {tab === 'overview' ? (
          <div className="overview-layout">
            <div className="fact-group">
              <h2>当前结构</h2>
              <dl className="fact-list">
                <div>
                  <dt>执行模式</dt>
                  <dd>{executionModeLabels[detail.draft.executionMode]}</dd>
                </div>
                <div>
                  <dt>当前版本</dt>
                  <dd>
                    {currentVersion ? `版本 ${currentVersion.versionNumber}` : '尚未创建版本'}
                  </dd>
                </div>
                <div>
                  <dt>Stack 状态</dt>
                  <dd>
                    {stackStatusLabels[status.stack.status]} · {status.stack.componentCount} 个组件
                    · {status.stack.ownerCount} 个 Owner · {status.stack.issueCount} 个未解决问题
                  </dd>
                </div>
                <div>
                  <dt>最近 Run</dt>
                  <dd>
                    {status.latestRun
                      ? `${runStatusLabels[status.latestRun.status]} · ${new Date(
                          status.latestRun.updatedAt,
                        ).toLocaleString('zh-CN')}`
                      : '尚无运行记录'}
                  </dd>
                </div>
                <div>
                  <dt>最近实验</dt>
                  <dd>
                    {status.latestExperiment
                      ? `${status.latestExperiment.name} · ${
                          experimentStatusLabels[status.latestExperiment.status]
                        }`
                      : '尚无实验'}
                  </dd>
                </div>
                <div>
                  <dt>发布状态</dt>
                  <dd>
                    {status.latestPublish
                      ? `${status.latestPublish.targetLabel} · ${
                          publishStatusLabels[status.latestPublish.status]
                        } · ${new Date(status.latestPublish.occurredAt).toLocaleString('zh-CN')}`
                      : '尚未发布'}
                  </dd>
                </div>
              </dl>
            </div>
            <aside className="location-panel">
              <FolderOpen aria-hidden="true" size={21} />
              <h2>本地来源</h2>
              <p>
                {detail.location?.sourcePath ??
                  detail.location?.workspacePath ??
                  '本地工作空间待创建'}
              </p>
              <span>
                {detail.location?.sourceKind === 'local-import' ? '静态导入' : 'Studio 工作空间'}
              </span>
            </aside>
            <div className="version-section">
              <h2>版本历史</h2>
              {detail.versions.length > 0 ? (
                <ol className="version-list">
                  {detail.versions.map((version) => (
                    <li key={version.id}>
                      <GitCommit aria-hidden="true" size={19} />
                      <span>
                        <strong>版本 {version.versionNumber}</strong>
                        <small>{new Date(version.createdAt).toLocaleString('zh-CN')}</small>
                      </span>
                      <code>{version.contentHash.slice(0, 10)}</code>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="inline-empty">
                  <p>尚未创建不可变版本。</p>
                  <span>创建版本后，当前 Agent 与 Stack 快照将被锁定。</span>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'stack' ? (
          <AgentCompositionView agentId={detail.agent.id} onChanged={refresh} />
        ) : null}

        {tab === 'capabilities' ? (
          <CapabilityView agentId={detail.agent.id} onOpenStack={() => setTab('stack')} />
        ) : null}

        {tab === 'runs' ? <RunsView agentId={detail.agent.id} /> : null}

        {tab === 'experiments' ? <ExperimentsView agentId={detail.agent.id} /> : null}

        {tab === 'publish' ? (
          <PublishPanel agentId={detail.agent.id} version={currentVersion} />
        ) : null}

        {tab === 'settings' ? (
          <div className="agent-settings-layout">
            <form className="settings-form" onSubmit={(event) => void saveSettings(event)}>
              <div>
                <h2>Agent 设置</h2>
                <p>修改会写入当前 .agent-stack 草稿，已冻结版本不会改变。</p>
              </div>
              <div className="field">
                <label htmlFor="settings-name">名称</label>
                <input
                  id="settings-name"
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </div>
              <div className="field">
                <label htmlFor="settings-description">描述</label>
                <textarea
                  id="settings-description"
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  value={description}
                />
              </div>
              <div className="field">
                <label htmlFor="settings-mode">执行模式</label>
                <select
                  id="settings-mode"
                  onChange={(event) => setExecutionMode(event.target.value as ExecutionMode)}
                  value={executionMode}
                >
                  {Object.entries(executionModeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="keychain-foundation">
                <LockKey aria-hidden="true" size={20} />
                <span>
                  <strong>密钥保存在 macOS 钥匙串中</strong>
                  <small>Studio 只保存服务与账户引用，密钥内容不会写入 SQLite。</small>
                </span>
              </div>
              <div>
                <button className="button button--primary" disabled={isSaving} type="submit">
                  {isSaving ? '正在保存…' : '保存到当前项目'}
                </button>
              </div>
            </form>
            <SecretReferencesPanel agentId={detail.agent.id} />
          </div>
        ) : null}
      </section>
    </div>
  )
}
