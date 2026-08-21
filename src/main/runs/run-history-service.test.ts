import { describe, expect, it, vi } from 'vitest'
import type { ExperimentDetail, ExperimentRecord } from '../../shared/experiment'
import type { RunDetail } from '../../shared/run'
import { createRunFixture, fixtureRunId } from '../../test/run-fixture'
import { RunHistoryService } from './run-history-service'

const startedAt = '2026-08-19T08:00:00.000Z'
const finishedAt = '2026-08-19T08:00:01.250Z'
const experimentId = '60000000-0000-4000-8000-000000000001'
const cellId = '70000000-0000-4000-8000-000000000001'

function runDetail(): RunDetail {
  const { manifest } = createRunFixture()
  return {
    run: {
      id: manifest.runId,
      agentId: manifest.agentId,
      agentVersionId: manifest.agentVersionId,
      status: 'succeeded',
      manifest,
      startedAt,
      finishedAt,
      failure: null,
      createdAt: startedAt,
      updatedAt: finishedAt,
    },
    events: [],
    artifacts: [],
  }
}

function experiment(detail: RunDetail): ExperimentDetail {
  const { manifest } = detail.run
  const record: ExperimentRecord = {
    id: experimentId,
    agentId: manifest.agentId,
    name: '历史 Drift 基准',
    researchQuestion: '同一 Manifest 是否保持控制变量？',
    status: 'completed',
    definition: {
      definitionVersion: 1,
      baselinePrompt: manifest.input.prompt,
      promptVariants: [manifest.input.prompt, '候选 Prompt'],
      randomSeeds: [manifest.reproducibility.randomSeed],
      repetitions: 1,
      timeoutMs: manifest.reproducibility.timeoutMs,
      controls: {
        agentVersion: {
          id: manifest.agentVersionId,
          versionNumber: manifest.agentVersionNumber,
          contentHash: manifest.agentVersionHash,
        },
        stack: {
          revision: manifest.runtimePlan.stackRevision,
          runtimePlanHash: manifest.runtimePlan.contentHash,
        },
        components: manifest.components.map(
          ({ componentId, contractId, version, descriptorHash }) => ({
            componentId,
            contractId,
            version,
            descriptorHash,
          }),
        ),
        executionMode: manifest.executionMode,
        runtime: manifest.environment,
        permissions: manifest.permissions,
        dataset: { id: 'studio://datasets/built-in-prompt-v1', version: '1' },
      },
      evaluator: {
        id: 'studio://evaluators/runtime-duration-v1',
        direction: 'lower-is-better',
      },
    },
    drift: { status: 'clean', issues: [], checkedAt: startedAt },
    startedAt,
    finishedAt,
    createdAt: startedAt,
    updatedAt: finishedAt,
  }
  return {
    experiment: record,
    cells: [
      {
        id: cellId,
        experimentId,
        promptIndex: 0,
        promptValue: manifest.input.prompt,
        randomSeed: manifest.reproducibility.randomSeed,
        repetition: 1,
        status: 'succeeded',
        runId: manifest.runId,
        durationMs: 1_250,
        failureMessage: null,
        createdAt: startedAt,
        updatedAt: finishedAt,
      },
    ],
    comparison: [],
  }
}

describe('RunHistoryService', () => {
  it('projects immutable variables and wall duration for a standalone Run', () => {
    const detail = runDetail()
    const service = new RunHistoryService({
      runs: { get: vi.fn(() => detail), cancel: vi.fn(() => detail) },
      experiments: { list: vi.fn(() => []), get: vi.fn() },
    })

    expect(service.get(fixtureRunId)).toMatchObject({
      history: {
        durationMs: 1_250,
        variables: {
          prompt: '执行本地样例',
          timeoutMs: 10_000,
          retryLimit: 0,
          concurrency: 1,
        },
        experiment: null,
      },
    })
  })

  it('recomputes clean Drift from the linked Experiment baseline and immutable Run Manifest', () => {
    const detail = runDetail()
    const linked = experiment(detail)
    const service = new RunHistoryService({
      runs: { get: vi.fn(() => detail), cancel: vi.fn(() => detail) },
      experiments: {
        list: vi.fn(() => [linked.experiment]),
        get: vi.fn(() => linked),
      },
    })

    expect(service.get(fixtureRunId).history.experiment).toMatchObject({
      id: experimentId,
      cellId,
      promptIndex: 0,
      repetition: 1,
      drift: { status: 'clean', issues: [] },
    })
  })

  it('reports historical Drift when the Run Manifest differs from the locked baseline', () => {
    const detail = runDetail()
    const linked = experiment(detail)
    linked.experiment.definition.controls.stack.revision += 1
    linked.experiment.definition.controls.components[0].descriptorHash = 'b'.repeat(64)
    const service = new RunHistoryService({
      runs: { get: vi.fn(() => detail), cancel: vi.fn(() => detail) },
      experiments: {
        list: vi.fn(() => [linked.experiment]),
        get: vi.fn(() => linked),
      },
    })

    const projected = service.cancel(fixtureRunId)
    expect(projected.history.experiment?.drift.status).toBe('blocked')
    expect(projected.history.experiment?.drift.issues.map(({ control }) => control)).toEqual(
      expect.arrayContaining(['stack', 'component']),
    )
  })
})
