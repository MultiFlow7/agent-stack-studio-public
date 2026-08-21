import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { capabilityIdSchema } from '../shared/component'
import packageMetadata from '../../package.json' with { type: 'json' }
import { StudioCore } from '../core/studio-core'
import { StudioCoreError, type SuggestedAction } from '../core/project-errors'
import { GithubDiscoveryProvider } from '../adapters/github/github-discovery-provider'
import { createSourceHandoff, type SourceDiscoveryProvider } from '../core/source-discovery'
import {
  discoveryOrderSchema,
  discoverySortSchema,
  sourceProviderSchema,
} from '../shared/source-discovery'
import {
  defaultKeychainService,
  keychainLocatorSchema,
  keychainSecretSchema,
  MacOsKeychainAdapter,
  type KeychainAdapter,
} from '../adapters/keychain/macos-keychain-adapter'

export interface ParsedArguments {
  positionals: string[]
  flags: Map<string, string | true>
}

const exitCodes: Record<string, number> = {
  USAGE_ERROR: 2,
  PROJECT_NOT_FOUND: 3,
  PROJECT_ALREADY_EXISTS: 4,
  PROJECT_INVALID: 5,
  PROJECT_MIGRATION_FAILED: 6,
  PROJECT_INTEGRITY_FAILED: 21,
  PACKAGE_UNSAFE: 24,
  PACKAGE_DESTINATION_INVALID: 25,
  REVISION_CONFLICT: 7,
  COMPONENT_NOT_FOUND: 8,
  COMPONENT_IN_USE: 9,
  COMPONENT_INVALID: 10,
  STACK_INVALID: 11,
  VERSION_NOT_FOUND: 12,
  WORKFLOW_NOT_FOUND: 26,
  WORKFLOW_VERSION_NOT_FOUND: 27,
  WORKFLOW_INVALID: 28,
  WORKFLOW_CYCLE: 29,
  UNSAFE_SOURCE: 13,
  IO_FAILED: 14,
  DISCOVERY_QUERY_INVALID: 15,
  DISCOVERY_NETWORK_FAILED: 16,
  DISCOVERY_RATE_LIMITED: 17,
  DISCOVERY_PROVIDER_FAILED: 18,
  DISCOVERY_PROVIDER_UNAVAILABLE: 19,
  SOURCE_NOT_FOUND: 20,
  OPERATION_CANCELLED: 130,
  KEYCHAIN_FAILED: 22,
  KEYCHAIN_UNAVAILABLE: 23,
  UNEXPECTED: 70,
}

export interface CliDependencies {
  core?: StudioCore
  discovery?: SourceDiscoveryProvider
  signal?: AbortSignal
  now?: () => Date
  keychain?: KeychainAdapter
  readSecretInput?: () => Promise<string>
}

export function parseArguments(args: string[]): ParsedArguments {
  const positionals: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument) continue
    if (!argument.startsWith('--')) {
      positionals.push(argument)
      continue
    }
    const [rawName, inlineValue] = argument.slice(2).split(/=(.*)/s, 2)
    if (!rawName) throw new StudioCoreError('USAGE_ERROR', '无效的命令参数。')
    if (inlineValue !== undefined) {
      flags.set(rawName, inlineValue)
      continue
    }
    const next = args[index + 1]
    if (next && !next.startsWith('--')) {
      flags.set(rawName, next)
      index += 1
    } else {
      flags.set(rawName, true)
    }
  }
  return { positionals, flags }
}

function flag(parsed: ParsedArguments, name: string): string | undefined {
  const value = parsed.flags.get(name)
  return typeof value === 'string' ? value : undefined
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new StudioCoreError('USAGE_ERROR', message)
  return value
}

function requiredUuid(value: string | undefined, message: string): string {
  const parsed = z.uuid().safeParse(required(value, message))
  if (!parsed.success) throw new StudioCoreError('USAGE_ERROR', message)
  return parsed.data
}

