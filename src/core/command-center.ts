import type { AgentStatusProjection } from '../shared/agent-status'
import type { ComponentCatalogItem } from '../shared/component-catalog'
import {
  commandCenterSearchResultSchema,
  commandCenterSnapshotSchema,
  type CommandCenterResult,
  type CommandCenterSnapshot,
} from '../shared/command-center'
import type { ExperimentRecord } from '../shared/experiment'
import type { RunRecord } from '../shared/run'
import type { StudioProjectState } from '../shared/studio-project'

const activeRunStatuses = new Set<RunRecord['status']>([
  'queued',
  'starting',
  'running',
  'cancelling',
])
const attentionRunStatuses = new Set<RunRecord['status']>(['failed', 'cancelled', 'timed-out'])

const navigationResults: CommandCenterResult[] = [
  ['project', 'Studio 项目', '打开当前可移植项目与验证结果'],
  ['agents', 'Agent', '管理本地 Agent、Stack 和版本'],
  ['components', '组件', '查看 Component Contract 与兼容证据'],
  ['runs', '运行记录', '查看 Run、Artifact 和 Receipt'],
  ['experiments', '实验', '查看对照矩阵与 Drift'],
  ['discovery', '发现', '搜索 GitHub 公开来源，不下载不执行'],
  ['settings', '设置', '管理本地数据、备份与卸载边界'],
].map(([view, label, detail]) => ({
  id: `view:${view}`,
  category: 'navigation',
  label,
  detail,
  destination: { kind: 'view', view },
})) as CommandCenterResult[]

const actionResults: CommandCenterResult[] = [
  {
    id: 'action:create-agent',
    category: 'action',
    label: '创建 Agent',
    detail: '创建新的本地 Agent 草稿',
    destination: { kind: 'action', action: 'create-agent' },
  },
  {
    id: 'action:import-agent',
    category: 'action',
    label: '导入本地 Agent 项目',
    detail: '只做静态检查，不执行导入代码',
    destination: { kind: 'action', action: 'import-agent' },
  },
  {
    id: 'action:open-project',
    category: 'action',
    label: '打开 Studio 项目',
    detail: '选择现有 .agent-stack 项目',
    destination: { kind: 'action', action: 'open-project' },
  },
  {
    id: 'action:create-project',
    category: 'action',
    label: '创建 Studio 项目',
    detail: '在本地目录初始化可移植项目',
    destination: { kind: 'action', action: 'create-project' },
  },
  {
    id: 'action:refresh',
    category: 'action',
    label: '刷新工作空间状态',
    detail: '重新读取项目、Agent、组件、Run 和实验',
    destination: { kind: 'action', action: 'refresh' },
  },
]

export interface CommandCenterSource {
  project: StudioProjectState
  activeAgents: AgentStatusProjection[]
  archivedAgents: AgentStatusProjection[]
  components: ComponentCatalogItem[]
  runs: RunRecord[]
  experiments: ExperimentRecord[]
  now?: string
}

function orderedRuns(runs: RunRecord[]): RunRecord[] {
  return [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export function buildCommandCenterSnapshot(source: CommandCenterSource): CommandCenterSnapshot {
  const runs = orderedRuns(source.runs)
  const activeRuns = runs.filter(({ status }) => activeRunStatuses.has(status))
  const latestRun = activeRuns[0] ?? runs[0] ?? null
  const workspaceStatus = !source.project.project
    ? 'empty'
    : source.project.changedExternally
      ? 'changed-externally'
      : source.project.validation?.status === 'ready'
        ? 'ready'
        : 'blocked'
  const activityStatus = activeRuns.length
    ? 'active'
    : latestRun && attentionRunStatuses.has(latestRun.status)
      ? 'attention'
      : latestRun
        ? 'complete'
        : 'idle'

  return commandCenterSnapshotSchema.parse({
    workspace: {
      status: workspaceStatus,
      name: source.project.project?.name ?? null,
      revision: source.project.project?.revision ?? null,
      issueCount: source.project.validation?.issues.length ?? 0,
    },
    activity: {
      status: activityStatus,
      activeRunCount: activeRuns.length,
      latestRun: latestRun
        ? {
            id: latestRun.id,
            agentId: latestRun.agentId,
            status: latestRun.status,
            updatedAt: latestRun.updatedAt,
          }
        : null,
    },
    counts: {
      activeAgents: source.activeAgents.length,
      archivedAgents: source.archivedAgents.length,
      components: source.components.length,
      runs: source.runs.length,
      experiments: source.experiments.length,
    },
    refreshedAt: source.now ?? new Date().toISOString(),
  })
}

function buildSearchIndex(source: CommandCenterSource): CommandCenterResult[] {
  const agentNames = new Map(
    [...source.activeAgents, ...source.archivedAgents].map(({ agent }) => [agent.id, agent.name]),
  )
  const project = source.project.project
    ? [
        {
          id: `project:${source.project.project.id}`,
          category: 'project' as const,
          label: source.project.project.name,
          detail: `Studio 项目 · revision ${source.project.project.revision}`,
          destination: { kind: 'view' as const, view: 'project' as const },
        },
      ]
    : []
  const agents = [...source.activeAgents, ...source.archivedAgents].map((projection) => ({
    id: `agent:${projection.agent.id}`,
    category: 'agent' as const,
    label: projection.agent.name,
    detail: `Agent · 草稿修订 ${projection.draftRevision}`,
    destination: { kind: 'agent' as const, agentId: projection.agent.id },
  }))
  const components = source.components.map(({ component }) => ({
    id: `component:${component.id}`,
    category: 'component' as const,
    label: component.descriptor.name,
    detail: `组件 · ${component.descriptor.id}`,
    destination: { kind: 'component' as const, componentId: component.id },
  }))
  const runs = orderedRuns(source.runs).map((run) => ({
    id: `run:${run.id}`,
    category: 'run' as const,
    label: `Run ${run.id.slice(0, 8)}`,
    detail: `Run · ${agentNames.get(run.agentId) ?? '未知 Agent'}`,
    destination: { kind: 'run' as const, runId: run.id },
  }))
  const experiments = source.experiments.map((experiment) => ({
    id: `experiment:${experiment.id}`,
    category: 'experiment' as const,
    label: experiment.name,
    detail: `实验 · ${agentNames.get(experiment.agentId) ?? '未知 Agent'}`,
    destination: { kind: 'experiment' as const, experimentId: experiment.id },
  }))
  return [
    ...actionResults,
    ...navigationResults,
    ...project,
    ...agents,
    ...components,
    ...runs,
    ...experiments,
  ]
}

function normalized(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
}

export function searchCommandCenter(
  source: CommandCenterSource,
  query: string,
): CommandCenterResult[] {
  const needle = normalized(query)
  const indexed = buildSearchIndex(source)
  if (!needle) return commandCenterSearchResultSchema.parse(indexed.slice(0, 12))
  const scored = indexed.flatMap((result) => {
    const label = normalized(result.label)
    const detail = normalized(result.detail)
    const id = normalized(result.id)
    const score =
      label === needle
        ? 0
        : label.startsWith(needle)
          ? 1
          : label.includes(needle)
            ? 2
            : detail.includes(needle) || id.includes(needle)
              ? 3
              : null
    return score === null ? [] : [{ result, score }]
  })
  scored.sort(
    (left, right) =>
      left.score - right.score || left.result.label.localeCompare(right.result.label, 'zh-CN'),
  )
  return commandCenterSearchResultSchema.parse(scored.slice(0, 12).map(({ result }) => result))
}
