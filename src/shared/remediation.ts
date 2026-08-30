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

const taskKindLabels: Record<CompatibilityRemediationTask['kind'], string> = {
  'adapter-work': 'Adapter 工作产物',
  'fork-work': 'Fork 补丁工作产物',
  'contract-test': '契约测试',
  'runtime-validation': '最小运行验证',
}

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

/**
 * Produces a complete, portable handoff for a Coding Agent without exposing local paths,
 * credentials, chat history, or runtime logs.
 */
export function buildCodingAgentRemediationPrompt(input: CompatibilityRemediationTask[]): string {
  const tasks = compatibilityRemediationTasksSchema.min(1).parse(input)
  const componentNames = [...new Set(tasks.map(({ componentName }) => componentName))]
  const title =
    componentNames.length === 1 ? `完成 ${componentNames[0]} 的兼容处置` : '完成组件兼容处置'

  const workItems = tasks
    .map((task, index) => {
      const criteria = task.acceptanceCriteria.map((criterion) => `- [ ] ${criterion}`).join('\n')
      return [
        `### ${index + 1}. ${task.componentName} · ${taskKindLabels[task.kind]}`,
        '',
        `- Component ID：\`${task.componentId}\``,
        `- 当前状态：${task.status === 'complete' ? '已有证据，请复核并保留' : '待完成'}`,
        `- 任务说明：${task.description}`,
        '',
        '验收条件：',
        '',
        criteria,
      ].join('\n')
    })
    .join('\n\n')

  return [
    `# Coding Agent 任务：${title}`,
    '',
    '请直接在当前 Agent Stack Studio 仓库中完成以下任务。先读取仓库根目录的 `AGENTS.md`、`PRODUCT.md`、相关技术架构、路线图与 ADR，再从第一项“待完成”任务开始；已有证据只复核，不要伪造或重复升级状态。',
    '',
    '## 目标',
    '',
    '为列出的 Component 准备可审查、可复现、版本固定的 Adapter 或 Fork，并依次完成契约测试与受信最小运行验证。所有状态必须来自真实测试证据，并通过 Studio Core 写回项目事实。',
    '',
    '## 任务清单',
    '',
    workItems,
    '',
    '## 安全与架构边界',
    '',
    '- 不执行未知第三方代码、安装脚本、生命周期钩子或未审查的网络操作。',
    '- 在隔离的 `codex/` 功能分支或 worktree 中工作，不覆盖用户已有修改，不强推。',
    '- Adapter 只依赖稳定 Component Contract；Renderer 不得直接访问 Node、文件系统、数据库或 Keychain。',
    '- 真实执行只能使用代码内注册、版本固定并进入精确白名单的 `studio://` Runtime Adapter。',
    '- 保留 `.agent-stack` revision 并发保护、原子写入和同一 Studio Core 事实来源。',
    '- 不把本地绝对路径、密钥、聊天内容或运行日志写入可分享的项目事实、提交信息或交付报告。',
    '- 不得把未通过的契约测试或运行验证标记为 `contract-tested` / `runtime-verified`。',
    '',
    '## 交付要求',
    '',
    '- 实现代码、测试与必要文档必须一起提交；列出实际修改文件和关键决策。',
    '- 固定外部来源、版本与校验信息；说明权限、License、失败恢复和回滚方式。',
    '- 运行适用的 format、lint、typecheck、test、build/打包检查，并如实报告命令与结果。',
    '- 若凭证、外部服务或产品决策确实阻塞真实验证，完成所有安全可完成部分后，准确说明唯一阻塞点；不得模拟成功。',
    '- 完成后给出逐项验收证据，并保持未满足项为待完成。',
  ].join('\n')
}
