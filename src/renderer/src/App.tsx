import {
  ArrowClockwise,
  Cube,
  Flask,
  GearSix,
  HardDrives,
  Plus,
  Robot,
  UploadSimple,
  FileCode,
  GithubLogo,
  MagnifyingGlass,
  PlayCircle,
  SidebarSimple,
  WarningCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreateAgentInput } from '../../shared/agent'
import type { AgentDetail } from '../../shared/agent-detail'
import type { AgentStatusProjection } from '../../shared/agent-status'
import type { ImportScan } from '../../shared/import'
import { AgentDetailView } from './components/AgentDetailView'
import { ComponentCatalogView } from './components/ComponentCatalogView'
import { CommandPalette } from './components/CommandPalette'
import { CreateAgentDialog } from './components/CreateAgentDialog'
import { ExperimentsView } from './components/ExperimentsView'
import { ImportProjectDialog } from './components/ImportProjectDialog'
import { RunsView } from './components/RunsView'
import { SettingsView } from './components/SettingsView'
import { StudioProjectView } from './components/StudioProjectView'
import { SourceDiscoveryView } from './components/SourceDiscoveryView'
import {
  activityStatusLabels,
  executionModeLabels,
  publishStatusLabels,
  runStatusLabels,
  stackStatusLabels,
  workspaceStatusLabels,
} from './copy'
import type { AppView } from '../../shared/preferences'
import type { CommandCenterDestination, CommandCenterSnapshot } from '../../shared/command-center'

const navigation = [
  { id: 'project', label: 'Studio 项目', icon: FileCode, enabled: true },
  { id: 'discovery', label: '发现', icon: GithubLogo, enabled: true },
  { id: 'agents', label: 'Agent', icon: Robot, enabled: true },
  { id: 'components', label: '组件', icon: Cube, enabled: true },
  { id: 'experiments', label: '实验', icon: Flask, enabled: true },
  { id: 'runs', label: '运行记录', icon: HardDrives, enabled: true },
  { id: 'settings', label: '设置', icon: GearSix, enabled: true },
] as const

function viewFromHash(hash: string): AppView | null {
  if (hash === '#project') return 'project'
  if (hash === '#discovery') return 'discovery'
  if (hash === '#components') return 'components'
  if (hash === '#experiments') return 'experiments'
  if (hash === '#runs') return 'runs'
  if (hash === '#settings') return 'settings'
  return null
}

