import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '../../../shared/agent'
import type { ExecutionMode } from '../../../shared/agent'
import type { StudioApi } from '../../../shared/ipc'
import type { RunHistory, RunHistoryDetail, RunRecord } from '../../../shared/run'
import { createRunFixture, fixtureAgentId } from '../../../test/run-fixture'
import { RunsView } from './RunsView'

const timestamp = '2026-08-19T08:00:00.000Z'
const agent: Agent = {
  id: fixtureAgentId,
  name: '本地研究 Agent',
  description: '',
  executionMode: 'agent-loop',
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}

function installApi(
  initialRuns: RunRecord[] = [],
  executionMode: ExecutionMode = 'agent-loop',
  experimentHistory: RunHistory['experiment'] = null,
) {
  let runs = initialRuns
  const currentAgent = { ...agent, executionMode }
  const { manifest } = createRunFixture(executionMode)
  const start = vi.fn(() => {
    const run: RunRecord = {
      id: manifest.runId,
      agentId: manifest.agentId,
      agentVersionId: manifest.agentVersionId,
      status: 'running',
      manifest,
      startedAt: timestamp,
      finishedAt: null,
      failure: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    runs = [run]
    return Promise.resolve(run)
  })
  const get = vi.fn((runId: string): Promise<RunHistoryDetail> => {
    const run = runs.find(({ id }) => id === runId)
    if (!run) return Promise.reject(new Error('not found'))
    return Promise.resolve({
      run,
      artifacts: [],
      events: [
        {
          id: '50000000-0000-4000-8000-000000000001',
          runId,
          sequence: 1,
          type: 'runtime-ready',
          message: 'Cordis Runtime 已冷启动。',
          details: {},
          createdAt: timestamp,
        },
      ],
      history: {
        durationMs:
          run.startedAt && run.finishedAt
            ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
            : null,
        variables: {
          prompt: run.manifest.input.prompt,
          randomSeed: run.manifest.reproducibility.randomSeed,
          timeoutMs: run.manifest.reproducibility.timeoutMs,
          retryLimit: run.manifest.reproducibility.retryLimit,
          concurrency: run.manifest.reproducibility.concurrency,
        },
        experiment: experimentHistory,
      },
    })
  })
  const cancel = vi.fn(async (runId: string) => {
    runs = runs.map((run) =>
      run.id === runId
        ? {
            ...run,
            status: 'cancelled' as const,
            finishedAt: timestamp,
            failure: { code: 'CANCELLED' as const, message: 'Run 由用户取消。' },
          }
        : run,
    )
    return get(runId)
  })
  const runsApi: StudioApi['runs'] = {
    start,
    list: vi.fn(() => Promise.resolve(runs)),
    get,
    cancel,
  }
  window.studio = {
    agents: {
      create: vi.fn(() => Promise.reject(new Error('unused'))),
      get: vi.fn(() => Promise.reject(new Error('unused'))),
      list: vi.fn(() => Promise.resolve([currentAgent])),
      statusList: vi.fn(() => Promise.resolve([])),
      status: vi.fn(() => Promise.reject(new Error('unused'))),
      update: vi.fn(() => Promise.reject(new Error('unused'))),
      duplicate: vi.fn(() => Promise.reject(new Error('unused'))),
      archive: vi.fn(() => Promise.reject(new Error('unused'))),
      restore: vi.fn(() => Promise.reject(new Error('unused'))),
      delete: vi.fn(() => Promise.reject(new Error('unused'))),
      createVersion: vi.fn(() => Promise.reject(new Error('unused'))),
    },
    secrets: {} as StudioApi['secrets'],
    imports: {
      selectAndScan: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
      confirm: vi.fn(() => Promise.reject(new Error('unused'))),
    },
    components: {
      list: vi.fn(() => Promise.resolve([])),
      catalog: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.reject(new Error('unused'))),
      getStack: vi.fn(() => Promise.reject(new Error('unused'))),
      addToStack: vi.fn(() => Promise.reject(new Error('unused'))),
      removeFromStack: vi.fn(() => Promise.reject(new Error('unused'))),
      selectOwner: vi.fn(() => Promise.reject(new Error('unused'))),
    },
    runs: runsApi,
    experiments: {
      create: vi.fn(() => Promise.reject(new Error('unused'))),
      list: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.reject(new Error('unused'))),
      refreshDrift: vi.fn(() => Promise.reject(new Error('unused'))),
      start: vi.fn(() => Promise.reject(new Error('unused'))),
      cancel: vi.fn(() => Promise.reject(new Error('unused'))),
      export: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
    },
    publishing: {
      targets: vi.fn(() => Promise.resolve([])),
      preview: vi.fn(() => Promise.reject(new Error('unused'))),
      publish: vi.fn(() => Promise.reject(new Error('unused'))),
      history: vi.fn(() => Promise.resolve({ mapping: null, receipts: [] })),
    },
    maintenance: {} as StudioApi['maintenance'],
    preferences: {} as StudioApi['preferences'],
    discovery: {} as StudioApi['discovery'],
    menu: {
      onCreateAgent: vi.fn(() => () => undefined),
      onOpenSettings: vi.fn(() => () => undefined),
    },
  }
  return { start, cancel }
}

