import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionMode } from '../../shared/agent'
import type { RunManifest, RuntimeRunEvent } from '../../shared/run'
import { AgentService } from '../agents/agent-service'
import { builtInComponents } from '../components/built-in-components'
import { ComponentService } from '../components/component-service'
import { AgentRepository } from '../persistence/agent-repository'
import { ComponentRepository } from '../persistence/component-repository'
import { RunRepository } from '../persistence/run-repository'
import type {
  RuntimeExecutionGateway,
  RuntimeExecutionOutcome,
} from '../runtime/runtime-controller'
import { WorkspaceService } from '../workspace/workspace-service'
import { ArtifactService } from './artifact-service'
import { RunService } from './run-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

class FakeRuntime implements RuntimeExecutionGateway {
  readonly events: RuntimeRunEvent[] = []
  #resolve: ((outcome: RuntimeExecutionOutcome) => void) | undefined
  readonly #pending: boolean

  constructor(pending = false) {
    this.#pending = pending
  }

  execute(
    _manifest: RunManifest,
    onEvent: (event: RuntimeRunEvent) => void,
  ): Promise<RuntimeExecutionOutcome> {
    const ready: RuntimeRunEvent = {
      type: 'runtime-ready',
      message: 'Runtime ready.',
      details: {},
    }
    this.events.push(ready)
    onEvent(ready)
    if (this.#pending) {
      return new Promise((resolve) => {
        this.#resolve = resolve
      })
    }
    return Promise.resolve({
      status: 'succeeded',
      result: { summary: 'done', stepsCompleted: 3, durationMs: 12 },
    })
  }

  cancel(): boolean {
    if (!this.#resolve) return false
    this.#resolve({ status: 'cancelled' })
    this.#resolve = undefined
    return true
  }

  stopAll(): Promise<void> {
    return Promise.resolve()
  }
}

async function fixture(
  runtime: RuntimeExecutionGateway,
  executionMode: ExecutionMode = 'agent-loop',
  adapterRef = builtInComponents[0].descriptor.runtimeAdapter,
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-run-service-'))
  temporaryDirectories.push(directory)
  const databasePath = path.join(directory, 'studio.sqlite3')
  const agentRepository = new AgentRepository(databasePath)
  const componentRepository = new ComponentRepository(databasePath)
  const runRepository = new RunRepository(databasePath)
  const agents = new AgentService(
    agentRepository,
    new WorkspaceService(path.join(directory, 'workspaces')),
  )
  const components = new ComponentService(componentRepository)
  const agent = agentRepository.create({
    name: 'Run Agent',
    description: '',
    executionMode,
  })
  const descriptor = structuredClone(builtInComponents[0].descriptor)
  descriptor.runtimeAdapter = adapterRef
  const component = componentRepository.ensure(descriptor, builtInComponents[0].id)
  componentRepository.addToStack(agent.id, component.id)
  agentRepository.createVersion(agent.id)
  const service = new RunService({
    agents,
    components,
    repository: runRepository,
    runtime,
    artifacts: new ArtifactService(path.join(directory, 'artifacts')),
    electronVersion: '43.4.1',
    architecture: 'arm64',
  })
  return { service, agent, agentRepository, componentRepository, runRepository }
}

describe('RunService', () => {
  it('runs an immutable ready Stack and persists the output Artifact', async () => {
    const runtime = new FakeRuntime()
    const resources = await fixture(runtime)
    const run = resources.service.start({
      agentId: resources.agent.id,
      prompt: '执行纵向切片',
      timeoutMs: 5_000,
    })

    await vi.waitFor(() => expect(resources.runRepository.get(run.id).status).toBe('succeeded'))
    const detail = resources.service.get(run.id)
    expect(detail.events.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        'queued',
        'process-started',
        'runtime-ready',
        'artifact-written',
        'completed',
      ]),
    )
    expect(detail.artifacts).toHaveLength(1)
    expect(detail.run.manifest.agentVersionId).toBeTruthy()
    resources.runRepository.close()
    resources.componentRepository.close()
    resources.agentRepository.close()
  })

  it.each(['agent-loop', 'workflow', 'hybrid', 'external-harness'] as const)(
    'starts a persisted Run with the trusted %s execution binding',
    async (executionMode) => {
      const runtime = new FakeRuntime()
      const resources = await fixture(runtime, executionMode)
      const run = resources.service.start({
        agentId: resources.agent.id,
        prompt: `执行 ${executionMode}`,
        timeoutMs: 5_000,
      })

      await vi.waitFor(() => expect(resources.runRepository.get(run.id).status).toBe('succeeded'))
      expect(resources.service.get(run.id).run.manifest.execution.kind).toBe(executionMode)
      resources.runRepository.close()
      resources.componentRepository.close()
      resources.agentRepository.close()
    },
  )

  it('rejects an unregistered Adapter before creating a Run record', async () => {
    const resources = await fixture(
      new FakeRuntime(),
      'agent-loop',
      'studio://runtime/not-registered',
    )

    expect(() =>
      resources.service.start({
        agentId: resources.agent.id,
        prompt: '不得执行',
        timeoutMs: 5_000,
      }),
    ).toThrow('白名单')
    expect(resources.runRepository.list(resources.agent.id)).toEqual([])
    resources.runRepository.close()
    resources.componentRepository.close()
    resources.agentRepository.close()
  })

  it('records a cooperative cancellation and leaves no successful Artifact', async () => {
    const runtime = new FakeRuntime(true)
    const resources = await fixture(runtime)
    const run = resources.service.start({
      agentId: resources.agent.id,
      prompt: '取消这个 Run',
      timeoutMs: 5_000,
    })
    await vi.waitFor(() => expect(resources.runRepository.get(run.id).status).toBe('running'))

    resources.service.cancel(run.id)
    resources.service.cancel(run.id)
    await vi.waitFor(() => expect(resources.runRepository.get(run.id).status).toBe('cancelled'))
    const detail = resources.service.get(run.id)
    expect(detail.events.map(({ type }) => type)).toEqual(
      expect.arrayContaining(['cancel-requested', 'cancelled']),
    )
    expect(detail.events.filter(({ type }) => type === 'cancel-requested')).toHaveLength(1)
    expect(detail.artifacts).toEqual([])
    resources.runRepository.close()
    resources.componentRepository.close()
    resources.agentRepository.close()
  })
})
