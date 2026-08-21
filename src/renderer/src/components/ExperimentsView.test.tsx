import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '../../../shared/agent'
import type { ExperimentDetail, ExperimentRecord } from '../../../shared/experiment'
import type { StudioApi } from '../../../shared/ipc'
import { createRunFixture, fixtureAgentId } from '../../../test/run-fixture'
import { ExperimentsView } from './ExperimentsView'

const timestamp = '2026-08-19T08:00:00.000Z'
const agent: Agent = {
  id: fixtureAgentId,
  name: '实验 Agent',
  description: '',
  executionMode: 'agent-loop',
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
}

function createDetail(status: ExperimentRecord['status'] = 'ready'): ExperimentDetail {
  const { manifest } = createRunFixture()
  const experimentId = '60000000-0000-4000-8000-000000000001'
  const promptVariants = ['基准 Prompt', '候选 Prompt']
  const cells = promptVariants.flatMap((promptValue, promptIndex) =>
    [17, 29].map((randomSeed, index) => ({
      id: `70000000-0000-4000-8000-00000000000${promptIndex * 2 + index + 1}`,
      experimentId,
      promptIndex,
      promptValue,
      randomSeed,
      repetition: 1,
      status: status === 'completed' ? ('succeeded' as const) : ('queued' as const),
      runId: null,
      durationMs: status === 'completed' ? 100 : null,
      failureMessage: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  )
  return {
    experiment: {
      id: experimentId,
      agentId: fixtureAgentId,
      name: 'Prompt 与随机种子对照实验',
      researchQuestion: 'Prompt 与种子如何影响耗时？',
      status,
      definition: {
        definitionVersion: 1,
        baselinePrompt: promptVariants[0],
        promptVariants,
        randomSeeds: [17, 29],
        repetitions: 1,
        timeoutMs: 10_000,
        controls: {
          agentVersion: {
            id: manifest.agentVersionId,
            versionNumber: 1,
            contentHash: manifest.agentVersionHash,
          },
          stack: { revision: 2, runtimePlanHash: manifest.runtimePlan.contentHash },
          components: manifest.components.map((component) => ({
            componentId: component.componentId,
            contractId: component.contractId,
            version: component.version,
            descriptorHash: component.descriptorHash,
          })),
          executionMode: 'agent-loop',
          runtime: {
            cordisVersion: '4.0.0-rc.8',
            platform: 'darwin',
            architecture: 'arm64',
            nodeVersion: '24.12.0',
            electronVersion: '43.4.1',
          },
          permissions: { network: 'denied', filesystem: 'artifacts-only' },
          dataset: { id: 'studio://datasets/built-in-prompt-v1', version: '1' },
        },
        evaluator: {
          id: 'studio://evaluators/runtime-duration-v1',
          direction: 'lower-is-better',
        },
      },
      drift: { status: 'clean', issues: [], checkedAt: timestamp },
      startedAt: status === 'ready' ? null : timestamp,
      finishedAt: status === 'completed' ? timestamp : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    cells,
    comparison: [
      {
        promptIndex: 0,
        promptValue: promptVariants[0],
        randomSeed: 17,
        totalRuns: 1,
        succeededRuns: status === 'completed' ? 1 : 0,
        successRate: status === 'completed' ? 1 : 0,
        averageDurationMs: status === 'completed' ? 100 : null,
        deltaFromBaselineMs: status === 'completed' ? 0 : null,
      },
    ],
  }
}

function createPartialDetail(): ExperimentDetail {
  const detail = createDetail('completed-with-errors')
  const statuses = ['succeeded', 'cancelled', 'failed', 'blocked'] as const
  detail.cells = detail.cells.map((cell, index) => ({
    ...cell,
    status: statuses[index] ?? 'blocked',
    runId: index < 3 ? `80000000-0000-4000-8000-00000000000${index + 1}` : null,
    durationMs: index === 0 ? 120 : index === 2 ? 10_000 : null,
    failureMessage:
      index === 1
        ? '实验已取消。'
        : index === 2
          ? 'Run 超过预设时间并已终止。'
          : index === 3
            ? 'Drift Check 已阻断。'
            : null,
  }))
  detail.experiment.drift = {
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
  }
  detail.experiment.finishedAt = timestamp
  detail.comparison = [
    {
      promptIndex: 0,
      promptValue: '基准 Prompt',
      randomSeed: 17,
      totalRuns: 1,
      succeededRuns: 1,
      successRate: 1,
      averageDurationMs: 120,
      deltaFromBaselineMs: 0,
    },
    {
      promptIndex: 1,
      promptValue: '候选 Prompt',
      randomSeed: 17,
      totalRuns: 1,
      succeededRuns: 1,
      successRate: 1,
      averageDurationMs: 150,
      deltaFromBaselineMs: 30,
    },
  ]
  return detail
}

function installApi(initialDetail?: ExperimentDetail) {
  let detail: ExperimentDetail | undefined = initialDetail
  let records: ExperimentRecord[] = initialDetail ? [initialDetail.experiment] : []
  const create = vi.fn(() => {
    detail = createDetail()
    records = [detail.experiment]
    return Promise.resolve(detail)
  })
  const start = vi.fn(() => {
    detail = createDetail('running')
    records = [detail.experiment]
    return Promise.resolve(detail)
  })
  const cancel = vi.fn(() => {
    detail = createDetail('cancelled')
    records = [detail.experiment]
    return Promise.resolve(detail)
  })
  const exportExperiment = vi.fn(() =>
    Promise.resolve({ status: 'saved' as const, fileName: 'experiment.json' }),
  )
  const experiments: StudioApi['experiments'] = {
    create,
    list: vi.fn(() => Promise.resolve(records)),
    get: vi.fn(() => (detail ? Promise.resolve(detail) : Promise.reject(new Error('not found')))),
    refreshDrift: vi.fn(() =>
      detail ? Promise.resolve(detail) : Promise.reject(new Error('not found')),
    ),
    start,
    cancel,
    export: exportExperiment,
  }
  window.studio = {
    agents: {
      create: vi.fn(() => Promise.reject(new Error('unused'))),
      get: vi.fn(() => Promise.reject(new Error('unused'))),
      list: vi.fn(() => Promise.resolve([agent])),
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
    runs: {
      start: vi.fn(() => Promise.reject(new Error('unused'))),
      list: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.reject(new Error('unused'))),
      cancel: vi.fn(() => Promise.reject(new Error('unused'))),
    },
    experiments,
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
  return { create, start, cancel, exportExperiment }
}

describe('ExperimentsView', () => {
  it('teaches the empty state and creates the F/G matrix from the keyboard', async () => {
    const { create } = installApi()
    const user = userEvent.setup()
    render(<ExperimentsView agentId={fixtureAgentId} />)
    await user.click(await screen.findByRole('button', { name: '创建第一个实验' }))
    const submit = screen.getByRole('button', { name: '锁定定义并创建矩阵' })
    submit.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('heading', { name: '运行矩阵' })).toBeVisible()
    expect(screen.getByText('Drift Check 通过')).toBeVisible()
    expect(screen.getAllByText(/候选 1/).length).toBeGreaterThan(0)
  })

  it('starts, cancels, and exports through explicit controls', async () => {
    const { start, cancel, exportExperiment } = installApi()
    const user = userEvent.setup()
    render(<ExperimentsView agentId={fixtureAgentId} />)
    await user.click(await screen.findByRole('button', { name: '创建第一个实验' }))
    await user.click(screen.getByRole('button', { name: '锁定定义并创建矩阵' }))
    await user.click(await screen.findByRole('button', { name: '运行矩阵' }))
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1))
    await user.click(await screen.findByRole('button', { name: '取消实验' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: '导出 JSON' }))
    await waitFor(() => expect(exportExperiment).toHaveBeenCalledWith(expect.any(String), 'json'))
  })

  it('summarizes, filters, and preserves reproduction evidence for a partial matrix', async () => {
    installApi(createPartialDetail())
    const user = userEvent.setup()
    render(<ExperimentsView agentId={fixtureAgentId} />)
    await user.click(await screen.findByRole('button', { name: /Prompt 与随机种子对照实验/ }))

    const summary = await screen.findByRole('region', { name: '实验进度与复现定义' })
    expect(within(summary).getByText('部分完成')).toBeVisible()
    expect(within(summary).getByText('4 / 4')).toBeVisible()
    expect(within(summary).getByText('1 / 3')).toBeVisible()
    expect(within(summary).getByText('25%')).toBeVisible()
    expect(within(summary).getByText('120 ms')).toBeVisible()
    expect(within(summary).getByText('runtime-duration-v1')).toBeVisible()
    expect(screen.getByText('检测到非预期变化')).toBeVisible()
    expect(screen.getByText('+30 ms')).toBeVisible()

    await user.selectOptions(screen.getByRole('combobox', { name: '矩阵状态范围' }), 'issues')
    expect(screen.getByText('显示 3 / 4 个单元')).toBeVisible()
    await user.type(screen.getByRole('textbox', { name: '筛选实验矩阵' }), '超过预设时间')
    expect(screen.getByText('显示 1 / 4 个单元')).toBeVisible()
    expect(screen.getByText('Run 超过预设时间并已终止。')).toBeVisible()
    await user.clear(screen.getByRole('textbox', { name: '筛选实验矩阵' }))
    await user.type(screen.getByRole('textbox', { name: '筛选实验矩阵' }), '不存在')
    expect(screen.getByText('没有符合条件的运行单元')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(screen.getByText('显示 4 / 4 个单元')).toBeVisible()
  })
})
