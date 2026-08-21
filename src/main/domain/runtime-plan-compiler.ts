import { createHash } from 'node:crypto'
import type { ExecutionMode } from '../../shared/agent'
import type { CapabilityId, ComponentRecord } from '../../shared/component'
import {
  buildCompatibilityRemediationTasks,
  type CompatibilityRemediationTask,
} from '../../shared/remediation'
import {
  runtimePlanCompilationSchema,
  runtimePlanSchema,
  type CapabilityOwner,
  type RuntimePlanCompilation,
  type RuntimePlanIssue,
} from '../../shared/runtime-plan'

export interface CompileRuntimePlanInput {
  agentId: string
  stackRevision: number
  executionMode: ExecutionMode
  components: ComponentRecord[]
  owners: CapabilityOwner[]
}

export function compileRuntimePlan(input: CompileRuntimePlanInput): RuntimePlanCompilation {
  const issues: RuntimePlanIssue[] = []
  const remediationTasks: CompatibilityRemediationTask[] = []
  const providers = new Map<
    CapabilityId,
    Array<{ component: ComponentRecord; activation: string }>
  >()

  if (input.components.length === 0) {
    issues.push({
      code: 'EMPTY_STACK',
      capability: null,
      componentId: null,
      message: 'Stack 尚未添加组件，无法编译 Runtime Plan。',
    })
  }

  for (const component of input.components) {
    const { compatibility } = component.descriptor
    if (compatibility.level === 'blocked' || compatibility.validation === 'failed') {
      issues.push({
        code: 'COMPONENT_BLOCKED',
        capability: null,
        componentId: component.id,
        message: `${component.descriptor.name} 已标记为不兼容：${compatibility.detail}`,
      })
    } else if (compatibility.level === 'unknown') {
      issues.push({
        code: 'COMPATIBILITY_UNKNOWN',
        capability: null,
        componentId: component.id,
        message: `${component.descriptor.name} 缺少兼容性证据。`,
      })
    } else if (
      ['adapter', 'fork'].includes(compatibility.level) &&
      compatibility.validation !== 'runtime-verified'
    ) {
      remediationTasks.push(
        ...buildCompatibilityRemediationTasks({
          componentId: component.id,
          componentName: component.descriptor.name,
          compatibility,
        }),
      )
      issues.push({
        code: 'ADAPTER_UNVERIFIED',
        capability: null,
        componentId: component.id,
        message: `${component.descriptor.name} 的 Adapter 尚未通过最小运行验证。`,
      })
    }

    for (const provider of component.descriptor.provides) {
      const matches = providers.get(provider.capability) ?? []
      matches.push({ component, activation: provider.activation })
      providers.set(provider.capability, matches)
    }
  }

  const ownerMap = new Map(input.owners.map((owner) => [owner.capability, owner.componentId]))
  const activeCapabilities = new Map<string, CapabilityId[]>()

  for (const [capability, candidates] of providers) {
    const selectedId = ownerMap.get(capability)
    let ownerId: string | undefined
    if (candidates.length === 1) {
      ownerId = candidates[0]?.component.id
      if (selectedId && selectedId !== ownerId) {
        issues.push({
          code: 'OWNER_INVALID',
          capability,
          componentId: selectedId,
          message: `${capability} 的 Owner 不提供该能力。`,
        })
      }
    } else if (!selectedId) {
      issues.push({
        code: 'OWNER_REQUIRED',
        capability,
        componentId: null,
        message: `${capability} 由 ${candidates.length} 个组件提供，必须明确选择 Owner。`,
      })
    } else if (!candidates.some(({ component }) => component.id === selectedId)) {
      issues.push({
        code: 'OWNER_INVALID',
        capability,
        componentId: selectedId,
        message: `${capability} 的 Owner 不在当前 Provider 列表中。`,
      })
    } else {
      ownerId = selectedId
      for (const candidate of candidates) {
        if (candidate.component.id !== selectedId && candidate.activation === 'always-active') {
          issues.push({
            code: 'UNCONTROLLED_SIDE_EFFECT',
            capability,
            componentId: candidate.component.id,
            message: `${candidate.component.descriptor.name} 在未成为 Owner 时仍会激活 ${capability}。`,
          })
        }
      }
    }
    if (ownerId) {
      activeCapabilities.set(ownerId, [...(activeCapabilities.get(ownerId) ?? []), capability])
    }
  }

  for (const component of input.components) {
    for (const requirement of component.descriptor.requires) {
      if (!providers.has(requirement.capability)) {
        issues.push({
          code: 'UNSATISFIED_REQUIREMENT',
          capability: requirement.capability,
          componentId: component.id,
          message: `${component.descriptor.name} 依赖 ${requirement.capability}，但 Stack 中没有 Provider。`,
        })
      }
    }
  }

  if (
    ['agent-loop', 'hybrid', 'external-harness'].includes(input.executionMode) &&
    !providers.has('execution-controller')
  ) {
    issues.push({
      code: 'EXECUTION_CONTROLLER_REQUIRED',
      capability: 'execution-controller',
      componentId: null,
      message: `${input.executionMode} 模式需要 execution-controller。`,
    })
  }

  if (issues.length > 0) {
    return runtimePlanCompilationSchema.parse({
      status: 'blocked',
      issues,
      remediationTasks,
      plan: null,
    })
  }

  const planWithoutHash = {
    planVersion: 1 as const,
    agentId: input.agentId,
    stackRevision: input.stackRevision,
    executionMode: input.executionMode,
    cordisVersion: '4.0.0-rc.8' as const,
    services: input.components
      .filter((component) => (activeCapabilities.get(component.id)?.length ?? 0) > 0)
      .map((component) => ({
        serviceKey: `${component.descriptor.id}@${component.descriptor.version}`,
        componentId: component.id,
        componentContractId: component.descriptor.id,
        componentVersion: component.descriptor.version,
        adapterRef: component.descriptor.runtimeAdapter,
        capabilities: activeCapabilities.get(component.id) ?? [],
        requirements: component.descriptor.requires.map(({ capability }) => capability),
      })),
  }
  const contentHash = createHash('sha256').update(JSON.stringify(planWithoutHash)).digest('hex')
  const plan = runtimePlanSchema.parse({ ...planWithoutHash, contentHash })
  return runtimePlanCompilationSchema.parse({
    status: 'ready',
    issues: [],
    remediationTasks: [],
    plan,
  })
}
