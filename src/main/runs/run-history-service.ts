import type { ExperimentDetail, ExperimentRecord } from '../../shared/experiment'
import { runHistoryDetailSchema, type RunDetail, type RunHistoryDetail } from '../../shared/run'
import { checkDrift } from '../domain/experiment-domain'

interface RunHistorySource {
  get(runId: string): RunDetail
  cancel(runId: string): RunDetail
}

interface ExperimentHistorySource {
  list(agentId: string | null): ExperimentRecord[]
  get(experimentId: string): ExperimentDetail
}

export class RunHistoryService {
  readonly #runs: RunHistorySource
  readonly #experiments: ExperimentHistorySource

  constructor(options: { runs: RunHistorySource; experiments: ExperimentHistorySource }) {
    this.#runs = options.runs
    this.#experiments = options.experiments
  }

  get(runId: string): RunHistoryDetail {
    return this.#project(this.#runs.get(runId))
  }

  cancel(runId: string): RunHistoryDetail {
    return this.#project(this.#runs.cancel(runId))
  }

  #project(detail: RunDetail): RunHistoryDetail {
    const { run } = detail
    const linked = this.#experiments
      .list(run.agentId)
      .map((experiment) => this.#experiments.get(experiment.id))
      .map((experiment) => ({
        experiment,
        cell: experiment.cells.find(({ runId }) => runId === run.id),
      }))
      .find(({ cell }) => Boolean(cell))
    const durationMs =
      run.startedAt && run.finishedAt
        ? Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
        : null

    return runHistoryDetailSchema.parse({
      ...detail,
      history: {
        durationMs,
        variables: {
          prompt: run.manifest.input.prompt,
          randomSeed: run.manifest.reproducibility.randomSeed,
          timeoutMs: run.manifest.reproducibility.timeoutMs,
          retryLimit: run.manifest.reproducibility.retryLimit,
          concurrency: run.manifest.reproducibility.concurrency,
        },
        experiment:
          linked?.cell === undefined
            ? null
            : {
                id: linked.experiment.experiment.id,
                name: linked.experiment.experiment.name,
                cellId: linked.cell.id,
                promptIndex: linked.cell.promptIndex,
                repetition: linked.cell.repetition,
                drift: checkDrift(
                  linked.experiment.experiment.definition.controls,
                  {
                    agentVersion: {
                      id: run.manifest.agentVersionId,
                      versionNumber: run.manifest.agentVersionNumber,
                      contentHash: run.manifest.agentVersionHash,
                    },
                    stack: {
                      revision: run.manifest.runtimePlan.stackRevision,
                      runtimePlanHash: run.manifest.runtimePlan.contentHash,
                    },
                    components: run.manifest.components.map(
                      ({ componentId, contractId, version, descriptorHash }) => ({
                        componentId,
                        contractId,
                        version,
                        descriptorHash,
                      }),
                    ),
                    executionMode: run.manifest.executionMode,
                    runtime: run.manifest.environment,
                    permissions: run.manifest.permissions,
                    dataset: linked.experiment.experiment.definition.controls.dataset,
                  },
                  run.createdAt,
                ),
              },
      },
    })
  }
}
