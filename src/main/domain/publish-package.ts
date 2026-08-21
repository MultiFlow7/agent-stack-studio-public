import { createHash } from 'node:crypto'
import type { AgentVersion } from '../../shared/agent-detail'
import type { ComponentRecord } from '../../shared/component'
import { publishPackageSchema, type PublishPackage } from '../../shared/publish'

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function buildPublishPackage(input: {
  version: AgentVersion
  components: ComponentRecord[]
}): PublishPackage {
  const byId = new Map(input.components.map((component) => [component.id, component]))
  const versionComponents = input.version.snapshot.stack.components.map((snapshot) => {
    const component = byId.get(snapshot.componentId)
    if (
      !component ||
      component.descriptor.id !== snapshot.contractId ||
      component.descriptor.version !== snapshot.version
    ) {
      throw new Error(
        `Agent Version 引用的组件 ${snapshot.contractId}@${snapshot.version} 不可用。`,
      )
    }
    return component
  })
  const contractIds = new Map(
    versionComponents.map((component) => [component.id, component.descriptor.id]),
  )
  const withoutHash = {
    packageVersion: 1 as const,
    source: {
      studioVersion: '0.1.0' as const,
      localAgentId: input.version.agentId,
      agentVersionId: input.version.id,
      agentVersionNumber: input.version.versionNumber,
      agentVersionHash: input.version.contentHash,
    },
    agent: {
      name: input.version.snapshot.agent.name,
      description: input.version.snapshot.agent.description,
      executionMode: input.version.snapshot.agent.executionMode,
    },
    stack: {
      revision: input.version.snapshot.stack.revision,
      components: versionComponents.map((component) => ({
        contractId: component.descriptor.id,
        version: component.descriptor.version,
        capabilities: component.descriptor.provides.map(({ capability }) => capability),
        runtimeRequired: component.descriptor.runtimeAdapter !== null,
      })),
      capabilityOwners: input.version.snapshot.stack.capabilityOwners.map((owner) => {
        const contractId = contractIds.get(owner.componentId)
        if (!contractId) throw new Error(`capability owner ${owner.capability} 缺少组件。`)
        return { capability: owner.capability, contractId }
      }),
    },
    environmentDeclarations: [],
    requirements: {
      platforms: ['darwin-arm64', 'darwin-x64'] as const,
      cordisVersion: '4.0.0-rc.8' as const,
      network: 'denied' as const,
    },
    excludedContent: [
      'local-paths',
      'keychain-secrets',
      'experiment-data',
      'run-logs',
      'artifacts',
    ] as const,
  }
  return publishPackageSchema.parse({ ...withoutHash, contentHash: hash(withoutHash) })
}

export function publishIdempotencyKey(targetId: string, publishPackage: PublishPackage): string {
  return hash({
    targetId,
    agentVersionId: publishPackage.source.agentVersionId,
    packageHash: publishPackage.contentHash,
  })
}
