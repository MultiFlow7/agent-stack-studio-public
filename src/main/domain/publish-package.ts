import { createHash } from 'node:crypto'
import type { MaterializedAgentVersion } from '../../shared/agent-detail'
import type { ComponentRecord } from '../../shared/component'
import { publishPackageSchema, type PublishPackage } from '../../shared/publish'
import { harnessIdFromAdapter } from '../../core/known-harnesses'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function buildPublishPackage(input: {
  version: MaterializedAgentVersion
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
  const controller = versionComponents.find((component) =>
    component.descriptor.provides.some(({ capability }) => capability === 'execution-controller'),
  )
  const harnessId = harnessIdFromAdapter(controller?.descriptor.runtimeAdapter ?? null)
  const withoutHash = {
    packageVersion: 1 as const,
    source: {
      studioVersion: '0.9.0' as const,
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
    ...(input.version.snapshot.profile
      ? {
          profile: {
            instructions: input.version.snapshot.profile.instructions,
            memoryMarkdown: input.version.snapshot.profile.memoryMarkdown,
            skills: input.version.snapshot.profile.skills
              .filter(({ enabled }) => enabled)
              .map(({ id, name, markdown }) => ({ id, name, markdown })),
            mcpServers: input.version.snapshot.profile.mcpServers
              .filter(({ enabled, approval }) => enabled && approval === 'approved')
              .map(({ id, name, transport, command, args, url }) => ({
                id,
                name,
                transport,
                command,
                args,
                url,
              })),
            toolPolicy: input.version.snapshot.profile.toolPolicy,
          },
        }
      : {}),
    ...(controller && harnessId
      ? {
          harness: {
            id: harnessId,
            contractId: controller.descriptor.id,
            version: controller.descriptor.version,
          },
        }
      : {}),
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
    requirements:
      controller && harnessId
        ? {
            platforms: ['darwin-arm64', 'darwin-x64'] as const,
            nativeHost: true as const,
            network: 'runtime-managed' as const,
          }
        : {
            platforms: ['darwin-arm64', 'darwin-x64'] as const,
            cordisVersion: '4.0.0-rc.8' as const,
            network: 'denied' as const,
          },
    excludedContent: [
      'local-paths',
      'keychain-secrets',
      'experiment-data',
      'chat-history',
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
