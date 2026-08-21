import { createHash, randomUUID } from 'node:crypto'
import type { AgentVersion } from '../../shared/agent-detail'
import type { ComponentRecord } from '../../shared/component'
import {
  driftCheckSchema,
  experimentCellSchema,
  experimentComparisonSchema,
  experimentControlSnapshotSchema,
  type DriftCheck,
  type ExperimentCell,
  type ExperimentComparison,
  type ExperimentControlSnapshot,
} from '../../shared/experiment'
import type { StackState } from '../../shared/runtime-plan'

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function buildControlSnapshot(input: {
  version: AgentVersion
  stack: StackState
  architecture: string
  electronVersion: string
}): ExperimentControlSnapshot {
  if (input.stack.compilation.status !== 'ready') throw new Error('Runtime Plan 尚未就绪。')
  return experimentControlSnapshotSchema.parse({
    agentVersion: {
      id: input.version.id,
      versionNumber: input.version.versionNumber,
      contentHash: input.version.contentHash,
    },
    stack: {
      revision: input.stack.revision,
      runtimePlanHash: input.stack.compilation.plan.contentHash,
    },
    components: input.stack.components.map((component) => ({
      componentId: component.id,
      contractId: component.descriptor.id,
      version: component.descriptor.version,
      descriptorHash: hash(component.descriptor),
    })),
    executionMode: input.stack.compilation.plan.executionMode,
    runtime: {
      cordisVersion: input.stack.compilation.plan.cordisVersion,
      platform: 'darwin',
      architecture: input.architecture,
      nodeVersion: process.versions.node,
      electronVersion: input.electronVersion,
    },
    permissions: { network: 'denied', filesystem: 'artifacts-only' },
    dataset: { id: 'studio://datasets/built-in-prompt-v1', version: '1' },
  })
}

export function checkDrift(
  baseline: ExperimentControlSnapshot,
  current: ExperimentControlSnapshot,
  checkedAt = new Date().toISOString(),
): DriftCheck {
  const issues: DriftCheck['issues'] = []
  const add = (
    control: DriftCheck['issues'][number]['control'],
    before: unknown,
    after: unknown,
    message: string,
  ) =>
    issues.push({
      control,
      baseline: JSON.stringify(before),
      current: JSON.stringify(after),
      message,
    })

  if (
    baseline.agentVersion.id !== current.agentVersion.id ||
    baseline.agentVersion.contentHash !== current.agentVersion.contentHash
  )
    add(
      'agent-version',
      baseline.agentVersion,
      current.agentVersion,
      '基准 Agent Version 已不是当前不可变版本。',
    )
  if (
    baseline.stack.revision !== current.stack.revision ||
    baseline.stack.runtimePlanHash !== current.stack.runtimePlanHash
  )
    add('stack', baseline.stack, current.stack, 'Stack 修订或 Runtime Plan 已变化。')
  if (JSON.stringify(baseline.components) !== JSON.stringify(current.components))
    add(
      'component',
      baseline.components,
      current.components,
      '组件身份、版本或 Descriptor 哈希已变化。',
    )
  if (baseline.executionMode !== current.executionMode)
    add('execution-mode', baseline.executionMode, current.executionMode, '执行模式已变化。')
  if (JSON.stringify(baseline.runtime) !== JSON.stringify(current.runtime))
    add('runtime', baseline.runtime, current.runtime, 'Runtime 环境已变化。')
  if (JSON.stringify(baseline.permissions) !== JSON.stringify(current.permissions))
    add('permissions', baseline.permissions, current.permissions, '权限边界已变化。')
  if (JSON.stringify(baseline.dataset) !== JSON.stringify(current.dataset))
    add('dataset', baseline.dataset, current.dataset, '数据集版本已变化。')

  return driftCheckSchema.parse({
    status: issues.length === 0 ? 'clean' : 'blocked',
    issues,
    checkedAt,
  })
}

export function expandExperimentMatrix(input: {
  experimentId: string
  promptVariants: string[]
  randomSeeds: number[]
  repetitions: number
  createdAt: string
}): ExperimentCell[] {
  const cells: ExperimentCell[] = []
  for (let promptIndex = 0; promptIndex < input.promptVariants.length; promptIndex += 1) {
    for (const randomSeed of input.randomSeeds) {
      for (let repetition = 1; repetition <= input.repetitions; repetition += 1) {
        cells.push(
          experimentCellSchema.parse({
            id: randomUUID(),
            experimentId: input.experimentId,
            promptIndex,
            promptValue: input.promptVariants[promptIndex],
            randomSeed,
            repetition,
            status: 'queued',
            runId: null,
            durationMs: null,
            failureMessage: null,
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
          }),
        )
      }
    }
  }
  return cells
}

export function compareExperimentCells(cells: ExperimentCell[]): ExperimentComparison[] {
  const groups = new Map<string, ExperimentCell[]>()
  for (const cell of cells) {
    const key = `${cell.promptIndex}:${cell.randomSeed}`
    groups.set(key, [...(groups.get(key) ?? []), cell])
  }
  const raw = [...groups.values()].map((group) => {
    const first = group[0]
    if (!first) throw new Error('Experiment comparison group cannot be empty.')
    const succeeded = group.filter(({ status }) => status === 'succeeded')
    const durations = succeeded.flatMap(({ durationMs }) =>
      durationMs === null ? [] : [durationMs],
    )
    return {
      promptIndex: first.promptIndex,
      promptValue: first.promptValue,
      randomSeed: first.randomSeed,
      totalRuns: group.length,
      succeededRuns: succeeded.length,
      successRate: succeeded.length / group.length,
      averageDurationMs:
        durations.length === 0
          ? null
          : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    }
  })
  raw.sort(
    (left, right) => left.promptIndex - right.promptIndex || left.randomSeed - right.randomSeed,
  )
  const baseline = raw[0]?.averageDurationMs ?? null
  return raw.map((row) =>
    experimentComparisonSchema.parse({
      ...row,
      deltaFromBaselineMs:
        baseline === null || row.averageDurationMs === null
          ? null
          : row.averageDurationMs - baseline,
    }),
  )
}

export function descriptorHash(component: ComponentRecord): string {
  return hash(component.descriptor)
}
