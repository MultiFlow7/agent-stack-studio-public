import type { RunManifest, RuntimeRunEvent, RuntimeRunResult } from '../shared/run'
import { isTrustedRuntimeAdapterRef, trustedWorkflowProfiles } from '../shared/trusted-execution'

function assertTrustedExecutionBinding(manifest: RunManifest): void {
  const execution = manifest.execution
  if (execution.kind !== manifest.executionMode) {
    throw new Error('Run Manifest 的执行模式与执行绑定不一致。')
  }
  const controller = manifest.runtimePlan.services.find(({ capabilities }) =>
    capabilities.includes('execution-controller'),
  )
  switch (execution.kind) {
    case 'agent-loop':
      if (controller?.serviceKey !== execution.controllerServiceKey) {
        throw new Error('Agent Loop Controller 与 Runtime Plan 不一致。')
      }
      return
    case 'workflow':
      if (
        execution.workflowVersionId !== trustedWorkflowProfiles.workflow.versionId ||
        execution.entryNode !== trustedWorkflowProfiles.workflow.entryNode
      ) {
        throw new Error('Workflow 未绑定 Studio 内置可信版本。')
      }
      return
    case 'hybrid':
      if (
        execution.workflowVersionId !== trustedWorkflowProfiles.hybrid.versionId ||
        execution.controllerServiceKey !== controller?.serviceKey ||
        execution.handoff !== 'workflow-to-agent'
      ) {
        throw new Error('Hybrid 的 Workflow、Controller 或 handoff 绑定不可信。')
      }
      return
    case 'external-harness':
      if (
        !execution.trustedExecution ||
        execution.harnessComponentId !== controller?.componentId ||
        controller.adapterRef !== 'studio://runtime/harness-x'
      ) {
        throw new Error('External Harness 未通过本地可信执行绑定。')
      }
  }
}

function executionSteps(manifest: RunManifest): string[] {
  switch (manifest.execution.kind) {
    case 'agent-loop':
      return ['读取不可变 Manifest', '验证已授信 Service 描述', '生成内置 Agent Loop 输出']
    case 'workflow':
      return ['读取不可变 Workflow Version', '执行线性 Workflow 节点', '汇总 Workflow 输出']
    case 'hybrid':
      return [
        '读取不可变 Workflow Version',
        '执行 Workflow 准备节点',
        '将控制权交接给 Agent Loop',
        '汇总 Hybrid 输出',
      ]
    case 'external-harness':
      return [
        '验证 Harness Component 与白名单 Adapter',
        '调用内置 Harness 契约',
        '汇总 Harness 输出',
      ]
  }
}

function executionLabel(manifest: RunManifest): string {
  switch (manifest.execution.kind) {
    case 'agent-loop':
      return '内置 Agent Loop'
    case 'workflow':
      return '内置 Workflow'
    case 'hybrid':
      return '内置 Hybrid'
    case 'external-harness':
      return '内置 External Harness 契约'
  }
}

export async function executeBuiltInRun(
  manifest: RunManifest,
  signal: AbortSignal,
  emit: (event: RuntimeRunEvent) => void,
  stepDelayMs = 350,
): Promise<RuntimeRunResult> {
  if (
    manifest.runtimePlan.services.some(({ adapterRef }) => !isTrustedRuntimeAdapterRef(adapterRef))
  ) {
    throw new Error('当前 Run 包含未授信的 Runtime Adapter。')
  }
  assertTrustedExecutionBinding(manifest)

  const startedAt = Date.now()
  const steps = executionSteps(manifest)
  for (let index = 0; index < steps.length; index += 1) {
    if (signal.aborted) throw new DOMException('Run cancelled.', 'AbortError')
    const step = steps[index]
    emit({
      type: 'step-started',
      message: step,
      details: { step: index + 1, total: steps.length },
    })
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, stepDelayMs)
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout)
          reject(new DOMException('Run cancelled.', 'AbortError'))
        },
        { once: true },
      )
    })
    emit({
      type: 'step-completed',
      message: `${step}，已完成。`,
      details: { step: index + 1, total: steps.length },
    })
  }

  const summary = `${executionLabel(manifest)}已处理：${manifest.input.prompt}`
  emit({
    type: 'output',
    message: summary,
    details: { deterministic: true, executionMode: manifest.execution.kind },
  })
  return {
    summary,
    stepsCompleted: steps.length,
    durationMs: Date.now() - startedAt,
  }
}
