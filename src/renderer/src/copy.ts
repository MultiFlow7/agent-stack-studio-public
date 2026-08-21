import type { ExecutionMode } from '../../shared/agent'
import type { CapabilityId, ComponentDescriptor } from '../../shared/component'
import type { RunRecord } from '../../shared/run'
import type { ExperimentCell, ExperimentRecord } from '../../shared/experiment'
import type { CommandCenterSnapshot } from '../../shared/command-center'
import type { PublishReceipt } from '../../shared/publish'

export const executionModeLabels: Record<ExecutionMode, string> = {
  'agent-loop': 'Agent 循环',
  workflow: '工作流',
  hybrid: '混合模式',
  'external-harness': '外部 Harness',
}

export const capabilityLabels: Record<string, string> = {
  'execution-controller': '执行控制',
  'model-provider': '模型提供',
  'prompt-policy': 'Prompt 策略',
  'context-builder': '上下文组装',
  memory: '记忆',
  'tool-runtime': '工具运行时',
  'skill-provider': 'Skills 提供',
  'mcp-client': 'MCP 客户端',
  'state-store': '状态存储',
  sandbox: '沙箱',
  trace: '调用追踪',
  evaluator: '评价器',
  'human-gate': '人工关卡',
}

export function capabilityLabel(capability: CapabilityId): string {
  return capabilityLabels[capability] ?? capability
}

export const compatibilityLabels: Record<ComponentDescriptor['compatibility']['level'], string> = {
  native: '原生兼容',
  configuration: '需要配置映射',
  adapter: '需要 Adapter',
  fork: '需要 Fork',
  blocked: '不兼容',
  unknown: '待确认',
}

export const validationLabels: Record<ComponentDescriptor['compatibility']['validation'], string> =
  {
    declared: '已声明',
    'contract-tested': '已通过契约测试',
    'runtime-verified': '已验证兼容',
    failed: '验证失败',
  }

export const runStatusLabels: Record<RunRecord['status'], string> = {
  queued: '排队中',
  starting: '正在启动',
  running: '运行中',
  cancelling: '正在取消',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  'timed-out': '已超时',
}

export const experimentStatusLabels: Record<ExperimentRecord['status'], string> = {
  ready: '待运行',
  running: '运行中',
  cancelling: '正在取消',
  completed: '已完成',
  'completed-with-errors': '部分完成',
  blocked: 'Drift 已阻断',
  cancelled: '已取消',
}

export const experimentCellStatusLabels: Record<ExperimentCell['status'], string> = {
  queued: '等待中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
  blocked: '已阻断',
}

export const workspaceStatusLabels: Record<CommandCenterSnapshot['workspace']['status'], string> = {
  empty: '未打开项目',
  ready: '项目就绪',
  blocked: '项目已阻断',
  'changed-externally': '检测到外部修改',
}

export const activityStatusLabels: Record<CommandCenterSnapshot['activity']['status'], string> = {
  idle: '当前无 Run',
  active: 'Run 进行中',
  attention: 'Run 需关注',
  complete: 'Run 已完成',
}

export const stackStatusLabels = {
  ready: '就绪',
  blocked: '已阻断',
} as const

export const publishStatusLabels: Record<PublishReceipt['status'], string> = {
  pending: '进行中',
  succeeded: '已成功',
  failed: '失败',
}
