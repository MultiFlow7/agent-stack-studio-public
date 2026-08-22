import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '../../shared/agent'
import type { AgentDetail } from '../../shared/agent-detail'
import type { AgentStatusProjection } from '../../shared/agent-status'
import type { StudioApi } from '../../shared/ipc'
import type { DataLocation } from '../../shared/maintenance'
import { App } from './App'

const createdAgent: Agent = {
  id: '92d74aaf-b86c-4e84-978b-b35d227e0c79',
  name: 'Research Agent',
  description: 'Runs local evaluations.',
  executionMode: 'agent-loop',
  archivedAt: null,
  createdAt: '2026-08-19T04:00:00.000Z',
  updatedAt: '2026-08-19T04:00:00.000Z',
}

const createdDetail: AgentDetail = {
  agent: createdAgent,
  draft: {
    agentId: createdAgent.id,
    executionMode: 'agent-loop',
    revision: 1,
    updatedAt: createdAgent.updatedAt,
  },
  versions: [],
  location: {
    workspacePath: '/tmp/workspaces/research-agent',
    sourceKind: 'blank',
    sourcePath: null,
  },
}

const createdStatus: AgentStatusProjection = {
  agent: createdAgent,
  draftRevision: 1,
  currentVersion: null,
  stack: { status: 'blocked', componentCount: 0, ownerCount: 0, issueCount: 1 },
  latestRun: null,
  latestExperiment: null,
  latestPublish: null,
}

function installApi(
  overrides: Partial<StudioApi['agents']> = {},
  commandCenterOverrides: Partial<StudioApi['commandCenter']> = {},
) {
  let created = false
  const create = vi.fn(() => {
    created = true
    return Promise.resolve(createdAgent)
  })
  const list = vi.fn(() => Promise.resolve(created ? [createdAgent] : []))
  const statusList = vi.fn(() => Promise.resolve(created ? [createdStatus] : []))
  const sourceSearch = vi.fn<StudioApi['discovery']['search']>()
  const preferenceGet = vi.fn<StudioApi['preferences']['get']>(() =>
    Promise.resolve({ sidebarCollapsed: false, lastView: 'agents' }),
  )
  const preferenceUpdate = vi.fn<StudioApi['preferences']['update']>((input) =>
    Promise.resolve(input),
  )
  const commandSnapshot = vi.fn<StudioApi['commandCenter']['snapshot']>(() =>
    Promise.resolve({
      workspace: { status: 'empty', name: null, revision: null, issueCount: 0 },
      activity: { status: 'idle', activeRunCount: 0, latestRun: null },
      counts: {
        activeAgents: 0,
        archivedAgents: 0,
        components: 0,
        runs: 0,
        experiments: 0,
      },
      refreshedAt: '2026-08-21T01:02:00.000Z',
    }),
  )
  const commandSearch = vi.fn<StudioApi['commandCenter']['search']>(() => Promise.resolve([]))
  const api: StudioApi = {
    agents: {
      create,
      list,
      statusList,
      status: vi.fn(() => Promise.resolve(createdStatus)),
      get: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      update: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      duplicate: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      archive: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      restore: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      delete: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      createVersion: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      ...overrides,
    },
    secrets: {
      list: vi.fn(() => Promise.resolve([])),
      configure: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      delete: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
    },
    imports: {
      selectAndScan: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
      confirm: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
    },
    components: {
      list: vi.fn(() => Promise.resolve([])),
      catalog: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      getStack: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      addToStack: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      removeFromStack: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      selectOwner: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
    },
    runs: {
      start: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      list: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      cancel: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
    },
    experiments: {
      create: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      list: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      refreshDrift: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      start: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      cancel: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      export: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
    },
    publishing: {
      targets: vi.fn(() => Promise.resolve([])),
      preview: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      publish: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      history: vi.fn(() => Promise.resolve({ mapping: null, receipts: [] })),
    },
    maintenance: {
      status: vi.fn(() =>
        Promise.resolve({
          applicationVersion: '0.2.0',
          databaseSchemaVersion: 6,
          supportedDatabaseSchemaVersion: 6,
          pendingRestore: false,
          lastRestoreAt: null,
          packaged: false,
          platform: 'darwin' as const,
          dataLocations: [
            {
              id: 'application-support',
              label: 'Application Support',
              path: '/tmp/studio',
              kind: 'directory',
              purpose: '根目录',
              includedInBackup: false,
            },
            {
              id: 'database',
              label: 'SQLite',
              path: '/tmp/studio/studio.sqlite3',
              kind: 'file',
              purpose: '数据库',
              includedInBackup: true,
            },
            {
              id: 'workspaces',
              label: 'Workspaces',
              path: '/tmp/studio/workspaces',
              kind: 'directory',
              purpose: '工作空间',
              includedInBackup: true,
            },
            {
              id: 'artifacts',
              label: 'Artifacts',
              path: '/tmp/studio/artifacts',
              kind: 'directory',
              purpose: '产物',
              includedInBackup: true,
            },
            {
              id: 'recovery',
              label: 'Recovery',
              path: '/tmp/studio/recovery',
              kind: 'directory',
              purpose: '回滚',
              includedInBackup: false,
            },
            {
              id: 'logs',
              label: 'Logs',
              path: '/tmp/studio/logs',
              kind: 'directory',
              purpose: '日志',
              includedInBackup: false,
            },
          ] satisfies DataLocation[],
        }),
      ),
      createBackup: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
      selectRestore: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
      applyRestore: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      revealDataLocation: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
    },
    preferences: {
      get: preferenceGet,
      update: preferenceUpdate,
    },
    commandCenter: {
      snapshot: commandCenterOverrides.snapshot ?? commandSnapshot,
      search: commandCenterOverrides.search ?? commandSearch,
    },
    discovery: {
      search: sourceSearch,
      inspect: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      handoff: vi.fn(() => Promise.reject(new Error('Not used in this test.'))),
      cancel: vi.fn(() => Promise.resolve({ cancelled: false })),
      copy: vi.fn(() => Promise.resolve()),
      open: vi.fn(() => Promise.resolve()),
    },
    menu: {
      onCreateAgent: vi.fn(() => () => undefined),
      onOpenSettings: vi.fn(() => () => undefined),
    },
  }
  window.studio = api
  return {
    api,
    create,
    list,
    statusList,
    sourceSearch,
    preferenceGet,
    preferenceUpdate,
    commandSnapshot,
    commandSearch,
  }
}