export function App() {
  const [agents, setAgents] = useState<AgentStatusProjection[]>([])
  const [agentScope, setAgentScope] = useState<'active' | 'archived'>('active')
  const [listFeedback, setListFeedback] = useState<string>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string>()
  const [isCreateOpen, setCreateOpen] = useState(false)
  const [isSaving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const [detail, setDetail] = useState<AgentDetail>()
  const [detailStatus, setDetailStatus] = useState<AgentStatusProjection>()
  const [scan, setScan] = useState<ImportScan>()
  const [isScanning, setScanning] = useState(false)
  const [isImporting, setImporting] = useState(false)
  const [importError, setImportError] = useState<string>()
  const [view, setView] = useState<AppView>(() => viewFromHash(window.location.hash) ?? 'agents')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [preferenceError, setPreferenceError] = useState<string>()
  const [didOpenCapturedStack, setDidOpenCapturedStack] = useState(false)
  const [commandSnapshot, setCommandSnapshot] = useState<CommandCenterSnapshot>()
  const [commandStatus, setCommandStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [commandError, setCommandError] = useState<string>()
  const [isCommandOpen, setCommandOpen] = useState(false)
  const [selectedComponentId, setSelectedComponentId] = useState<string>()
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const [selectedExperimentId, setSelectedExperimentId] = useState<string>()
  const commandRequest = useRef(0)
  const agentListRequest = useRef(0)
  const agentDetailRequest = useRef(0)

  const persistRendererPreferences = useCallback(
    async (lastView: AppView, collapsed: boolean): Promise<void> => {
      try {
        await window.studio.preferences.update({ lastView, sidebarCollapsed: collapsed })
        setPreferenceError(undefined)
      } catch (error) {
        setPreferenceError(error instanceof Error ? error.message : '无法保存界面偏好。')
      }
    },
    [],
  )

  const openView = useCallback(
    (nextView: AppView, focusMain = true): void => {
      agentDetailRequest.current += 1
      setDetail(undefined)
      setDetailStatus(undefined)
      setSelectedComponentId(undefined)
      setSelectedRunId(undefined)
      setSelectedExperimentId(undefined)
      setView(nextView)
      void persistRendererPreferences(nextView, sidebarCollapsed)
      if (focusMain) window.setTimeout(() => document.getElementById('main-content')?.focus(), 0)
    },
    [persistRendererPreferences, sidebarCollapsed],
  )

  const loadCommandCenter = useCallback(async (changedExternally = false): Promise<void> => {
    const request = ++commandRequest.current
    try {
      const nextSnapshot = await window.studio.commandCenter.snapshot()
      if (request !== commandRequest.current) return
      setCommandSnapshot(
        changedExternally && nextSnapshot.workspace.name
          ? {
              ...nextSnapshot,
              workspace: { ...nextSnapshot.workspace, status: 'changed-externally' },
            }
          : nextSnapshot,
      )
      setCommandStatus('ready')
      setCommandError(undefined)
    } catch (error) {
      if (request !== commandRequest.current) return
      setCommandError(error instanceof Error ? error.message : '无法读取工作空间状态。')
      setCommandStatus('error')
    }
  }, [])

  useEffect(() => {
    let active = true
    void window.studio.preferences
      .get()
      .then((preferences) => {
        if (!active) return
        setSidebarCollapsed(preferences.sidebarCollapsed)
        if (!window.location.hash) setView(preferences.lastView)
      })
      .catch((error: unknown) => {
        if (!active) return
        setPreferenceError(error instanceof Error ? error.message : '无法读取界面偏好。')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    void loadCommandCenter()
    const interval = window.setInterval(
      () => void loadCommandCenter(),
      commandSnapshot?.activity.activeRunCount ? 500 : 3_000,
    )
    const openFromKeyboard = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey && event.key.toLocaleLowerCase('en-US') === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', openFromKeyboard)
    const removeExternalListener = window.studio.studioProject?.onExternalChanged(() => {
      void loadCommandCenter(true)
    })
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('keydown', openFromKeyboard)
      removeExternalListener?.()
    }
  }, [commandSnapshot?.activity.activeRunCount, loadCommandCenter])

  const loadAgents = useCallback(async () => {
    const request = ++agentListRequest.current
    setStatus('loading')
    setLoadError(undefined)
    try {
      const nextAgents = await window.studio.agents.statusList({ scope: agentScope })
      if (request !== agentListRequest.current) return
      setAgents(nextAgents)
      setStatus('ready')
    } catch (error) {
      if (request !== agentListRequest.current) return
      setLoadError(error instanceof Error ? error.message : '无法读取本地 Agent。')
      setStatus('error')
    }
  }, [agentScope])

  useEffect(() => {
    void loadAgents()
    const removeCreateListener = window.studio.menu.onCreateAgent(() => {
      setSaveError(undefined)
      setCreateOpen(true)
    })
    const removeSettingsListener = window.studio.menu.onOpenSettings(() => {
      openView('settings')
    })
    return () => {
      removeCreateListener()
      removeSettingsListener()
    }
  }, [loadAgents, openView])

  useEffect(() => {
    const match = /^#(?:stack|experiments|runs|publish):([0-9a-f-]{36})(?::conflicts)?$/.exec(
      window.location.hash,
    )
    if (!match?.[1] || didOpenCapturedStack) return
    setDidOpenCapturedStack(true)
    void openAgent(match[1])
  }, [didOpenCapturedStack])

  async function createAgent(input: CreateAgentInput): Promise<void> {
    setSaving(true)
    setSaveError(undefined)
    try {
      await window.studio.agents.create(input)
      setAgentScope('active')
      setAgents(await window.studio.agents.statusList({ scope: 'active' }))
      setCreateOpen(false)
      setListFeedback('Agent 已创建并保存到本机。')
      void loadCommandCenter()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '无法创建 Agent。')
    } finally {
      setSaving(false)
    }
  }

  function openCreate(): void {
    setSaveError(undefined)
    setCreateOpen(true)
  }

  async function openAgent(agentId: string): Promise<void> {
    const request = ++agentDetailRequest.current
    setStatus('loading')
    setLoadError(undefined)
    try {
      const [nextDetail, nextStatus] = await Promise.all([
        window.studio.agents.get(agentId),
        window.studio.agents.status(agentId),
      ])
      if (request !== agentDetailRequest.current) return
      setDetail(nextDetail)
      setDetailStatus(nextStatus)
      setStatus('ready')
    } catch (error) {
      if (request !== agentDetailRequest.current) return
      setLoadError(error instanceof Error ? error.message : '无法打开 Agent。')
      setStatus('error')
    }
  }

  async function startImport(): Promise<void> {
    setScanning(true)
    setImportError(undefined)
    try {
      const result = await window.studio.imports.selectAndScan()
      if (result.status === 'scanned') setScan(result.scan)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '无法扫描所选文件夹。')
    } finally {
      setScanning(false)
    }
  }

  async function confirmImport(): Promise<void> {
    if (!scan) return
    setImporting(true)
    setImportError(undefined)
    try {
      const imported = await window.studio.imports.confirm(scan.scanId)
      setScan(undefined)
      setDetail(imported)
      setDetailStatus(await window.studio.agents.status(imported.agent.id))
      await loadAgents()
      void loadCommandCenter()
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '无法导入项目。')
    } finally {
      setImporting(false)
    }
  }

  async function finishAgentLifecycle(
    scope: 'active' | 'archived',
    message: string,
  ): Promise<void> {
    setDetail(undefined)
    setAgentScope(scope)
    setAgents(await window.studio.agents.statusList({ scope }))
    setStatus('ready')
    setListFeedback(message)
    void loadCommandCenter()
    window.setTimeout(() => document.getElementById('agent-list-feedback')?.focus(), 0)
  }

  async function executeCommand(destination: CommandCenterDestination): Promise<void> {
    setCommandOpen(false)
    if (destination.kind === 'view') {
      openView(destination.view)
      return
    }
    if (destination.kind === 'agent') {
      openView('agents', false)
      await openAgent(destination.agentId)
      return
    }
    if (destination.kind === 'component') {
      openView('components')
      setSelectedComponentId(destination.componentId)
      return
    }
    if (destination.kind === 'run') {
      openView('runs')
      setSelectedRunId(destination.runId)
      return
    }
    if (destination.kind === 'experiment') {
      openView('experiments')
      setSelectedExperimentId(destination.experimentId)
      return
    }
    switch (destination.action) {
      case 'create-agent':
        openView('agents', false)
        openCreate()
        return
      case 'import-agent':
        openView('agents', false)
        await startImport()
        return
      case 'open-project':
      case 'create-project': {
        const projects = window.studio.studioProject
        if (!projects) {
          setCommandError('Studio 项目 API 不可用。')
          setCommandStatus('error')
          return
        }
        openView('project', false)
        try {
          if (destination.action === 'open-project') await projects.open()
          else await projects.init()
          await loadCommandCenter()
        } catch (error) {
          setCommandError(error instanceof Error ? error.message : '项目操作失败。')
          setCommandStatus('error')
        }
        return
      }
      case 'refresh':
        await Promise.all([loadAgents(), loadCommandCenter()])
    }
  }

  const workspace = commandSnapshot?.workspace
  const activity = commandSnapshot?.activity
  const activityLabel = activity
    ? activity.activeRunCount > 1
      ? `${activity.activeRunCount} 个 Run 进行中`
      : activity.latestRun
        ? runStatusLabels[activity.latestRun.status]
        : activityStatusLabels[activity.status]
    : commandStatus === 'error'
      ? '状态不可用'
      : '正在读取…'

  return (
    <div className={`app-shell${sidebarCollapsed ? ' app-shell--sidebar-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="topbar">
        <div className="topbar__traffic-space" aria-hidden="true" />
        <button
          aria-label={`当前工作空间：${workspace?.name ?? workspaceStatusLabels.empty}`}
          className="workspace-identity"
          onClick={() => openView('project')}
          type="button"
        >
          <span>工作空间</span>
          <strong>{workspace?.name ?? workspaceStatusLabels.empty}</strong>
          <small>
            {workspace?.revision === null || workspace?.revision === undefined
              ? '本地 Studio'
              : `revision ${workspace.revision} · ${workspaceStatusLabels[workspace.status]}`}
          </small>
        </button>
        <div className="topbar__commands">
          <button
            aria-label="搜索 Agent、组件、Run…"
            aria-keyshortcuts="Meta+K"
            className="topbar__search"
            onClick={() => setCommandOpen(true)}
            type="button"
          >
            <MagnifyingGlass aria-hidden="true" size={16} />
            <span>搜索 Agent、组件、Run…</span>
            <kbd>⌘K</kbd>
          </button>
          <button
            aria-label={`Run 状态：${activityLabel}`}
            className={`topbar__activity topbar__activity--${activity?.status ?? commandStatus}`}
            onClick={() => {
              openView('runs')
              setSelectedRunId(activity?.latestRun?.id)
            }}
            title={commandError}
            type="button"
          >
            {commandStatus === 'error' ? (
              <WarningCircle aria-hidden="true" size={16} />
            ) : (
              <PlayCircle
                aria-hidden="true"
                size={16}
                weight={activity?.activeRunCount ? 'fill' : 'regular'}
              />
            )}
            <span>{activityLabel}</span>
          </button>
          <button
            aria-label="创建 Agent"
            className="topbar__action"
            onClick={() => {
              openView('agents', false)
              openCreate()
            }}
            title="创建 Agent（⌘N）"
            type="button"
          >
            <Plus aria-hidden="true" size={16} weight="bold" />
          </button>
        </div>
      </header>

      <aside className="sidebar" aria-label="主导航">
        <div className="sidebar__main">
          <button
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-pressed={sidebarCollapsed}
            className="sidebar__toggle"
            onClick={() => {
              const next = !sidebarCollapsed
              setSidebarCollapsed(next)
              void persistRendererPreferences(view, next)
            }}
            type="button"
          >
            <SidebarSimple aria-hidden="true" size={18} />
            <span>{sidebarCollapsed ? '展开' : '收起'}</span>
          </button>
          <nav>
            {navigation.map(({ id, label, icon: Icon, enabled }) => {
              const active = id === view && !detail
              return (
                <button
                  aria-current={active ? 'page' : undefined}
                  aria-label={label}
                  className="nav-item"
                  disabled={!enabled}
                  key={label}
                  onClick={() => {
                    if (
                      id === 'agents' ||
                      id === 'project' ||
                      id === 'discovery' ||
                      id === 'components' ||
                      id === 'experiments' ||
                      id === 'runs' ||
                      id === 'settings'
                    ) {
                      openView(id)
                    }
                  }}
                  type="button"
                >
                  <Icon aria-hidden="true" size={19} weight={active ? 'fill' : 'regular'} />
                  <span>{label}</span>
                </button>
              )
            })}
          </nav>
        </div>
        <p className="sidebar__note">本地优先。发布始终需要明确确认。</p>
      </aside>

      <main className="content" id="main-content" tabIndex={-1}>
        {preferenceError ? (
          <div className="preference-warning" role="alert">
            <span>界面偏好未保存：{preferenceError}</span>
            <button onClick={() => setPreferenceError(undefined)} type="button">
              关闭
            </button>
          </div>
        ) : null}
        {view === 'project' && !detail ? <StudioProjectView /> : null}
        {view === 'discovery' && !detail ? <SourceDiscoveryView /> : null}
        {view === 'components' && !detail ? (
          <ComponentCatalogView initialComponentId={selectedComponentId} />
        ) : null}
        {view === 'experiments' && !detail ? (
          <ExperimentsView experimentId={selectedExperimentId} />
        ) : null}
        {view === 'runs' && !detail ? <RunsView runId={selectedRunId} /> : null}
        {view === 'settings' && !detail ? <SettingsView /> : null}
        {view === 'agents' && detail && detailStatus ? (
          <AgentDetailView
            initialDetail={detail}
            initialStatus={detailStatus}
            onBack={() => {
              setDetail(undefined)
              setDetailStatus(undefined)
              void loadAgents()
            }}
            onChanged={loadAgents}
            onLifecycle={finishAgentLifecycle}
          />
        ) : null}
        {view === 'agents' && !detail ? (
          <>
            <header className="page-header">
              <div>
                <h1>Agent</h1>
                <p>管理保存在这台 Mac 上的 Agent 与 Stack。</p>
              </div>
              <div className="page-header__actions">
                <button
                  aria-pressed={agentScope === 'archived'}
                  className="button button--quiet"
                  onClick={() => {
                    setDetail(undefined)
                    setListFeedback(undefined)
                    setAgentScope(agentScope === 'active' ? 'archived' : 'active')
                  }}
                  type="button"
                >
                  {agentScope === 'active' ? '查看已归档' : '返回现有 Agent'}
                </button>
                <button
                  className="button button--secondary"
                  disabled={isScanning}
                  onClick={() => void startImport()}
                  type="button"
                >
                  <UploadSimple aria-hidden="true" size={17} />
                  {isScanning ? '正在检查…' : '导入项目'}
                </button>
                <button className="button button--primary" onClick={openCreate} type="button">
                  <Plus aria-hidden="true" size={17} weight="bold" />
                  创建 Agent
                </button>
              </div>
            </header>

            {status === 'loading' ? (
              <section aria-busy="true" aria-label="正在载入 Agent" className="loading-state">
                <div className="skeleton skeleton--title" />
                <div className="skeleton" />
                <div className="skeleton" />
              </section>
            ) : null}

            {status === 'error' ? (
              <section className="state-panel state-panel--error" role="alert">
                <div className="state-panel__icon">
                  <ArrowClockwise aria-hidden="true" size={24} />
                </div>
                <h2>无法载入 Agent</h2>
                <p>{loadError}</p>
                <button
                  className="button button--secondary"
                  onClick={() => void loadAgents()}
                  type="button"
                >
                  重试
                </button>
              </section>
            ) : null}

            {listFeedback ? (
              <div
                className="detail-feedback list-feedback"
                id="agent-list-feedback"
                role="status"
                tabIndex={-1}
              >
                {listFeedback}
              </div>
            ) : null}

            {status === 'ready' && agents.length === 0 && agentScope === 'active' ? (
              <section className="empty-state">
                <div className="empty-state__mark" aria-hidden="true">
                  <Robot size={32} weight="duotone" />
                </div>
                <h2>创建你的第一个本地 Agent</h2>
                <p>
                  你可以创建一个空白 Agent，或导入项目进行静态检查。未经你的允许，Studio
                  不会运行导入项目中的代码。
                </p>
                <div className="empty-state__actions">
                  <button className="button button--primary" onClick={openCreate} type="button">
                    <Plus aria-hidden="true" size={17} weight="bold" />
                    创建空白 Agent
                  </button>
                  <button
                    className="button button--secondary"
                    disabled={isScanning}
                    onClick={() => void startImport()}
                    type="button"
                  >
                    <UploadSimple aria-hidden="true" size={17} />
                    {isScanning ? '正在检查文件夹…' : '导入本地项目'}
                  </button>
                </div>
                <p className="keyboard-hint">
                  按下 <kbd>⌘</kbd>
                  <kbd>N</kbd> 创建 Agent。
                </p>
              </section>
            ) : null}

            {status === 'ready' && agents.length === 0 && agentScope === 'archived' ? (
              <section className="empty-state">
                <div className="empty-state__mark" aria-hidden="true">
                  <Robot size={32} weight="duotone" />
                </div>
                <h2>没有已归档 Agent</h2>
                <p>归档会从现有列表移除 Agent，但保留版本、运行、实验和发布历史。</p>
                <button
                  className="button button--secondary"
                  onClick={() => setAgentScope('active')}
                  type="button"
                >
                  返回现有 Agent
                </button>
              </section>
            ) : null}

            {status === 'ready' && agents.length > 0 ? (
              <section aria-label={`${agents.length} 个本地 Agent`} className="agent-list">
                <div className="agent-list__heading">
                  <span>
                    {agents.length} 个{agentScope === 'archived' ? '已归档' : '本地'} Agent
                  </span>
                  <span>{agentScope === 'archived' ? '历史保持只读可追溯' : '按最新创建排序'}</span>
                </div>
                <ul>
                  {agents.map((projection) => (
                    <li key={projection.agent.id}>
                      <button
                        className="agent-row"
                        onClick={() => void openAgent(projection.agent.id)}
                        type="button"
                      >
                        <span className="agent-row__mark" aria-hidden="true">
                          {projection.agent.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="agent-row__body">
                          <strong>{projection.agent.name}</strong>
                          <small>{projection.agent.description || '暂无描述'}</small>
                        </span>
                        <span className="agent-row__mode">
                          {executionModeLabels[projection.agent.executionMode]}
                        </span>
                        <span className="agent-row__facts">
                          <small>
                            {projection.currentVersion
                              ? `版本 ${projection.currentVersion.versionNumber}`
                              : '无版本'}{' '}
                            · 草稿修订 {projection.draftRevision}
                          </small>
                          <small>
                            Stack {stackStatusLabels[projection.stack.status]} ·{' '}
                            {projection.stack.componentCount} 个组件 · {projection.stack.issueCount}{' '}
                            个问题
                          </small>
                        </span>
                        <span className="agent-row__facts">
                          <small>
                            最近 Run：
                            {projection.latestRun
                              ? runStatusLabels[projection.latestRun.status]
                              : '无记录'}
                          </small>
                          <small>
                            发布：
                            {projection.latestPublish
                              ? publishStatusLabels[projection.latestPublish.status]
                              : '未发布'}
                          </small>
                        </span>
                        <span className="status-label">
                          {projection.agent.archivedAt ? '已归档' : '本地'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {importError && !scan ? (
              <div className="detail-feedback detail-feedback--error list-feedback" role="alert">
                {importError}
              </div>
            ) : null}
          </>
        ) : null}
      </main>

      {isCommandOpen ? (
        <CommandPalette
          onClose={() => setCommandOpen(false)}
          onSelect={(destination) => void executeCommand(destination)}
        />
      ) : null}
      {isCreateOpen ? (
        <CreateAgentDialog
          error={saveError}
          isSaving={isSaving}
          onCancel={() => setCreateOpen(false)}
          onSubmit={createAgent}
        />
      ) : null}
      {scan ? (
        <ImportProjectDialog
          error={importError}
          isImporting={isImporting}
          onCancel={() => setScan(undefined)}
          onConfirm={() => void confirmImport()}
          scan={scan}
        />
      ) : null}
    </div>
  )
}
