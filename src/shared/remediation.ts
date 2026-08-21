import { z } from 'zod'
import type { ComponentDescriptor } from './component'

export const compatibilityRemediationTaskSchema = z
  .object({
    id: z
      .string()
      .regex(/^[0-9a-f-]{36}:(adapter-work|fork-work|contract-test|runtime-validation)$/),
    kind: z.enum(['adapter-work', 'fork-work', 'contract-test', 'runtime-validation']),
    status: z.enum(['complete', 'required']),
    componentId: z.uuid(),
    componentName: z.string().trim().min(1),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()

export const compatibilityRemediationTasksSchema = z.array(compatibilityRemediationTaskSchema)

export type CompatibilityRemediationTask = z.infer<typeof compatibilityRemediationTaskSchema>

interface CompatibilityInput {
  componentId: string
  componentName: string
  compatibility: ComponentDescriptor['compatibility']
}

export function buildCompatibilityRemediationTasks({
  componentId,
  componentName,
  compatibility,
}: CompatibilityInput): CompatibilityRemediationTask[] {
  if (
    !['adapter', 'fork'].includes(compatibility.level) ||
    compatibility.validation === 'runtime-verified'
  ) {
    return []
  }

  const workKind = compatibility.level === 'adapter' ? 'adapter-work' : 'fork-work'
  const workLabel = compatibility.level === 'adapter' ? 'Adapter' : 'Fork 补丁'
  const workComplete = ['contract-tested'].includes(compatibility.validation)
  const contractComplete = compatibility.validation === 'contract-tested'
  const tasks: CompatibilityRemediationTask[] = [
    {
      id: `${componentId}:${workKind}`,
      kind: workKind,
      status: workComplete ? 'complete' : 'required',
      componentId,
      componentName,
      title: `${workLabel} 工作产物`,
      description: workComplete
        ? `${workLabel} 已有契约测试证据，但这不等同于运行兼容。`
        : `在隔离工作区准备可审查、可版本固定的${workLabel}；Studio 不会自动执行生成代码。`,
      acceptanceCriteria:
        compatibility.level === 'adapter'
          ? [
              '只依赖稳定 Component Contract',
              '转换逻辑具有隔离单元测试',
              'Adapter 版本进入实验快照',
            ]
          : ['补丁与上游版本固定', 'Fork 使用独立 Component 版本', '补丁内容可审查且可复现'],
    },
    {
      id: `${componentId}:contract-test`,
      kind: 'contract-test',
      status: contractComplete ? 'complete' : 'required',
      componentId,
      componentName,
      title: '契约测试',
      description: contractComplete
        ? 'Descriptor 已记录契约测试证据。'
        : '在不授予 Runtime 信任的前提下验证输入、输出、配置和生命周期契约。',
      acceptanceCriteria: [
        '契约测试全部通过',
        '失败结果不会升级兼容状态',
        '证据写回 Component Descriptor',
      ],
    },
    {
      id: `${componentId}:runtime-validation`,
      kind: 'runtime-validation',
      status: 'required',
      componentId,
      componentName,
      title: '最小运行验证',
      description: '仅在受信隔离环境完成启动、调用、取消与清理验证后，才能把兼容状态升级为已验证。',
      acceptanceCriteria: [
        '使用精确白名单 Runtime Adapter',
        '启动、调用、取消和资源清理均通过',
        'Descriptor validation 更新为 runtime-verified',
      ],
    },
  ]

  return compatibilityRemediationTasksSchema.parse(tasks)
}