function expectedRevision(parsed: ParsedArguments): number | undefined {
  const value = flag(parsed, 'revision')
  if (value === undefined) return undefined
  const revision = Number(value)
  if (!Number.isInteger(revision) || revision < 0) {
    throw new StudioCoreError('USAGE_ERROR', '--revision 必须是非负整数。')
  }
  return revision
}

function integerFlag(
  parsed: ParsedArguments,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = flag(parsed, name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new StudioCoreError(
      'USAGE_ERROR',
      `--${name} 必须是 ${minimum} 至 ${maximum} 之间的整数。`,
    )
  }
  return value
}

function providerFor(parsed: ParsedArguments): 'github' {
  const selected = flag(parsed, 'provider') ?? 'github'
  const parsedProvider = sourceProviderSchema.safeParse(selected)
  if (!parsedProvider.success) {
    throw new StudioCoreError('DISCOVERY_PROVIDER_UNAVAILABLE', `尚不支持发现来源：${selected}。`, {
      suggestedActions: [{ description: '当前可用 Provider：github。' }],
    })
  }
  return parsedProvider.data
}

function discoverySort(parsed: ParsedArguments): 'relevance' | 'stars' | 'forks' | 'updated' {
  const value = flag(parsed, 'sort') ?? 'relevance'
  const result = discoverySortSchema.safeParse(value)
  if (!result.success) {
    throw new StudioCoreError('USAGE_ERROR', '--sort 必须是 relevance、stars、forks 或 updated。')
  }
  return result.data
}

function discoveryOrder(parsed: ParsedArguments): 'desc' | 'asc' {
  const value = flag(parsed, 'order') ?? 'desc'
  const result = discoveryOrderSchema.safeParse(value)
  if (!result.success) throw new StudioCoreError('USAGE_ERROR', '--order 必须是 desc 或 asc。')
  return result.data
}

function usage(): string {
  return `Agent Stack Studio CLI

用法：studio <group> <command> [arguments] [--project <path>] [--json]

项目：project init|inspect|validate|audit|export
组件：component inspect|import|update|archive|delete
Stack：stack add|remove|owner set|validate|freeze
版本：version create|list|inspect
Workflow：workflow create|list|inspect|node-add|node-remove|edge-add|edge-remove|freeze
来源：source search|inspect|handoff
密钥：secret set|status|delete

来源发现只读取公开元数据；handoff 只生成交接计划，不执行下载命令。
secret set 只通过 --stdin 接收原文，输出不会包含密钥。
所有命令均为非交互式；--json 输出稳定 JSON envelope。`
}

function summarize(command: string, data: unknown): string {
  if (command === 'help') return usage()
  if (command === 'version' && data && typeof data === 'object' && 'version' in data) {
    return `Agent Stack Studio ${String(data.version)}`
  }
  if (data && typeof data === 'object' && 'project' in data) {
    const project = (data as { project: { name: string; revision: number } }).project
    return `${command} 完成：${project.name}（revision ${project.revision}）`
  }
  if (command === 'project export' && data && typeof data === 'object' && 'path' in data) {
    return `project export 完成：${String(data.path)}`
  }
  return `${command} 完成。`
}

