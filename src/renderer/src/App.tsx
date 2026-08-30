import {
  ArrowClockwise,
  Cube,
  GearSix,
  HardDrives,
  Plus,
  Robot,
  UploadSimple,
  MagnifyingGlass,
  PaperPlaneTilt,
  PlayCircle,
  SidebarSimple,
  WarningCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentDetail } from '../../shared/agent-detail'
import type { AgentStatusProjection } from '../../shared/agent-status'
import {
  agentSetupSteps,
  type AgentSetupSession,
  type AgentSetupStep,
} from '../../shared/agent-setup'
import type { ImportScan } from '../../shared/import'
import { AgentDetailView } from './components/AgentDetailView'
import { ComponentCatalogView } from './components/ComponentCatalogView'
import { CommandPalette } from './components/CommandPalette'
import { AgentBuilderView } from './components/AgentBuilderView'
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
  { id: 'agents', label: 'Agent', icon: Robot, enabled: true },
  { id: 'components', label: '组件', icon: Cube, enabled: true },
  { id: 'runs', label: '运行', icon: HardDrives, enabled: true },
  { id: 'publish', label: '发布', icon: PaperPlaneTilt, enabled: true },
  { id: 'settings', label: '设置', icon: GearSix, enabled: true },
] as const

const setupStepLabels: Record<AgentSetupStep, string> = {
  basics: '基本信息',
  harness: 'Harness',
  model: '模型',
  capabilities: '能力',
  review: '完成检查',
}