describe('App', () => {
  beforeEach(() => {
    window.location.hash = ''
    installApi()
  })

  it('shows both local starting paths in the empty state', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: '创建你的第一个本地 Agent' })).toBeVisible()
    expect(screen.getByRole('button', { name: '创建空白 Agent' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导入本地项目' })).toBeEnabled()
  })

  it('shows the real Studio project and active Run in the application topbar', async () => {
    installApi(
      {},
      {
        snapshot: vi.fn<StudioApi['commandCenter']['snapshot']>(() =>
          Promise.resolve({
            workspace: {
              status: 'blocked',
              name: 'Research Stack',
              revision: 7,
              issueCount: 2,
            },
            activity: {
              status: 'active',
              activeRunCount: 1,
              latestRun: {
                id: 'd5f4d198-02db-46e5-8156-5a888f23ceef',
                agentId: createdAgent.id,
                status: 'running',
                updatedAt: '2026-08-21T01:00:00.000Z',
              },
            },
            counts: {
              activeAgents: 1,
              archivedAgents: 0,
              components: 2,
              runs: 1,
              experiments: 0,
            },
            refreshedAt: '2026-08-21T01:02:00.000Z',
          }),
        ),
      },
    )
    render(<App />)

    expect(
      await screen.findByRole('button', {
        name: '当前项目：Research Stack；打开项目设置',
      }),
    ).toHaveTextContent('revision 7 · 项目已阻断')
    expect(screen.getByRole('button', { name: 'Run 状态：运行中' })).toBeEnabled()
  })

  it('opens global search with Command-K and navigates to a local Agent from the keyboard', async () => {
    const search = vi.fn<StudioApi['commandCenter']['search']>(() =>
      Promise.resolve([
        {
          id: `agent:${createdAgent.id}`,
          category: 'agent',
          label: createdAgent.name,
          detail: 'Agent · 草稿修订 1',
          destination: { kind: 'agent', agentId: createdAgent.id },
        },
      ]),
    )
    installApi(
      {
        statusList: vi.fn(() => Promise.resolve([createdStatus])),
        get: vi.fn(() => Promise.resolve(createdDetail)),
        status: vi.fn(() => Promise.resolve(createdStatus)),
      },
      { search },
    )
    const user = userEvent.setup()
    render(<App />)

    await user.keyboard('{Meta>}k{/Meta}')
    const input = await screen.findByRole('combobox', { name: '搜索本地工作空间' })
    await user.type(input, 'Research')
    await screen.findByRole('option', { name: /Research Agent/ })
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { name: 'Research Agent' })).toBeVisible()
    expect(search).toHaveBeenLastCalledWith({ query: 'Research' })
  })

  it('executes an application action from global search and keeps summary failures non-blocking', async () => {
    const search = vi.fn<StudioApi['commandCenter']['search']>(() =>
      Promise.resolve([
        {
          id: 'action:create-agent',
          category: 'action',
          label: '创建 Agent',
          detail: '创建新的本地 Agent 草稿',
          destination: { kind: 'action', action: 'create-agent' },
        },
      ]),
    )
    installApi(
      {},
      {
        snapshot: vi.fn<StudioApi['commandCenter']['snapshot']>(() =>
          Promise.reject(new Error('状态索引暂时不可用。')),
        ),
        search,
      },
    )
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Run 状态：状态不可用' })).toHaveAttribute(
      'title',
      '状态索引暂时不可用。',
    )
    await user.keyboard('{Meta>}k{/Meta}')
    await screen.findByRole('option', { name: /创建 Agent/ })
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: '创建 Agent' })).toBeVisible()
  })

  it('creates an Agent and reads it back into the list', async () => {
    const { create, statusList } = installApi()
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '创建空白 Agent' }))
    await user.type(screen.getByLabelText('名称'), 'Research Agent')
    await user.type(screen.getByLabelText('描述'), 'Runs local evaluations.')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '创建 Agent' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Research Agent',
        description: 'Runs local evaluations.',
        executionMode: 'agent-loop',
      }),
    )
    expect(await screen.findByText('Research Agent')).toBeVisible()
    expect(statusList).toHaveBeenCalledTimes(2)
  })

  it('traps dialog focus and returns it to the creating control on Escape', async () => {
    const user = userEvent.setup()
    render(<App />)

    const opener = await screen.findByRole('button', { name: '创建空白 Agent' })
    await user.click(opener)
    const name = screen.getByLabelText('名称')
    expect(name).toHaveFocus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: '创建 Agent' }),
    ).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('keeps the failure contextual and offers a retry', async () => {
    installApi({ statusList: vi.fn().mockRejectedValue(new Error('数据库暂时不可用。')) })
    render(<App />)

    expect(await screen.findByRole('heading', { name: '无法载入 Agent' })).toBeVisible()
    expect(screen.getByText('数据库暂时不可用。')).toBeVisible()
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
  })

  it('shows the same real status projection in the Agent list and overview', async () => {
    const richStatus: AgentStatusProjection = {
      ...createdStatus,
      draftRevision: 4,
      currentVersion: {
        id: '3b129300-9e8a-4a70-ae02-e2dc1cba565e',
        versionNumber: 2,
        createdAt: '2026-08-20T02:00:00.000Z',
      },
      stack: { status: 'ready', componentCount: 2, ownerCount: 1, issueCount: 0 },
      latestRun: {
        id: 'd5f4d198-02db-46e5-8156-5a888f23ceef',
        status: 'succeeded',
        updatedAt: '2026-08-20T04:00:00.000Z',
      },
      latestExperiment: {
        id: 'c64105e1-cb83-48c4-b53c-9ab2a66d441f',
        name: 'Latency baseline',
        status: 'completed',
        updatedAt: '2026-08-20T05:00:00.000Z',
      },
      latestPublish: {
        targetId: 'studio://publishers/multica-contract-test',
        targetLabel: '本地 Contract Test Target',
        status: 'succeeded',
        occurredAt: '2026-08-20T06:00:00.000Z',
      },
    }
    installApi({
      statusList: vi.fn(() => Promise.resolve([richStatus])),
      status: vi.fn(() => Promise.resolve(richStatus)),
      get: vi.fn(() => Promise.resolve(createdDetail)),
    })
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText(/版本 2 · 草稿修订 4/)).toBeVisible()
    expect(screen.getByText(/Stack 就绪 · 2 个组件 · 0 个问题/)).toBeVisible()
    expect(screen.getByText('最近 Run：已完成')).toBeVisible()
    expect(screen.getByText('发布：已成功')).toBeVisible()

    await user.click(screen.getByRole('button', { name: /Research Agent/ }))
    expect(await screen.findByText('Stack 就绪')).toBeVisible()
    expect(screen.getByText('就绪 · 2 个组件 · 1 个 Owner · 0 个未解决问题')).toBeVisible()
    expect(screen.getByText(/Latency baseline · 已完成/)).toBeVisible()
    expect(screen.getByText(/本地 Contract Test Target · 已成功/)).toBeVisible()
  })

  it('exposes the skip link and opens application settings from the keyboard', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('link', { name: '跳到主要内容' })).toHaveAttribute(
      'href',
      '#main-content',
    )
    const settings = screen.getByRole('button', { name: '设置' })
    settings.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: '设置' })).toBeVisible()
  })

  it('restores the last view and collapsed sidebar, then persists keyboard changes', async () => {
    const { preferenceGet, preferenceUpdate } = installApi()
    preferenceGet.mockResolvedValue({ sidebarCollapsed: true, lastView: 'settings' })
    const user = userEvent.setup()
    const { container } = render(<App />)

    expect(await screen.findByRole('heading', { name: '设置' })).toBeVisible()
    expect(container.querySelector('.app-shell')).toHaveClass('app-shell--sidebar-collapsed')
    const expand = screen.getByRole('button', { name: '展开侧边栏' })
    expand.focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(preferenceUpdate).toHaveBeenCalledWith({
        lastView: 'settings',
        sidebarCollapsed: false,
      }),
    )

    const runs = screen.getByRole('button', { name: '运行记录' })
    runs.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: '运行记录' })).toBeVisible()
    expect(preferenceUpdate).toHaveBeenLastCalledWith({
      lastView: 'runs',
      sidebarCollapsed: false,
    })
  })

  it('uses safe defaults and reports a preference loading failure without blocking the app', async () => {
    const { preferenceGet } = installApi()
    preferenceGet.mockRejectedValue(new Error('偏好数据损坏。'))
    render(<App />)

    expect(await screen.findByRole('heading', { name: '创建你的第一个本地 Agent' })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('界面偏好未保存：偏好数据损坏。')
  })

  it('opens public source discovery without starting a network request', async () => {
    const { sourceSearch } = installApi()
    const user = userEvent.setup()
    render(<App />)

    const discovery = screen.getByRole('button', { name: '发现' })
    discovery.focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { name: '发现组件来源' })).toBeVisible()
    expect(screen.getByText('不下载，不执行代码')).toBeVisible()
    expect(sourceSearch).not.toHaveBeenCalled()
  })

  it('opens an Agent detail and creates an immutable version', async () => {
    const version = {
      id: '17f02e9c-a70d-4dc1-ab5f-38ceda423025',
      agentId: createdAgent.id,
      versionNumber: 1,
      snapshot: {
        agent: {
          id: createdAgent.id,
          name: createdAgent.name,
          description: createdAgent.description,
          executionMode: createdAgent.executionMode,
        },
        stack: {
          executionMode: 'agent-loop' as const,
          revision: 1,
          components: [],
          capabilityOwners: [],
        },
      },
      contentHash: 'a'.repeat(64),
      createdAt: createdAgent.createdAt,
    }
    let detail = createdDetail
    installApi({
      statusList: vi.fn(() => Promise.resolve([createdStatus])),
      get: vi.fn(() => Promise.resolve(detail)),
      createVersion: vi.fn(() => {
        detail = { ...detail, versions: [version] }
        return Promise.resolve(version)
      }),
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Research Agent/ }))
    expect(await screen.findByRole('heading', { name: 'Research Agent' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '冻结 Agent Version' }))

    expect(await screen.findAllByText('版本 1')).toHaveLength(2)
    expect(screen.getByText('已冻结不可变 Agent Version 1。')).toBeVisible()
  })

  it('duplicates and archives an Agent through keyboard-reachable detail actions', async () => {
    const duplicate = {
      ...createdDetail,
      agent: {
        ...createdAgent,
        id: 'bd280f8f-f256-42f7-a603-eaf65a42f345',
        name: 'Research Agent 副本',
      },
      draft: {
        ...createdDetail.draft,
        agentId: 'bd280f8f-f256-42f7-a603-eaf65a42f345',
      },
    }
    const duplicateAgent = vi.fn(() => Promise.resolve(duplicate))
    const archive = vi.fn(() =>
      Promise.resolve({
        agent: { ...createdAgent, archivedAt: '2026-08-20T06:00:00.000Z' },
        message: 'Agent 已归档；历史版本与记录保持可读。',
      }),
    )
    installApi({
      statusList: vi.fn(() => Promise.resolve([createdStatus])),
      get: vi.fn(() => Promise.resolve(createdDetail)),
      duplicate: duplicateAgent,
      archive,
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /Research Agent/ }))
    const copy = screen.getByRole('button', { name: '复制 Agent' })
    copy.focus()
    await user.keyboard('{Enter}')
    expect(duplicateAgent).toHaveBeenCalledWith({ id: createdAgent.id })
    expect(await screen.findByText(/已创建“Research Agent 副本”/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: /Research Agent/ }))
    await user.click(screen.getByRole('button', { name: '归档' }))
    expect(archive).toHaveBeenCalledWith(createdAgent.id)
    expect(await screen.findByText('Agent 已归档；历史版本与记录保持可读。')).toBeVisible()
  })

  it('restores an archived Agent and cancels permanent deletion inline', async () => {
    const archivedAgent = { ...createdAgent, archivedAt: '2026-08-20T06:00:00.000Z' }
    const archivedDetail = { ...createdDetail, agent: archivedAgent }
    const restore = vi.fn(() =>
      Promise.resolve({
        agent: createdAgent,
        message: 'Agent 已恢复到本地 Agent 列表。',
      }),
    )
    const deleteAgent = vi.fn(() =>
      Promise.reject(new Error('该 Agent 仍有历史引用，不能永久删除：不可变版本 1 项。')),
    )
    installApi({
      statusList: vi.fn<StudioApi['agents']['statusList']>((input) =>
        Promise.resolve(
          input?.scope === 'archived' ? [{ ...createdStatus, agent: archivedAgent }] : [],
        ),
      ),
      get: vi.fn(() => Promise.resolve(archivedDetail)),
      restore,
      delete: deleteAgent,
    })
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '查看已归档' }))
    await user.click(await screen.findByRole('button', { name: /Research Agent/ }))
    await user.click(screen.getByRole('button', { name: '永久删除' }))
    expect(screen.getByRole('alert')).toHaveTextContent('不能撤销')
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByText(/永久删除“Research Agent”/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '永久删除' }))
    await user.click(screen.getByRole('button', { name: '永久删除此 Agent' }))
    expect(await screen.findByText(/仍有历史引用/)).toBeVisible()
    expect(deleteAgent).toHaveBeenCalledWith(createdAgent.id)

    await user.click(screen.getByRole('button', { name: '恢复 Agent' }))
    expect(restore).toHaveBeenCalledWith(createdAgent.id)
    expect(await screen.findByText('Agent 已恢复到本地 Agent 列表。')).toBeVisible()
  })
})