describe('RunsView', () => {
  it('shows a useful empty state for a local Agent', async () => {
    installApi()
    render(<RunsView agentId={fixtureAgentId} />)
    expect(await screen.findByRole('heading', { name: '还没有本地 Run' })).toBeVisible()
  })

  it('starts from the keyboard, exposes events, and cancels an active Run', async () => {
    const { start, cancel } = installApi()
    const user = userEvent.setup()
    render(<RunsView agentId={fixtureAgentId} />)
    const launch = await screen.findByRole('button', { name: '启动本地 Run' })
    launch.focus()
    await user.keyboard('{Enter}')

    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(expect.objectContaining({ agentId: fixtureAgentId })),
    )
    expect(await screen.findByText('Cordis Runtime 已冷启动。')).toBeVisible()
    expect(screen.getByRole('heading', { name: '复现变量与 Drift' })).toBeVisible()
    expect(screen.getByText('执行本地样例')).toBeVisible()
    expect(screen.getByText('不适用')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('heading', { name: '已取消' })).toBeVisible()
  })

  it('keeps a failed historical Run read-only with duration, variables, and Experiment Drift', async () => {
    const { manifest } = createRunFixture()
    const timedOut: RunRecord = {
      id: manifest.runId,
      agentId: manifest.agentId,
      agentVersionId: manifest.agentVersionId,
      status: 'timed-out',
      manifest,
      startedAt: timestamp,
      finishedAt: '2026-08-19T08:00:01.250Z',
      failure: { code: 'TIMEOUT', message: 'Run 超过预设时间并已终止。' },
      createdAt: timestamp,
      updatedAt: '2026-08-19T08:00:01.250Z',
    }
    installApi([timedOut], 'agent-loop', {
      id: '60000000-0000-4000-8000-000000000001',
      name: '历史 Drift 基准',
      cellId: '70000000-0000-4000-8000-000000000001',
      promptIndex: 1,
      repetition: 2,
      drift: {
        status: 'blocked',
        checkedAt: timestamp,
        issues: [
          {
            control: 'stack',
            baseline: '{"revision":1}',
            current: '{"revision":2}',
            message: 'Stack 修订或 Runtime Plan 已变化。',
          },
        ],
      },
    })
    const user = userEvent.setup()
    render(<RunsView agentId={fixtureAgentId} />)

    await user.click(await screen.findByRole('button', { name: '查看' }))
    expect(await screen.findByRole('heading', { name: '已超时' })).toBeVisible()
    expect(screen.getByText('TIMEOUT')).toBeVisible()
    expect(screen.getAllByText('1.25 秒')).toHaveLength(2)
    expect(screen.getByText('检测到非预期变化')).toBeVisible()
    expect(screen.getByText('Stack 修订或 Runtime Plan 已变化。')).toBeVisible()
  })

  it.each([
    ['workflow', '工作流', '内置线性 Workflow'],
    ['hybrid', '混合模式', '显式交接给 Agent Loop'],
    ['external-harness', '外部 Harness', '白名单中的内置 Harness Adapter'],
  ] as const)('explains the trusted local %s boundary', async (mode, label, description) => {
    installApi([], mode)
    render(<RunsView agentId={fixtureAgentId} />)

    expect(await screen.findByText(label)).toBeVisible()
    expect(screen.getByText(new RegExp(description))).toBeVisible()
    expect(screen.getByText(/导入仓库仍只做静态检查/)).toBeVisible()
  })
})