export async function executeCliCommand(
  parsed: ParsedArguments,
  dependencies: CliDependencies = {},
): Promise<{ command: string; data: unknown; suggestedActions: SuggestedAction[] }> {
  const core = dependencies.core ?? new StudioCore()
  const discovery = dependencies.discovery ?? new GithubDiscoveryProvider()
  const [group, action, ...rest] = parsed.positionals
  if (parsed.flags.has('version')) {
    return { command: 'version', data: { version: packageMetadata.version }, suggestedActions: [] }
  }
  if (!group || group === 'help' || parsed.flags.has('help')) {
    return { command: 'help', data: { usage: usage() }, suggestedActions: [] }
  }
  const rootPath = path.resolve(flag(parsed, 'project') ?? process.cwd())
  const mutation = { expectedRevision: expectedRevision(parsed) }
  const command = `${group} ${action ?? ''}`.trim()

  if (group === 'secret') {
    const keychain = dependencies.keychain ?? new MacOsKeychainAdapter()
    const locatorResult = keychainLocatorSchema.safeParse({
      service: flag(parsed, 'service') ?? defaultKeychainService,
      account: required(rest[0], `secret ${action ?? ''} 需要账户标识。`),
    })
    if (!locatorResult.success) {
      throw new StudioCoreError('USAGE_ERROR', 'Keychain 服务或账户标识无效。')
    }
    const locator = locatorResult.data
    if (action === 'status') {
      return {
        command,
        data: { ...locator, configured: await keychain.has(locator) },
        suggestedActions: [],
      }
    }
    if (action === 'set') {
      if (!parsed.flags.has('stdin')) {
        throw new StudioCoreError('USAGE_ERROR', 'secret set 必须使用 --stdin 接收密钥原文。', {
          suggestedActions: [
            {
              command: `printf '%s' "$SECRET" | studio secret set ${JSON.stringify(locator.account)} --stdin --json`,
              description: '通过标准输入写入，避免密钥进入命令参数。',
            },
          ],
        })
      }
      const secretResult = keychainSecretSchema.safeParse(
        await (dependencies.readSecretInput ?? readSecretFromStandardInput)(),
      )
      if (!secretResult.success) {
        throw new StudioCoreError('USAGE_ERROR', '密钥必须是 1 至 16384 个无换行字符。')
      }
      const secret = secretResult.data
      await keychain.set(locator, secret, flag(parsed, 'label'))
      return {
        command,
        data: { ...locator, configured: true },
        suggestedActions: [
          {
            command: `studio secret status ${JSON.stringify(locator.account)} --json`,
            description: '检查本机钥匙串状态。',
          },
        ],
      }
    }
    if (action === 'delete') {
      return {
        command,
        data: { ...locator, deleted: await keychain.delete(locator) },
        suggestedActions: [],
      }
    }
  }

  if (group === 'source' && action === 'search') {
    const query = required(rest[0], 'source search 需要搜索词。')
    if (query.trim().length < 2) {
      throw new StudioCoreError('DISCOVERY_QUERY_INVALID', '搜索词至少需要两个字符。', {
        suggestedActions: [{ description: '补充能力、框架或仓库关键词。' }],
      })
    }
    const data = await discovery.search(
      {
        provider: providerFor(parsed),
        query,
        sort: discoverySort(parsed),
        order: discoveryOrder(parsed),
        page: integerFlag(parsed, 'page', 1, 1, 10),
        perPage: integerFlag(parsed, 'limit', 10, 1, 50),
      },
      dependencies.signal,
    )
    return {
      command,
      data,
      suggestedActions: data.items.slice(0, 3).map(({ fullName }) => ({
        command: `studio source inspect ${JSON.stringify(fullName)} --provider github --json`,
        description: `检查 ${fullName} 的来源元数据。`,
      })),
    }
  }
  if (group === 'source' && action === 'inspect') {
    const locator = required(rest[0], 'source inspect 需要 owner/repo 或 GitHub URL。')
    const data = await discovery.inspect(
      { provider: providerFor(parsed), locator },
      dependencies.signal,
    )
    return {
      command,
      data,
      suggestedActions: [
        {
          command: `studio source handoff ${JSON.stringify(data.fullName)} --provider github --json`,
          description: '生成可审阅的下载交接计划。',
        },
      ],
    }
  }
  if (group === 'source' && action === 'handoff') {
    const locator = required(rest[0], 'source handoff 需要 owner/repo 或 GitHub URL。')
    const repository = await discovery.inspect(
      { provider: providerFor(parsed), locator },
      dependencies.signal,
    )
    const data = createSourceHandoff(repository, flag(parsed, 'destination'), dependencies.now)
    return {
      command,
      data,
      suggestedActions: data.commands.map(({ executable, args, purpose }) => ({
        command: [executable, ...args.map((argument) => JSON.stringify(argument))].join(' '),
        description:
          purpose === 'clone'
            ? '审阅后由人或 Coding Agent 执行下载。'
            : '下载后先使用 Studio 静态检查。',
      })),
    }
  }

  if (group === 'project' && action === 'init') {
    const target = path.resolve(rest[0] ?? rootPath)
    const name = flag(parsed, 'name') ?? path.basename(target)
    const result = await core.initProject(target, {
      name,
      description: flag(parsed, 'description'),
      executionMode: flag(parsed, 'execution-mode') as never,
    })
    return {
      command,
      data: result,
      suggestedActions: [
        {
          command: `studio project inspect --project ${JSON.stringify(target)} --json`,
          description: '检查新项目。',
        },
      ],
    }
  }
  if (group === 'project' && action === 'inspect') {
    return { command, data: await core.inspectProject(rootPath), suggestedActions: [] }
  }
  if (group === 'project' && action === 'validate') {
    const data = await core.validateProject(rootPath)
    return {
      command,
      data,
      suggestedActions: [
        ...data.validation.issues.flatMap(({ suggestedActions }) =>
          suggestedActions.map((description) => ({ description })),
        ),
        ...data.validation.remediationTasks
          .filter(({ status }) => status === 'required')
          .map(({ title, description }) => ({ description: `${title}：${description}` })),
      ],
    }
  }
  if (group === 'project' && action === 'audit') {
    const data = await core.auditProject(rootPath)
    return {
      command,
      data,
      suggestedActions:
        data.integrity.versionsChecked > 0
          ? [
              {
                command: `studio version list --project ${JSON.stringify(rootPath)} --json`,
                description: '查看已验证的不可变版本。',
              },
            ]
          : [
              {
                command: 'studio stack freeze --json',
                description: 'Stack 验证通过后创建首个不可变版本。',
              },
            ],
    }
  }
  if (group === 'project' && action === 'export') {
    const destination = required(flag(parsed, 'output'), 'project export 需要 --output <path>。')
    const data = await core.exportProjectPackage(rootPath, destination)
    return {
      command,
      data,
      suggestedActions: [
        {
          description:
            '导出包已排除 Keychain 密钥、SQLite、Run、Experiment、Receipt、Artifact 和日志。',
        },
      ],
    }
  }
  if (group === 'component' && action === 'inspect') {
    const sourcePath = required(rest[0], 'component inspect 需要本地来源目录。')
    return { command, data: await core.inspectComponent(sourcePath), suggestedActions: [] }
  }
  if (group === 'workflow' && action === 'create') {
    return {
      command,
      data: await core.createWorkflow(
        rootPath,
        {
          name: required(flag(parsed, 'name'), 'workflow create 需要 --name。'),
          description: flag(parsed, 'description'),
        },
        mutation,
      ),
      suggestedActions: [],
    }
  }
  if (group === 'workflow' && action === 'list') {
    const { project } = await core.inspectProject(rootPath)
    return {
      command,
      data: { projectId: project.id, workflows: core.listWorkflows(project) },
      suggestedActions: [],
    }
  }
  if (group === 'workflow' && action === 'inspect') {
    const workflowId = requiredUuid(rest[0], 'workflow inspect 需要 Workflow UUID。')
    const { project } = await core.inspectProject(rootPath)
    return { command, data: core.inspectWorkflow(project, workflowId), suggestedActions: [] }
  }
  if (group === 'workflow' && action === 'node-add') {
    const workflowId = requiredUuid(rest[0], 'workflow node-add 需要 Workflow UUID。')
    const kind = required(flag(parsed, 'kind'), 'workflow node-add 需要 --kind。')
    const name = required(flag(parsed, 'name'), 'workflow node-add 需要 --name。')
    const reference = required(flag(parsed, 'ref'), 'workflow node-add 需要 --ref。')
    const node =
      kind === 'operation'
        ? ({ kind, name, operation: reference } as const)
        : kind === 'component'
          ? ({
              kind,
              name,
              componentId: requiredUuid(reference, '--ref 必须是 Component UUID。'),
            } as const)
          : kind === 'agent-version'
            ? ({
                kind,
                name,
                agentVersionId: requiredUuid(reference, '--ref 必须是 Agent Version UUID。'),
              } as const)
            : kind === 'workflow-version'
              ? ({
                  kind,
                  name,
                  workflowId: requiredUuid(
                    flag(parsed, 'target-workflow'),
                    'workflow-version 节点需要 --target-workflow UUID。',
                  ),
                  workflowVersionId: requiredUuid(
                    reference,
                    '--ref 必须是 Workflow Version UUID。',
                  ),
                } as const)
              : undefined
    if (!node) {
      throw new StudioCoreError(
        'USAGE_ERROR',
        '--kind 必须是 operation、component、agent-version 或 workflow-version。',
      )
    }
    return {
      command,
      data: await core.addWorkflowNode(rootPath, workflowId, node, mutation),
      suggestedActions: [],
    }
  }
  if (group === 'workflow' && action === 'node-remove') {
    return {
      command,
      data: await core.removeWorkflowNode(
        rootPath,
        requiredUuid(rest[0], 'workflow node-remove 需要 Workflow UUID。'),
        requiredUuid(rest[1], 'workflow node-remove 需要节点 UUID。'),
        mutation,
      ),
      suggestedActions: [],
    }
  }
  if (group === 'workflow' && action === 'edge-add') {
    return {
      command,
      data: await core.addWorkflowEdge(
        rootPath,
        requiredUuid(rest[0], 'workflow edge-add 需要 Workflow UUID。'),
        requiredUuid(rest[1], 'workflow edge-add 需要起点 UUID。'),
        requiredUuid(rest[2], 'workflow edge-add 需要终点 UUID。'),
        mutation,
      ),
      suggestedActions: [],
    }
  }
  if (group === 'workflow' && action === 'edge-remove') {
    return {
      command,
      data: await core.removeWorkflowEdge(
        rootPath,
        requiredUuid(rest[0], 'workflow edge-remove 需要 Workflow UUID。'),
        requiredUuid(rest[1], 'workflow edge-remove 需要边 UUID。'),
        mutation,
      ),
      suggestedActions: [],
    }
  }
  if (group === 'workflow' && action === 'freeze') {
    return {
      command,
      data: await core.freezeWorkflowVersion(
        rootPath,
        requiredUuid(rest[0], 'workflow freeze 需要 Workflow UUID。'),
        mutation,
      ),
      suggestedActions: [],
    }
  }
  if (group === 'component' && action === 'import') {
    const sourcePath = required(rest[0], 'component import 需要本地来源目录。')
    return {
      command,
      data: await core.importComponent(rootPath, sourcePath, mutation),
      suggestedActions: [],
    }
  }
  if (group === 'component' && action === 'update') {
    const componentId = required(rest[0], 'component update 需要组件 ID。')
    const descriptorPath = flag(parsed, 'descriptor')
    const data = descriptorPath
      ? await core.confirmComponentDescriptorFile(rootPath, componentId, descriptorPath, mutation)
      : await core.updateComponent(rootPath, componentId, {
          ...mutation,
          sourcePath: flag(parsed, 'source'),
        })
    return { command, data, suggestedActions: [] }
  }
  if (group === 'component' && action === 'archive') {
    const componentId = required(rest[0], 'component archive 需要组件 ID。')
    return {
      command,
      data: await core.archiveComponent(rootPath, componentId, mutation),
      suggestedActions: [],
    }
  }
  if (group === 'component' && action === 'delete') {
    const componentId = required(rest[0], 'component delete 需要组件 ID。')
    return {
      command,
      data: await core.deleteComponent(rootPath, componentId, mutation),
      suggestedActions: [],
    }
  }
  if (group === 'stack' && action === 'add') {
    const componentId = required(rest[0], 'stack add 需要组件 ID。')
    return {
      command,
      data: await core.addStackComponent(rootPath, componentId, mutation),
      suggestedActions: [],
    }
  }
  if (group === 'stack' && action === 'remove') {
    const componentId = required(rest[0], 'stack remove 需要组件 ID。')
    return {
      command,
      data: await core.removeStackComponent(rootPath, componentId, mutation),
      suggestedActions: [],
    }
  }
  if (group === 'stack' && action === 'owner' && rest[0] === 'set') {
    const capability = capabilityIdSchema.parse(
      required(rest[1], 'stack owner set 需要 capability。'),
    )
    const componentId = required(rest[2], 'stack owner set 需要组件 ID。')
    return {
      command: 'stack owner set',
      data: await core.setOwner(rootPath, capability, componentId, mutation),
      suggestedActions: [],
    }
  }
  if (group === 'stack' && action === 'validate') {
    const data = await core.validateProject(rootPath)
    return {
      command,
      data,
      suggestedActions: data.validation.issues.flatMap(({ suggestedActions }) =>
        suggestedActions.map((description) => ({ description })),
      ),
    }
  }
  if (group === 'stack' && action === 'freeze') {
    return { command, data: await core.freezeVersion(rootPath, mutation), suggestedActions: [] }
  }
  if (group === 'version' && action === 'create') {
    return { command, data: await core.freezeVersion(rootPath, mutation), suggestedActions: [] }
  }
  if (group === 'version' && action === 'list') {
    const { project } = await core.inspectProject(rootPath)
    return {
      command,
      data: { projectId: project.id, versions: core.listVersions(project) },
      suggestedActions: [],
    }
  }
  if (group === 'version' && action === 'inspect') {
    const identity = required(rest[0], 'version inspect 需要版本号或版本 ID。')
    const { project } = await core.inspectProject(rootPath)
    return { command, data: core.inspectVersion(project, identity), suggestedActions: [] }
  }
  throw new StudioCoreError('USAGE_ERROR', `未知命令：${command || group}`, {
    suggestedActions: [{ command: 'studio help', description: '查看可用命令。' }],
  })
}

