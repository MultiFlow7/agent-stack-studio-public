import { createHash, randomInt } from 'node:crypto'
import type { AgentVersion } from '../../shared/agent-detail'
import type { ComponentRecord } from '../../shared/component'
import { AppError } from '../../shared/errors'
import { runManifestSchema, type ExecutionDescription, type RunManifest } from '../../shared/run'
import type { RuntimePlan } from '../../shared/runtime-plan'
import { isTrustedRuntimeAdapterRef, trustedWorkflowProfiles } from '../../shared/trusted-execution'

interface BuildRunManifestInput {
  runId: string
  version: AgentVersion
  plan: RuntimePlan
  components: ComponentRecord[]
  prompt: string
  timeoutMs: number
  randomSeed?: number
  electronVersion: string
  architecture: string
  createdAt: string
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function describeExecution(plan: RuntimePlan): ExecutionDescription {
  const untrustedService = plan.services.find(
    ({ adapterRef }) => !isTrustedRuntimeAdapterRef(adapterRef),
  )
  if (untrustedService) {
    throw new AppError(
      'VALIDATION_FAILED',
      `${untrustedService.componentContractId} 未绑定 Studio 白名单内的本地 Runtime Adapter。`,
    )
  }
  const controller = plan.services.find(({ capabilities }) =>
    capabilities.includes('execution-controller'),
  )
  switch (plan.executionMode) {
    case 'agent-loop':
      if (!controller) {
        throw new AppError('VALIDATION_FAILED', 'Agent Loop 缺少 execution-controller。')
      }
      return { kind: 'agent-loop', controllerServiceKey: controller.serviceKey, maxTurns: 3 }
    case 'workflow':
      return {
        kind: 'workflow',
        workflowVersionId: trustedWorkflowProfiles.workflow.versionId,
        entryNode: trustedWorkflowProfiles.workflow.entryNode,
      }
    case 'hybrid':
      if (!controller) {
        throw new AppError('VALIDATION_FAILED', 'Hybrid 缺少 execution-controller。')
      }
      return {
        kind: 'hybrid',
        workflowVersionId: trustedWorkflowProfiles.hybrid.versionId,
        controllerServiceKey: controller.serviceKey,
        handoff: 'workflow-to-agent',
      }
    case 'external-harness':
      if (!controller || controller.adapterRef !== 'studio://runtime/harness-x') {
        throw new AppError(
          'VALIDATION_FAILED',
          'External Harness 只能使用已通过运行验证的内置 Harness X Adapter。',
        )
      }
      return {
        kind: 'external-harness',
        harnessComponentId: controller.componentId,
        trustedExecution: true,
      }
  }
}

export function buildRunManifest(input: BuildRunManifestInput): RunManifest {
  const execution = describeExecution(input.plan)

  const manifestWithoutHash = {
    manifestVersion: 1 as const,
    runId: input.runId,
    agentId: input.version.agentId,
    agentVersionId: input.version.id,
    agentVersionNumber: input.version.versionNumber,
    agentVersionHash: input.version.contentHash,
    executionMode: input.plan.executionMode,
    execution,
    runtimePlan: input.plan,
    components: input.components.map((component) => ({
      componentId: component.id,
      contractId: component.descriptor.id,
      version: component.descriptor.version,
      descriptorHash: hash(component.descriptor),
      adapterRef: component.descriptor.runtimeAdapter,
    })),
    input: { prompt: input.prompt },
    environment: {
      platform: 'darwin' as const,
      architecture: input.architecture,
      nodeVersion: process.versions.node,
      electronVersion: input.electronVersion,
      cordisVersion: input.plan.cordisVersion,
    },
    reproducibility: {
      randomSeed: input.randomSeed ?? randomInt(0, 2_147_483_647),
      timeoutMs: input.timeoutMs,
      retryLimit: 0 as const,
      concurrency: 1 as const,
    },
    permissions: { network: 'denied' as const, filesystem: 'artifacts-only' as const },
    createdAt: input.createdAt,
  }
  return runManifestSchema.parse({
    ...manifestWithoutHash,
    contentHash: hash(manifestWithoutHash),
  })
}
