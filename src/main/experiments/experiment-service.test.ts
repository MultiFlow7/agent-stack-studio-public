import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunManifest, RuntimeRunEvent } from '../../shared/run'
import { AgentService } from '../agents/agent-service'
import { builtInComponents } from '../components/built-in-components'
import { ComponentService } from '../components/component-service'
import { AgentRepository } from '../persistence/agent-repository'
import { ComponentRepository } from '../persistence/component-repository'
import { ExperimentRepository } from '../persistence/experiment-repository'
import { RunRepository } from '../persistence/run-repository'
import type {
  RuntimeExecutionGateway,
  RuntimeExecutionOutcome,
} from '../runtime/runtime-controller'
import { ArtifactService } from '../runs/artifact-service'
import { RunService } from '../runs/run-service'
import { WorkspaceService } from '../workspace/workspace-service'
import { ExperimentService } from './experiment-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

class ImmediateRuntime implements RuntimeExecutionGateway {
  execute(
    manifest: RunManifest,
    onEvent: (event: RuntimeRunEvent) => void,
  ): Promise<RuntimeExecutionOutcome> {
    onEvent({ type: 'runtime-ready', message: 'ready', details: {} })
    return Promise.resolve({
      status: 'succeeded',
      result: {
        summary: `done:${manifest.input.prompt}`,
        stepsCompleted: 3,
        durationMs: 10,
      },
    })
  }
  cancel(): boolean {
    return false
  }
  stopAll(): Promise<void> {
    return Promise.resolve()
  }
}

class CancellableRuntime implements RuntimeExecutionGateway {
  readonly #active = new Map<string, (outcome: RuntimeExecutionOutcome) => void>()

  execute(
    manifest: RunManifest,
    onEvent: (event: RuntimeRunEvent) => void,
  ): Promise<RuntimeExecutionOutcome> {
    onEvent({ type: 'runtime-ready', message: 'ready', details: {} })
    return new Promise((resolve) => this.#active.set(manifest.runId, resolve))
  }

  cancel(runId: string): boolean {
    const resolve = this.#active.get(runId)
    if (!resolve) return false
    this.#active.delete(runId)
    resolve({ status: 'cancelled' })
    return true
  }

  stopAll(): Promise<void> {
    for (const runId of this.#active.keys()) this.cancel(runId)
    return Promise.resolve()
  }
}

async function fixture(runtime: RuntimeExecutionGateway = new ImmediateRuntime()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-experiment-service-'))
  temporaryDirectories.push(directory)
  const databasePath = path.join(directory, 'studio.sqlite3')
  const agentRepository = new AgentRepository(databasePath)
  const componentRepository = new ComponentRepository(databasePath)
  const runRepository = new RunRepository(databasePath)
  const experimentRepository = new ExperimentRepository(databasePath)
  const agents = new AgentService(
    agentRepository,
    new WorkspaceService(path.join(directory, 'workspaces')),
  )
  const components = new ComponentService(componentRepository)
  const agent = agentRepository.create({
    name: 'M4 Agent',
    description: '',
    executionMode: 'agent-loop',
  })
  const component = componentRepository.ensure(
    builtInComponents[0].descriptor,
    builtInComponents[0].id,
  )
  componentRepository.addToStack(agent.id, component.id)
  agentRepository.createVersion(agent.id)
  const runs = new RunService({
    agents,
    components,
    repository: runRepository,
    runtime,
    artifacts: new ArtifactService(path.join(directory, 'artifacts')),
    electronVersion: '43.4.1',
    architecture: 'arm64',
  })
  const experiments = new ExperimentService({
    agents,
    components,
    runs,
    repository: experimentRepository,
    architecture: 'arm64',
    electronVersion: '43.4.1',
  })
  return {
    agent,
    agents,
    experiments,
    agentRepository,
    componentRepository,
    runRepository,
    experimentRepository,
  }
}

function createInput(agentId: string) {
  return {
    agentId,
    name: 'F/G 对照实验',
    researchQuestion: 'Prompt 与种子会如何影响耗时？',
    baselinePrompt: '基准 Prompt',
    promptVariants: ['候选 Prompt'],
    randomSeeds: [17, 29],
    repetitions: 1,
    timeoutMs: 5_000,
  }
}

describe('ExperimentService', () => {
  it('locks controls, runs the full matrix, aggregates metrics, and exports safe CSV', async () => {
    const resources = await fixture()
    const created = resources.experiments.create(createInput(resources.agent.id))
    expect(created.cells).toHaveLength(4)
    expect(Object.keys(created.experiment.definition.controls)).toHaveLength(7)

    resources.experiments.start(created.experiment.id)
    await vi.waitFor(
      () =>
        expect(resources.experiments.get(created.experiment.id).experiment.status).toBe(
          'completed',
        ),
      { timeout: 3_000 },
    )
    const completed = resources.experiments.get(created.experiment.id)
    expect(completed.cells.every(({ status }) => status === 'succeeded')).toBe(true)
    expect(completed.comparison).toHaveLength(4)
    expect(
      new Set(
        resources.runRepository
          .list(resources.agent.id)
          .map((run) => run.manifest.reproducibility.randomSeed),
      ),
    ).toEqual(new Set([17, 29]))

    const injected = resources.experiments.create({
      ...createInput(resources.agent.id),
      name: 'CSV 安全',
      promptVariants: ['=1+1'],
      randomSeeds: [17],
    })
    expect(resources.experiments.serialize(injected.experiment.id, 'csv').contents).toContain(
      '"\'=1+1"',
    )
    resources.experimentRepository.close()
    resources.runRepository.close()
    resources.componentRepository.close()
    resources.agentRepository.close()
  })

  it('blocks execution when a locked Stack control drifts', async () => {
    const resources = await fixture()
    const created = resources.experiments.create(createInput(resources.agent.id))
    resources.agentRepository.update({
      id: resources.agent.id,
      name: resources.agent.name,
      description: '修改草稿以制造 Drift',
      executionMode: 'agent-loop',
    })

    const drifted = resources.experiments.refreshDrift(created.experiment.id)
    expect(drifted.experiment.status).toBe('blocked')
    expect(drifted.experiment.drift.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ control: 'stack' })]),
    )
    expect(() => resources.experiments.start(created.experiment.id)).toThrow('Drift Check')
    resources.experimentRepository.close()
    resources.runRepository.close()
    resources.componentRepository.close()
    resources.agentRepository.close()
  })

  it('cancels active and queued cells before repositories close', async () => {
    const resources = await fixture(new CancellableRuntime())
    const created = resources.experiments.create(createInput(resources.agent.id))
    resources.experiments.start(created.experiment.id)
    await vi.waitFor(() => {
      expect(resources.experiments.get(created.experiment.id).cells[0]?.status).toBe('running')
    })

    await resources.experiments.stopAll()

    const stopped = resources.experiments.get(created.experiment.id)
    expect(stopped.experiment.status).toBe('cancelled')
    expect(stopped.cells.filter(({ status }) => status === 'cancelled')).toHaveLength(4)
    resources.experimentRepository.close()
    resources.runRepository.close()
    resources.componentRepository.close()
    resources.agentRepository.close()
  })
})