async function readSecretFromStandardInput(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new StudioCoreError('USAGE_ERROR', '未检测到标准输入。请把密钥通过管道传入。')
  }
  let value = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    value += chunk
    if (value.length > 16_386) {
      throw new StudioCoreError('USAGE_ERROR', '密钥原文超过 16384 个字符。')
    }
  }
  const normalized = value.replace(/\r?\n$/, '')
  if (!normalized) throw new StudioCoreError('USAGE_ERROR', '标准输入中的密钥原文不能为空。')
  return normalized
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2))
  const json = parsed.flags.has('json')
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  // CLI 从不提示输入；该标志用于调用方显式记录契约意图。
  parsed.flags.has('non-interactive')
  try {
    const result = await executeCliCommand(parsed, { signal: controller.signal })
    if (json) console.log(JSON.stringify({ ok: true, ...result }))
    else console.log(summarize(result.command, result.data))
  } catch (error) {
    const known =
      error instanceof StudioCoreError
        ? error
        : new StudioCoreError('UNEXPECTED', error instanceof Error ? error.message : '未知错误。')
    const payload = {
      ok: false,
      error: { code: known.code, message: known.message, details: known.details },
      suggestedActions: known.suggestedActions,
    }
    if (json) console.error(JSON.stringify(payload))
    else {
      console.error(`${known.code}: ${known.message}`)
      for (const action of known.suggestedActions) console.error(`建议：${action.description}`)
    }
    process.exitCode = exitCodes[known.code] ?? exitCodes.UNEXPECTED
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
