import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RunRecord } from '../../shared/run'
import { localContractTestTargetId, unconfiguredMulticaTargetId } from '../../shared/publish'
import { AgentService } from '../agents/agent-service'
import { builtInComponents } from '../components/built-in-components'
import { ComponentService } from '../components/component-service'
import { MulticaContractTestPublisher } from '../connectors/multica-contract-test-publisher'
import type {
  AgentPublisher,
  PublisherContext,
  PublisherOutcome,
  RemoteAgentSummary,
} from '../connectors/agent-publisher'
import { AgentRepository } from '../persistence/agent-repository'
import { ComponentRepository } from '../persistence/component-repository'
import { PublishRepository } from '../persistence/publish-repository'
import type { RunService } from '../runs/run-service'
import { WorkspaceService } from '../workspace/workspace-service'
import type { PublishPackage, PublishTarget, PublishValidation } from '../../shared/publish'
import { PublishService } from './publish-service'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

class FailOncePublisher implements AgentPublisher {
  readonly #delegate = new MulticaContractTestPublisher()
  attempts = 0

  validate(target: PublishTarget, publishPackage: PublishPackage): Promise<PublishValidation> {
    return this.#delegate.validate(target, publishPackage)
  }

  publish(
    _target: PublishTarget,
    _publishPackage: PublishPackage,
    context: PublisherContext,
  ): Promise<PublisherOutcome> {
    this.attempts += 1
    if (this.attempts === 1) return Promise.reject(new Error('模拟远端暂时不可用。'))
    return Promise.resolve({
      remoteAgentId: context.remoteAgentId ?? 'test-agent-retry',
      remoteVersionId: `test-version-${context.idempotencyKey.slice(0, 8)}`,
      message: '重试成功。',
      publishedFields: ['agent', 'stack'],
      testOnly: true,
    })
  }

  inspect(): Promise<RemoteAgentSummary | null> {
    return Promise.resolve(null)
  }
}

async function fixture(publisher: AgentPublisher = new MulticaContractTestPublisher()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-m5-service-'))
  directories.push(directory)
  const databasePath = path.join(directory, 'studio.sqlite3')
  const agentRepository = new AgentRepository(databasePath)
  const componentRepository = new ComponentRepository(databasePath)
  const publishRepository = new PublishRepository(databasePath)
  const agents = new AgentService(
    agentRepository,
    new WorkspaceService(path.join(directory, 'workspaces')),
  )
  const components = new ComponentService(componentRepository)
  const agent = agentRepository.create({
    name: 'M5 Agent',
    description: '发布契约验证',
    executionMode: 'agent-loop',
  })
  const component = componentRepository.ensure(
    builtInComponents[0].descriptor,
    builtInComponents[0].id,
  )
  componentRepository.addToStack(agent.id, component.id)
  const version = agentRepository.createVersion(agent.id)
  agentRepository.saveSecretReference({
    agentId: agent.id,
    label: 'MULTICA_TOKEN',
    keychainService: 'studio.agent-stack',
    keychainAccount: 'publisher@example.test',
  })
  const verifiedRun = { agentVersionId: version.id, status: 'succeeded' } as RunRecord
  const runs: Pick<RunService, 'list'> = { list: () => [verifiedRun] }
  const publishing = new PublishService({
    agents,
    components,
    runs,
    repository: publishRepository,
    publisher,
  })
  return {
    agent,
    version,
    publishing,
    agentRepository,
    componentRepository,
    publishRepository,
  }
}

function close(resources: Awaited<ReturnType<typeof fixture>>): void {
  resources.publishRepository.close()
  resources.componentRepository.close()
  resources.agentRepository.close()
}

describe('PublishService', () => {
  it('previews a secret-free package, publishes once, and reuses the successful Receipt', async () => {
    const resources = await fixture()
    const input = {
      targetId: localContractTestTargetId,
      agentId: resources.agent.id,
      agentVersionId: resources.version.id,
    }
    const preview = await resources.publishing.preview(input)
    expect(preview.validation.status).toBe('ready')
    expect(JSON.stringify(preview.package)).not.toContain('publisher@example.test')
    expect(JSON.stringify(preview.package)).not.toContain('MULTICA_TOKEN')

    const first = await resources.publishing.publish({ ...input, confirmed: true })
    const repeated = await resources.publishing.publish({ ...input, confirmed: true })
    expect(first.receipt.status).toBe('succeeded')
    expect(repeated).toMatchObject({ reused: true, receipt: { id: first.receipt.id } })
    expect(resources.publishing.history(input.targetId, input.agentId).mapping).toMatchObject({
      remoteAgentId: first.receipt.remoteAgentId,
    })
    close(resources)
  })

  it('blocks unverified, drifted, or unconfigured publishing before the connector writes', async () => {
    const resources = await fixture()
    resources.agentRepository.update({
      id: resources.agent.id,
      name: resources.agent.name,
      description: '制造 Stack Drift',
      executionMode: 'agent-loop',
    })
    const drifted = await resources.publishing.preview({
      targetId: localContractTestTargetId,
      agentId: resources.agent.id,
      agentVersionId: resources.version.id,
    })
    expect(drifted.validation.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'STACK_DRIFT' })]),
    )
    const unconfigured = await resources.publishing.preview({
      targetId: unconfiguredMulticaTargetId,
      agentId: resources.agent.id,
      agentVersionId: resources.version.id,
    })
    expect(unconfigured.validation.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'TARGET_UNAVAILABLE' })]),
    )
    close(resources)
  })

  it('keeps a failed Receipt and retries with the same idempotency key', async () => {
    const publisher = new FailOncePublisher()
    const resources = await fixture(publisher)
    const input = {
      targetId: localContractTestTargetId,
      agentId: resources.agent.id,
      agentVersionId: resources.version.id,
      confirmed: true as const,
    }
    const failed = await resources.publishing.publish(input)
    const succeeded = await resources.publishing.publish(input)
    expect(failed.receipt).toMatchObject({ status: 'failed', attempt: 1 })
    expect(succeeded.receipt).toMatchObject({ status: 'succeeded', attempt: 2 })
    expect(succeeded.receipt.idempotencyKey).toBe(failed.receipt.idempotencyKey)
    expect(resources.publishing.history(input.targetId, input.agentId).receipts).toHaveLength(2)
    close(resources)
  })
})