function viewFromHash(hash: string): AppView | null {
  if (hash === '#project') return 'project'
  if (hash === '#discovery') return 'discovery'
  if (hash === '#components') return 'components'
  if (hash === '#publish') return 'publish'
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
  const [isBuilderOpen, setBuilderOpen] = useState(false)
  const [builderSessionId, setBuilderSessionId] = useState<string>()
  const [setupSessions, setSetupSessions] = useState<AgentSetupSession[]>([])
  const [firstChatAgentId, setFirstChatAgentId] = useState<string>()
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
  const builderReturnFocusId = useRef('create-agent-header')

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
      if (!isBuilderOpen && event.metaKey && event.key.toLocaleLowerCase('en-US') === 'k') {
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
  }, [commandSnapshot?.activity.activeRunCount, isBuilderOpen, loadCommandCenter])

  useEffect(() => {
    const openComponent = (event: Event) => {
      const componentId = (event as CustomEvent<{ componentId?: string }>).detail?.componentId
      if (!componentId) return
      openView('components')
      setSelectedComponentId(componentId)
    }
    window.addEventListener('studio:navigate-component', openComponent)
    return () => window.removeEventListener('studio:navigate-component', openComponent)
  }, [openView])

  useEffect(() => {
    const openLibrary = (event: Event) => {
      const nextView = (event as CustomEvent<'components' | 'discovery'>).detail
      if (nextView === 'components' || nextView === 'discovery') openView(nextView)
    }
    window.addEventListener('studio:navigate-library', openLibrary)
    return () => window.removeEventListener('studio:navigate-library', openLibrary)
  }, [openView])

  const loadAgents = useCallback(
    async (showLoading = true) => {
      const request = ++agentListRequest.current
      if (showLoading) setStatus('loading')
      setLoadError(undefined)
      try {
        const [nextAgents, nextSetups] = await Promise.all([
          window.studio.agents.statusList({ scope: agentScope }),
          agentScope === 'active' && window.studio.agentSetup
            ? window.studio.agentSetup.list()
            : Promise.resolve([]),
        ])
        if (request !== agentListRequest.current) return
        setAgents(nextAgents)
        setSetupSessions(nextSetups)
        setStatus('ready')
      } catch (error) {
        if (request !== agentListRequest.current) return
        setLoadError(error instanceof Error ? error.message : '无法读取本地 Agent。')
        setStatus('error')
      }
    },
    [agentScope],
  )

  useEffect(() => {
    void loadAgents()
    const removeCreateListener = window.studio.menu.onCreateAgent(() => {
      openCreate()
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

  function openCreate(): void {
    builderReturnFocusId.current =
      document.activeElement instanceof HTMLElement && document.activeElement.id
        ? document.activeElement.id
        : 'create-agent-header'
    setDetail(undefined)
    setDetailStatus(undefined)
    setBuilderSessionId(undefined)
    setBuilderOpen(true)
    setListFeedback(undefined)
  }

  function resumeSetup(id: string): void {
    builderReturnFocusId.current = `resume-setup-${id}`
    setDetail(undefined)
    setDetailStatus(undefined)
    setBuilderSessionId(id)
    setBuilderOpen(true)
    setListFeedback(undefined)
  }

  async function completeSetup(agentId: string): Promise<void> {
    setBuilderOpen(false)
    setBuilderSessionId(undefined)
    setAgentScope('active')
    setFirstChatAgentId(agentId)
    window.location.hash = `runs:${agentId}`
    await loadAgents()
    await openAgent(agentId)
    setListFeedback('Agent 已创建。现在可以开始首次聊天；冻结版本仍是独立操作。')
    void loadCommandCenter()
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
          setCommandError('项目设置 API 不可用。')
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
          aria-label={`当前项目：${workspace?.name ?? workspaceStatusLabels.empty}；打开项目设置`}
          className="workspace-identity"
          disabled={isBuilderOpen}
          onClick={() => openView('project')}
          type="button"
        >
          <span>当前项目</span>
          <strong>{workspace?.name ?? workspaceStatusLabels.empty}</strong>
          <small>
            {workspace?.revision === null || workspace?.revision === undefined
              ? '点击打开或创建'
              : `revision ${workspace.revision} · ${workspaceStatusLabels[workspace.status]}`}
          </small>
        </button>
        <div className="topbar__commands">
          <button
            aria-label="搜索 Agent、组件、Run…"
            aria-keyshortcuts="Meta+K"
            className="topbar__search"
            disabled={isBuilderOpen}
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
            disabled={isBuilderOpen}
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
            disabled={isBuilderOpen}
            id="create-agent-topbar"
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
                  disabled={!enabled || isBuilderOpen}
                  key={label}
                  onClick={() => {
                    if (
                      id === 'agents' ||
                      id === 'components' ||
                      id === 'runs' ||
                      id === 'publish' ||
                      id === 'settings'
                    ) {
                      if (id === 'publish') setAgentScope('active')
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
        {isBuilderOpen ? (
          <AgentBuilderView
            onCompleted={completeSetup}
            onExit={(message) => {
              setBuilderOpen(false)
              setBuilderSessionId(undefined)
              if (message) setListFeedback(message)
              void loadAgents(false)
              window.setTimeout(
                () => document.getElementById(builderReturnFocusId.current)?.focus(),
                0,
              )
            }}
            sessionId={builderSessionId}
          />
        ) : null}
        {!isBuilderOpen && view === 'project' && !detail ? <StudioProjectView /> : null}
        {!isBuilderOpen && view === 'discovery' && !detail ? <SourceDiscoveryView /> : null}
        {!isBuilderOpen && view === 'components' && !detail ? (
          <ComponentCatalogView
            initialComponentId={selectedComponentId}
            onOpenDiscovery={() => openView('discovery')}
          />
        ) : null}
        {!isBuilderOpen && view === 'experiments' && !detail ? (
          <ExperimentsView experimentId={selectedExperimentId} />
        ) : null}
        {!isBuilderOpen && view === 'runs' && !detail ? <RunsView runId={selectedRunId} /> : null}
        {!isBuilderOpen && view === 'publish' && !detail ? (
          <>
            <header className="page-header">
              <div>
                <h1>发布</h1>
                <p>选择一个 Agent，检查冻结版本后再明确发布到 Multica。</p>
              </div>
            </header>
            {status === 'loading' ? (
              <section aria-busy="true" aria-label="正在载入可发布 Agent" className="loading-state">
                <div className="skeleton skeleton--title" />
                <div className="skeleton" />
              </section>
            ) : null}
            {status === 'error' ? (
              <section className="state-panel state-panel--error" role="alert">
                <WarningCircle aria-hidden="true" size={24} />
                <h2>无法读取可发布 Agent</h2>
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
            {status === 'ready' && agents.length === 0 ? (
              <section className="empty-state">
                <div className="empty-state__mark" aria-hidden="true">
                  <PaperPlaneTilt size={32} weight="duotone" />
                </div>
                <h2>还没有可发布的 Agent</h2>
                <p>先创建 Agent、选择 Harness 和组件，并冻结一个不可变版本。</p>
                <button
                  className="button button--primary"
                  onClick={() => openView('agents')}
                  type="button"
                >
                  前往 Agent
                </button>
              </section>
            ) : null}
            {status === 'ready' && agents.length > 0 ? (
              <section aria-label="选择要发布的 Agent" className="agent-list publish-agent-list">
                <div className="agent-list__heading">
                  <span>{agents.length} 个本地 Agent</span>
                  <span>发布只使用冻结版本，不会共享本地草稿</span>
                </div>
                <ul>
                  {agents.map((projection) => (
                    <li key={projection.agent.id}>
                      <button
                        className="agent-row"
                        onClick={() => {
                          window.location.hash = `publish:${projection.agent.id}`
                          void openAgent(projection.agent.id)
                        }}
                        type="button"
                      >
                        <span className="agent-row__mark" aria-hidden="true">
                          {projection.agent.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="agent-row__body">
                          <strong>{projection.agent.name}</strong>
                          <small>{projection.agent.description || '暂无描述'}</small>
                        </span>
                        <span className="agent-row__facts">
                          <small>
                            {projection.currentVersion
                              ? `冻结版本 ${projection.currentVersion.versionNumber}`
                              : '尚无冻结版本'}
                          </small>
                          <small>
                            {projection.latestPublish
                              ? `最近发布：${publishStatusLabels[projection.latestPublish.status]}`
                              : '尚未发布'}
                          </small>
                        </span>
                        <span className="status-label">
                          {projection.currentVersion ? '检查并发布' : '需要先冻结'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
        {!isBuilderOpen && view === 'settings' && !detail ? <SettingsView /> : null}
        {!isBuilderOpen && (view === 'agents' || view === 'publish') && detail && detailStatus ? (
          <AgentDetailView
            firstChat={detail.agent.id === firstChatAgentId}
            initialDetail={detail}
            initialStatus={detailStatus}
            onBack={() => {
              setDetail(undefined)
              setDetailStatus(undefined)
              if (view === 'publish') window.location.hash = 'publish'
              void loadAgents()
            }}
            onChanged={loadAgents}
            onLifecycle={finishAgentLifecycle}
          />
        ) : null}
        {!isBuilderOpen && view === 'agents' && !detail ? (
          <>
            <header className="page-header">
              <div>
                <h1>Agent</h1>
                <p>选择 Harness，添加能力，然后聊天、运行或冻结发布版本。</p>
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
                <button
                  className="button button--primary"
                  id="create-agent-header"
                  onClick={openCreate}
                  type="button"
                >
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

            {status === 'ready' &&
            agents.length === 0 &&
            setupSessions.length === 0 &&
            agentScope === 'active' ? (
              <section className="empty-state">
                <div className="empty-state__mark" aria-hidden="true">
                  <Robot size={32} weight="duotone" />
                </div>
                <h2>创建你的第一个本地 Agent</h2>
                <p>
                  先创建一个 Agent，再选择受支持的 Harness
                  和需要的能力。也可以导入本地项目进行静态检查；未经你的允许，Studio
                  不会运行其中的代码。
                </p>
                <div className="empty-state__actions">
                  <button
                    className="button button--primary"
                    id="create-agent-empty"
                    onClick={openCreate}
                    type="button"
                  >
                    <Plus aria-hidden="true" size={17} weight="bold" />
                    引导创建 Agent
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

            {status === 'ready' && setupSessions.length > 0 && agentScope === 'active' ? (
              <section aria-label={`${setupSessions.length} 个未完成设置`} className="setup-list">
                <div className="agent-list__heading">
                  <span>{setupSessions.length} 个设置未完成</span>
                  <span>只保存非敏感选择，不是已创建 Agent</span>
                </div>
                <ul>
                  {setupSessions.map((session) => (
                    <li key={session.id}>
                      <button
                        className="setup-row"
                        id={`resume-setup-${session.id}`}
                        onClick={() => resumeSetup(session.id)}
                        type="button"
                      >
                        <span className="setup-row__progress">
                          {String(agentSetupSteps.indexOf(session.step) + 1).padStart(2, '0')} / 05
                        </span>
                        <span className="agent-row__body">
                          <strong>{session.name.trim() || '未命名 Agent'}</strong>
                          <small>
                            {session.description || `停在“${setupStepLabels[session.step]}”`}
                          </small>
                        </span>
                        <span className="status-label status-label--saved">设置未完成</span>
                        <span className="setup-row__action">继续设置</span>
                      </button>
                    </li>
                  ))}
                </ul>
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
                            Stack/兼容性：{stackStatusLabels[projection.stack.status]} ·{' '}
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
