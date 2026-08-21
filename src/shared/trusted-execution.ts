import type { ExecutionMode } from './agent'

export const trustedWorkflowProfiles = {
  workflow: {
    id: 'studio://workflows/local-linear-v1',
    versionId: '70000000-0000-4000-8000-000000000001',
    entryNode: 'inspect-manifest',
  },
  hybrid: {
    id: 'studio://workflows/local-hybrid-v1',
    versionId: '70000000-0000-4000-8000-000000000002',
    entryNode: 'prepare-handoff',
  },
} as const

export const trustedRuntimeAdapterRefs = [
  'studio://runtime/harness-x',
  'studio://runtime/research-y',
] as const

export type TrustedRuntimeAdapterRef = (typeof trustedRuntimeAdapterRefs)[number]

export function isTrustedRuntimeAdapterRef(
  adapterRef: string | null,
): adapterRef is TrustedRuntimeAdapterRef {
  return trustedRuntimeAdapterRefs.some((trusted) => trusted === adapterRef)
}

export const localExecutionModeDescriptions: Record<ExecutionMode, string> = {
  'agent-loop': '由 Studio 内置 Agent Loop 控制器逐步处理任务。',
  workflow: '由版本锁定的 Studio 内置线性 Workflow 驱动节点。',
  hybrid: '由内置 Workflow 准备上下文，再显式交接给 Agent Loop。',
  'external-harness': '通过白名单中的内置 Harness Adapter 验证外部控制契约。',
}
