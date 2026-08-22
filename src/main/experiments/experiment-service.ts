import { randomUUID } from 'node:crypto'
import type { AgentService } from '../agents/agent-service'
import type { ComponentService } from '../components/component-service'
import {
  buildControlSnapshot,
  checkDrift,
  expandExperimentMatrix,
} from '../domain/experiment-domain'
import type { ExperimentRepository } from '../persistence/experiment-repository'
import type { RunService } from '../runs/run-service'
import { AppError } from '../../shared/errors'
import {
  driftCheckSchema,
  experimentDefinitionSchema,
  experimentRecordSchema,
  type CreateExperimentInput,
  type DriftCheck,
  type ExperimentDetail,
  type ExperimentRecord,
} from '../../shared/experiment'
import { isProjectAgentVersionReference } from '../../shared/agent-detail'

const runTerminalStatuses = new Set(['succeeded', 'failed', 'cancelled', 'timed-out'])

function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export class ExperimentService {
  readonly #agents: AgentService
  readonly #components: ComponentService
  readonly #runs: RunService
  readonly #repository: ExperimentRepository
  readonly #architecture: string
  readonly #electronVersion: string
  readonly #active = new Map<string, Promise<void>>()

  constructor(options: {
    agents: AgentService
    components: ComponentService
    runs: RunService
    repository: ExperimentRepository
    architecture: string
    electronVersion: string
  }) {
    this.#agents = options.agents
    this.#components = options.components
    this.#runs = options.runs
    this.#repository = options.repository
    this.#architecture = options.architecture
    this.#electronVersion = options.electronVersion
  }

  create(input: CreateExperimentInput): ExperimentDetail {
    const detail = this.#agents.getActive(input.agentId)
    const version = detail.versions[0]
    if (!version) throw new AppError('VALIDATION_FAILED', '请先创建不可变 Agent Version。')
    const stack = this.#components.getStack(input.agentId)
    if (stack.compilation.status !== 'ready') {
      throw new AppError('VALIDATION_FAILED', 'Stack 预检未通过，不能锁定实验。')
    }
    const frozenRevision = isProjectAgentVersionReference(version.snapshot)
      ? version.snapshot.projectRevision + 1
      : version.snapshot.stack.revision
    if (frozenRevision !== stack.revision) {
      throw new AppError('VALIDATION_FAILED', 'Stack 草稿已在最新版本之后变化，请先创建新版本。')
    }

    const createdAt = new Date().toISOString()
    const id = randomUUID()
    const controls = buildControlSnapshot({
      version,
      stack,
      architecture: this.#architecture,
      electronVersion: this.#electronVersion,
    })
    const definition = experimentDefinitionSchema.parse({
      definitionVersion: 1,
      baselinePrompt: input.baselinePrompt,
      promptVariants: [input.baselinePrompt, ...input.promptVariants],
      randomSeeds: input.randomSeeds,
      repetitions: input.repetitions,
      timeoutMs: input.timeoutMs,
      controls,
      evaluator: {
        id: 'studio://evaluators/runtime-duration-v1',
        direction: 'lower-is-better',
      },
    })
    const drift = checkDrift(controls, controls, createdAt)
    const experiment = experimentRecordSchema.parse({
      id,
      agentId: input.agentId,
      name: input.name,
      researchQuestion: input.researchQuestion,
      status: 'ready',
      definition,
      drift,
      startedAt: null,
      finishedAt: null,
      createdAt,
      updatedAt: createdAt,
    })
    const cells = expandExperimentMatrix({
      experimentId: id,
      promptVariants: definition.promptVariants,
      randomSeeds: definition.randomSeeds,
      repetitions: definition.repetitions,
      createdAt,
    })
    return this.#repository.create(experiment, cells)
  }

  list(agentId: string | null): ExperimentRecord[] {
    return this.#repository.list(agentId)
  }

  get(experimentId: string): ExperimentDetail {
    return this.#repository.get(experimentId)
  }

  refreshDrift(experimentId: string): ExperimentDetail {
    const experiment = this.#repository.getRecord(experimentId)
    const drift = this.#calculateDrift(experiment)
    this.#repository.updateDrift(experimentId, drift)
    if (drift.status === 'blocked' && experiment.status === 'ready') {
      this.#repository.updateStatus(experimentId, 'blocked')
    } else if (drift.status === 'clean' && experiment.status === 'blocked') {
      this.#repository.updateStatus(experimentId, 'ready')
    }
    return this.#repository.get(experimentId)
  }

  start(experimentId: string): ExperimentDetail {
    const current = this.#repository.getRecord(experimentId)
    if (!['ready', 'blocked'].includes(current.status)) {
      throw new AppError('VALIDATION_FAILED', '该实验当前不能再次启动。')
    }
    const refreshed = this.refreshDrift(experimentId)
    if (refreshed.experiment.drift.status === 'blocked') {
      throw new AppError('VALIDATION_FAILED', 'Drift Check 发现非预期变化，实验已阻断。')
    }
    this.#repository.updateStatus(experimentId, 'running', { startedAt: new Date().toISOString() })
    const task = this.#execute(experimentId).finally(() => this.#active.delete(experimentId))
    this.#active.set(experimentId, task)
    void task.catch(() => undefined)
    return this.#repository.get(experimentId)
  }

  cancel(experimentId: string): ExperimentDetail {
    const experiment = this.#repository.getRecord(experimentId)
    if (experiment.status !== 'running') return this.#repository.get(experimentId)
    this.#repository.updateStatus(experimentId, 'cancelling')
    this.#repository.cancelQueued(experimentId)
    for (const cell of this.#repository.listCells(experimentId)) {
      if (cell.status === 'running' && cell.runId) this.#runs.cancel(cell.runId)
    }
    return this.#repository.get(experimentId)
  }

  async stopAll(): Promise<void> {
    for (const experimentId of this.#active.keys()) this.cancel(experimentId)
    await Promise.allSettled(this.#active.values())
  }

  serialize(experimentId: string, format: 'json' | 'csv'): { fileName: string; contents: string } {
    const detail = this.#repository.get(experimentId)
    const safeName =
      detail.experiment.name.replaceAll(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 48) || 'experiment'
    if (format === 'json') {
      return {
        fileName: `${safeName}.json`,
        contents: `${JSON.stringify(detail, null, 2)}\n`,
      }
    }
    const headers = [
      'experiment_id',
      'cell_id',
      'prompt_index',
      'prompt_value',
      'random_seed',
      'repetition',
      'status',
      'run_id',
      'duration_ms',
      'failure_message',
      'drift_status',
    ]
    const rows = detail.cells.map((cell) =>
      [
        detail.experiment.id,
        cell.id,
        cell.promptIndex,
        cell.promptValue,
        cell.randomSeed,
        cell.repetition,
        cell.status,
        cell.runId,
        cell.durationMs,
        cell.failureMessage,
        detail.experiment.drift.status,
      ]
        .map(csvCell)
        .join(','),
    )
    return {
      fileName: `${safeName}.csv`,
      contents: `${headers.map(csvCell).join(',')}\n${rows.join('\n')}\n`,
    }
  }

  #calculateDrift(experiment: ExperimentRecord): DriftCheck {
    try {
      const detail = this.#agents.getActive(experiment.agentId)
      const version = detail.versions[0]
      if (!version) throw new Error('当前 Agent 没有不可变版本。')
      const stack = this.#components.getStack(experiment.agentId)
      const current = buildControlSnapshot({
        version,
        stack,
        architecture: this.#architecture,
        electronVersion: this.#electronVersion,
      })
      return checkDrift(experiment.definition.controls, current)
    } catch (error) {
      return driftCheckSchema.parse({
        status: 'blocked',
        issues: [
          {
            control: 'stack',
            baseline: JSON.stringify(experiment.definition.controls.stack),
            current: 'unavailable',
            message: error instanceof Error ? error.message : '当前 Stack 无法编译。',
          },
        ],
        checkedAt: new Date().toISOString(),
      })
    }
  }

  async #execute(experimentId: string): Promise<void> {
    const experiment = this.#repository.getRecord(experimentId)
    const cells = this.#repository.listCells(experimentId)
    for (const cell of cells) {
      if (this.#repository.getRecord(experimentId).status === 'cancelling') break
      if (cell.status !== 'queued') continue
      try {
        const run = this.#runs.start({
          agentId: experiment.agentId,
          prompt: cell.promptValue,
          timeoutMs: experiment.definition.timeoutMs,
          randomSeed: cell.randomSeed,
        })
        this.#repository.updateCell(cell.id, 'running', { runId: run.id })
        const terminal = await this.#waitForRun(run.id, experiment.definition.timeoutMs + 2_000)
        const durationMs =
          terminal.run.startedAt && terminal.run.finishedAt
            ? Math.max(
                0,
                new Date(terminal.run.finishedAt).getTime() -
                  new Date(terminal.run.startedAt).getTime(),
              )
            : null
        if (terminal.run.status === 'succeeded') {
          this.#repository.updateCell(cell.id, 'succeeded', { durationMs: durationMs ?? 0 })
        } else if (terminal.run.status === 'cancelled') {
          this.#repository.updateCell(cell.id, 'cancelled', {
            durationMs: durationMs ?? undefined,
            failureMessage: terminal.run.failure?.message ?? 'Run 已取消。',
          })
        } else {
          this.#repository.updateCell(cell.id, 'failed', {
            durationMs: durationMs ?? undefined,
            failureMessage: terminal.run.failure?.message ?? 'Run 执行失败。',
          })
        }
      } catch (error) {
        this.#repository.updateCell(cell.id, 'failed', {
          failureMessage: error instanceof Error ? error.message : '实验单元执行失败。',
        })
      }
    }

    const current = this.#repository.getRecord(experimentId)
    const finishedAt = new Date().toISOString()
    if (current.status === 'cancelling') {
      this.#repository.cancelQueued(experimentId)
      this.#repository.updateStatus(experimentId, 'cancelled', { finishedAt })
      return
    }
    const finalCells = this.#repository.listCells(experimentId)
    const hasErrors = finalCells.some(({ status }) => status !== 'succeeded')
    this.#repository.updateStatus(experimentId, hasErrors ? 'completed-with-errors' : 'completed', {
      finishedAt,
    })
  }

  async #waitForRun(runId: string, maximumWaitMs: number): Promise<ReturnType<RunService['get']>> {
    const deadline = Date.now() + maximumWaitMs
    while (Date.now() < deadline) {
      const detail = this.#runs.get(runId)
      if (runTerminalStatuses.has(detail.run.status)) return detail
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    this.#runs.cancel(runId)
    throw new Error('等待 Run 终态超时。')
  }
}
