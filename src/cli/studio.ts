import path from 'node:path'
import { access, constants, mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { capabilityIdSchema } from '../shared/component'
import packageMetadata from '../../package.json' with { type: 'json' }
import { StudioCore } from '../core/studio-core'
import { NativeAgentCore } from '../core/native-agent-core'
import { HostDriverRegistry } from '../adapters/harness/host-driver-registry'
import { agentProfileSchema } from '../shared/agent-profile'
import { harnessIdSchema } from '../shared/native-agent'
import { harnessIdFromAdapter, knownHarnessComponentIds } from '../core/known-harnesses'
import type { NativeAgentResult } from '../shared/native-agent'
import { StudioCoreError, type SuggestedAction } from '../core/project-errors'
import type { PublishService } from '../main/publishing/publish-service'
import type { CliPublishingHandle } from './publish-host'
import { CustomizationService } from '../main/customization/customization-service'
import { knownInstallRecipes } from '../core/install-recipes'
import type {
  CustomizationInstallInput,
  CustomizationRecognitionInput,
  CustomizationTaskInput,
} from '../shared/customization'
import { multicaCliTargetId } from '../shared/publish'
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
import { redactSensitiveText, sanitizeDiagnosticValue } from '../shared/sensitive-data'
import {
  ChildProcessCompatibilityRuntime,
  type TrustedCompatibilityRuntimeGateway,
} from '../core/trusted-compatibility-runtime'
import { buildStudioDoctorReport } from '../core/studio-doctor'
import type { StudioDoctorFacts } from '../shared/doctor'
import { MulticaCliPublisher } from '../main/connectors/multica-cli-publisher'
import { probeMulticaReadiness } from '../main/doctor/studio-doctor-service'
import { modelAuthMethodSchema, modelConfigurationSchema } from '../shared/model-auth'
import type { ModelAuthController } from '../main/model-auth/model-auth-controller'
import type { CliModelAuthHandle } from './model-auth-host'

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
  DISCOVERY_TIMEOUT: 16,
  DISCOVERY_RATE_LIMITED: 17,
  DISCOVERY_PROVIDER_FAILED: 18,
  DISCOVERY_PROVIDER_UNAVAILABLE: 19,
  SOURCE_NOT_FOUND: 20,
  OPERATION_CANCELLED: 130,
  KEYCHAIN_FAILED: 22,
  KEYCHAIN_UNAVAILABLE: 23,
  HARNESS_NOT_AVAILABLE: 30,
  HARNESS_AUTHENTICATION_REQUIRED: 31,
  HARNESS_FAILED: 32,
  HARNESS_TIMEOUT: 33,
  MULTICA_CLI_UNAVAILABLE: 40,
  MULTICA_AUTHENTICATION_REQUIRED: 41,
  MULTICA_RUNTIME_REQUIRED: 42,
  MULTICA_VALIDATION_FAILED: 43,
  MULTICA_PUBLISH_FAILED: 44,
  MULTICA_REMOTE_DRIFT: 45,
  CUSTOMIZATION_RECIPE_NOT_FOUND: 46,
  CUSTOMIZATION_INTEGRITY_FAILED: 47,
  CUSTOMIZATION_INSTALL_FAILED: 48,
  CUSTOMIZATION_NOT_INSTALLED: 49,
  CUSTOMIZATION_SMOKE_FAILED: 50,
  CUSTOMIZATION_UNINSTALL_FAILED: 51,
  UNEXPECTED: 70,
}

export interface CliDependencies {
  core?: StudioCore
  discovery?: SourceDiscoveryProvider
  signal?: AbortSignal
  now?: () => Date
  keychain?: KeychainAdapter
  readSecretInput?: () => Promise<string>
  compatibilityRuntime?: TrustedCompatibilityRuntimeGateway
  nativeAgent?: NativeAgentCore
  publishing?: Pick<PublishService, 'preview' | 'publish' | 'status' | 'history' | 'runtimes'>
  publishingAgentId?: string
  customization?: Pick<
    CustomizationService,
    'recognize' | 'task' | 'install' | 'check' | 'smoke' | 'uninstall' | 'restore' | 'cancel'
  >
  doctorFacts?: () => Promise<StudioDoctorFacts>
  modelAuth?: Pick<
    ModelAuthController,
    | 'view'
    | 'select'
    | 'configureApiKey'
    | 'launchOfficialLogin'
    | 'refreshAuthentication'
    | 'verify'
  >
}

export interface CliNotice {
  code: 'DEPRECATED_COMMAND'
  message: string
  replacement?: string
}

export interface CliCommandResult {
  command: string
  data: unknown
  suggestedActions: SuggestedAction[]
  notices?: CliNotice[]
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

Agent：agent create|inspect|configure|validate|freeze|versions|version|export|model|secret
Harness：harness inspect|list|import|select|remove
组件：component inspect|list|import|attach|detach|update|archive|restore|contract-test|runtime-validate|delete
对话：chat send|list（--message；可复用 --session）
单次运行：run（非交互，--message；支持 --idempotency-key）
定制：customize search|inspect|handoff|list|check|task|install|update|smoke|uninstall|restore
发布：publish runtimes|validate|publish|status（--runtime-id；publish 需 --confirm）
诊断：doctor

customize inspect/task 只做静态识别；install/update 只接受固定提交与 SHA-256 方案。
chat/run 只调用本机真实 Pi、OpenClaw 或 Codex CLI，不用 fixture 冒充成功。

兼容期仍接受 project、stack、version、workflow、source 和 secret；
--json envelope 会在 notices 中返回 DEPRECATED_COMMAND 与替代命令。

来源发现只读取公开元数据；handoff 只生成交接计划，不执行下载命令。
secret set 只通过 --stdin 接收原文，输出不会包含密钥。
run 始终非交互；chat send 可由人类终端或 Agent 调用；--json 输出稳定 JSON envelope。`
}

async function createCliPublishing(
  rootPath: string,
  core: StudioCore,
  dataRootOverride?: string,
): Promise<CliPublishingHandle> {
  const moduleUrl = new URL('./publish-host.mjs', import.meta.url).href
  const loaded: unknown = await import(moduleUrl)
  const host = loaded as {
    createCliPublishing(
      rootPath: string,
      core: StudioCore,
      dataRootOverride?: string,
    ): Promise<CliPublishingHandle>
  }
  return host.createCliPublishing(rootPath, core, dataRootOverride)
}

async function createCliModelAuthentication(
  rootPath: string,
  core: StudioCore,
  dataRootOverride?: string,
): Promise<CliModelAuthHandle> {
  const moduleUrl = new URL('./model-auth-host.mjs', import.meta.url).href
  const loaded: unknown = await import(moduleUrl)
  const host = loaded as {
    createCliModelAuth(
      rootPath: string,
      core: StudioCore,
      dataRootOverride?: string,
    ): Promise<CliModelAuthHandle>
  }
  return host.createCliModelAuth(rootPath, core, dataRootOverride)
}

interface ProductCommandRoute {
  parsed: ParsedArguments
  command?: string
  filterHarnesses?: boolean
}

function withPositionals(parsed: ParsedArguments, positionals: string[]): ParsedArguments {
  return { positionals, flags: parsed.flags }
}

function withInternalFlag(parsed: ParsedArguments, name: string): ParsedArguments {
  const flags = new Map(parsed.flags)
  flags.set(name, true)
  return { positionals: parsed.positionals, flags }
}

function routeProductCommand(parsed: ParsedArguments): ProductCommandRoute {
  const [group, action, ...rest] = parsed.positionals
  if (group === 'agent') {
    if (action === 'create') {
      const requestedMode = flag(parsed, 'execution-mode')
      if (requestedMode && requestedMode !== 'external-harness') {
        throw new StudioCoreError(
          'USAGE_ERROR',
          'agent create 只创建 Native Harness Agent；旧执行模式只供显式迁移兼容。',
          {
            suggestedActions: [
              {
                description:
                  '新 Agent 请省略 --execution-mode；收束旧项目时使用带弃用提示的 project init 兼容命令。',
              },
            ],
          },
        )
      }
      return {
        parsed: withPositionals(parsed, ['project', 'init', ...rest]),
        command: 'agent create',
      }
    }
    if (['inspect', 'validate', 'export'].includes(action ?? '')) {
      return {
        parsed: withPositionals(parsed, ['project', action, ...rest]),
        command: `agent ${action}`,
      }
    }
    if (action === 'freeze') {
      return {
        parsed: withInternalFlag(
          withPositionals(parsed, ['stack', 'freeze', ...rest]),
          'product-agent-freeze',
        ),
        command: 'agent freeze',
      }
    }
    if (action === 'versions') {
      return {
        parsed: withPositionals(parsed, ['version', 'list', ...rest]),
        command: 'agent versions',
      }
    }
    if (action === 'version') {
      return {
        parsed: withPositionals(parsed, ['version', 'inspect', ...rest]),
        command: 'agent version',
      }
    }
    if (action === 'secret') {
      const [secretAction, ...secretRest] = rest
      return {
        parsed: withPositionals(parsed, ['secret', secretAction ?? '', ...secretRest]),
        command: `agent secret ${secretAction ?? ''}`.trim(),
      }
    }
    if (action === 'model') {
      const [modelAction, ...modelRest] = rest
      return {
        parsed: withPositionals(parsed, ['model-auth', modelAction ?? 'status', ...modelRest]),
        command: `agent model ${modelAction ?? 'status'}`,
      }
    }
  }
  if (group === 'harness') {
    if (['inspect', 'import'].includes(action ?? '')) {
      return {
        parsed: withPositionals(parsed, ['component', action, ...rest]),
        command: `harness ${action}`,
      }
    }
    if (['list', 'select', 'remove'].includes(action ?? '')) return { parsed }
  }
  if (group === 'component' && action === 'attach') {
    return {
      parsed: withPositionals(parsed, ['stack', 'add', ...rest]),
      command: 'component attach',
    }
  }
  if (group === 'component' && action === 'detach') {
    return {
      parsed: withPositionals(parsed, ['stack', 'remove', ...rest]),
      command: 'component detach',
    }
  }
  if (group === 'customize' && ['search', 'handoff'].includes(action ?? '')) {
    return {
      parsed: withPositionals(parsed, ['source', action, ...rest]),
      command: `customize ${action}`,
    }
  }
  if (
    group === 'customize' &&
    [
      'list',
      'check',
      'inspect',
      'task',
      'install',
      'update',
      'smoke',
      'uninstall',
      'restore',
    ].includes(action ?? '')
  ) {
    return {
      parsed: withPositionals(parsed, ['customization', action, ...rest]),
      command: `customize ${action}`,
    }
  }
  return { parsed }
}

function legacyCommandNotice(parsed: ParsedArguments): CliNotice | undefined {
  const [group, action, ...rest] = parsed.positionals
  const replacements: Record<string, string> = {
    'project init': 'studio agent create',
    'project inspect': 'studio agent inspect',
    'project validate': 'studio agent validate',
    'project audit': 'studio doctor',
    'project export': 'studio agent export',
    'stack add': 'studio component attach',
    'stack remove': 'studio component detach',
    'stack validate': 'studio agent validate',
    'stack freeze': 'studio agent freeze',
    'version create': 'studio agent freeze',
    'version list': 'studio agent versions',
    'version inspect': 'studio agent version',
    'source search': 'studio customize search',
    'source inspect': 'studio customize inspect',
    'source handoff': 'studio customize handoff',
    'secret set': 'studio agent secret set',
    'secret status': 'studio agent secret status',
    'secret delete': 'studio agent secret delete',
  }
  const identity = `${group ?? ''} ${action ?? ''}`.trim()
  const replacement = replacements[identity]
  if (replacement) {
    return {
      code: 'DEPRECATED_COMMAND',
      message: `${identity} 是兼容命令；请迁移到产品命令 ${replacement}。`,
      replacement,
    }
  }
  if (group === 'workflow' || (group === 'stack' && action === 'owner' && rest[0] === 'set')) {
    return {
      code: 'DEPRECATED_COMMAND',
      message: `${identity} 已移入高级兼容路径；普通 Agent 创建不再要求操作该模型。`,
    }
  }
  return undefined
}

function summarize(command: string, data: unknown): string {
  if (command === 'help') return usage()
  if (command === 'version' && data && typeof data === 'object' && 'version' in data) {
    return `Agent Stack Studio ${String(data.version)}`
  }
  if (command === 'doctor' && data && typeof data === 'object' && 'status' in data) {
    const report = data as {
      status: string
      counts: { passed: number; warnings: number; blocking: number }
    }
    return `doctor ${report.status}：${report.counts.passed} 项通过，${report.counts.warnings} 项警告，${report.counts.blocking} 项阻断。`
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

function assertNativeSucceeded(result: NativeAgentResult): NativeAgentResult {
  if (result.status === 'succeeded') return result
  const message = result.failure?.message ?? 'Harness 执行失败。'
  const code =
    result.status === 'cancelled'
      ? 'OPERATION_CANCELLED'
      : result.status === 'timed-out'
        ? 'HARNESS_TIMEOUT'
        : message.includes('认证')
          ? 'HARNESS_AUTHENTICATION_REQUIRED'
          : message.includes('未找到') ||
              message.includes('需要固定版本') ||
              message.includes('最低需要')
            ? 'HARNESS_NOT_AVAILABLE'
            : 'HARNESS_FAILED'
  throw new StudioCoreError(code, message, {
    details: { result },
    suggestedActions: [
      {
        command: 'studio harness list --json',
        description: '检查 Harness 安装、固定版本和认证状态。',
      },
    ],
  })
}

async function collectCliDoctorFacts(options: {
  core: StudioCore
  nativeAgent: NativeAgentCore
  rootPath: string
  signal?: AbortSignal
}): Promise<StudioDoctorFacts> {
  const launcherPath = process.env.STUDIO_CLI_LAUNCHER
  const bundledCliRuntime = Boolean(launcherPath && process.versions.electron)
  const cliExecutable = await access(launcherPath ?? process.argv[1] ?? '', constants.X_OK).then(
    () => true,
    () => false,
  )
  let project: StudioDoctorFacts['project']
  try {
    const inspected = await options.core.inspectProject(options.rootPath)
    project = {
      status: 'healthy',
      name: inspected.project.name,
      revision: inspected.project.revision,
      formatVersion: inspected.project.formatVersion,
      versionsChecked: inspected.integrity.versionsChecked,
      message: '项目事实、内容哈希和不可变版本已验证。',
    }
  } catch (error) {
    const missing = error instanceof StudioCoreError && error.code === 'PROJECT_NOT_FOUND'
    project = {
      status: missing ? 'missing' : 'failed',
      name: null,
      revision: null,
      formatVersion: null,
      versionsChecked: 0,
      message: missing
        ? '指定位置不包含 .agent-stack 项目。'
        : `项目完整性检查失败：${redactSensitiveText(error instanceof Error ? error.message : '未知错误')}`,
    }
  }
  const [harnesses, multica] = await Promise.all([
    options.nativeAgent.probes(),
    probeMulticaReadiness(new MulticaCliPublisher({ cwd: options.rootPath }), options.signal),
  ])
  return {
    application: {
      version: packageMetadata.version,
      platform: process.platform,
      architecture: process.arch,
      packaged: Boolean(launcherPath),
      cliExecutable,
      bundledCliRuntime,
    },
    data: null,
    project,
    harnesses,
    multica,
  }
}

async function executeCliCommandInternal(
  parsed: ParsedArguments,
  dependencies: CliDependencies = {},
): Promise<CliCommandResult> {
  const core = dependencies.core ?? new StudioCore()
  const nativeAgent = dependencies.nativeAgent ?? new NativeAgentCore(new HostDriverRegistry())
  const discovery = dependencies.discovery ?? new GithubDiscoveryProvider()
  const [group, action, ...rest] = parsed.positionals
  if (parsed.flags.get('version') === true) {
    return { command: 'version', data: { version: packageMetadata.version }, suggestedActions: [] }
  }
  if (!group || group === 'help' || parsed.flags.has('help')) {
    return { command: 'help', data: { usage: usage() }, suggestedActions: [] }
  }
  const rootPath = path.resolve(flag(parsed, 'project') ?? process.cwd())
  const mutation = { expectedRevision: expectedRevision(parsed) }
  const command = `${group} ${action ?? ''}`.trim()

  if (group === 'doctor' && (!action || action === 'project')) {
    const facts = dependencies.doctorFacts
      ? await dependencies.doctorFacts()
      : await collectCliDoctorFacts({ core, nativeAgent, rootPath, signal: dependencies.signal })
    const data = buildStudioDoctorReport(facts, dependencies.now)
    return {
      command: 'doctor',
      data,
      suggestedActions: data.checks
        .filter(({ status, remediation }) => status !== 'pass' && remediation)
        .map(({ remediation }) => ({ description: remediation! })),
    }
  }

  if (group === 'agent' && action === 'configure') {
    const profilePath = path.resolve(
      required(flag(parsed, 'profile'), 'agent configure 需要 --profile <JSON 文件>。'),
    )
    let profile: unknown
    try {
      profile = JSON.parse(await readFile(profilePath, 'utf8'))
    } catch (error) {
      throw new StudioCoreError('USAGE_ERROR', '无法读取或解析 Profile JSON。', { cause: error })
    }
    const parsedProfile = agentProfileSchema.safeParse(profile)
    if (!parsedProfile.success) {
      throw new StudioCoreError('USAGE_ERROR', 'Profile JSON 不符合 Agent Profile 契约。', {
        details: { issues: parsedProfile.error.issues },
      })
    }
    return {
      command,
      data: await core.updateAgentProfile(rootPath, parsedProfile.data, mutation),
      suggestedActions: [],
    }
  }

  if (group === 'model-auth') {
    const owned = dependencies.modelAuth
      ? null
      : await createCliModelAuthentication(rootPath, core, flag(parsed, 'data-dir'))
    const modelAuth = dependencies.modelAuth ?? owned!.controller
    try {
      if (!action || action === 'status') {
        return {
          command,
          data: await modelAuth.view(),
          suggestedActions: [],
        }
      }
      if (action === 'configure') {
        if (parsed.flags.has('key') || parsed.flags.has('api-key')) {
          throw new StudioCoreError(
            'USAGE_ERROR',
            'API Key 原文不得出现在命令参数中；请使用 --stdin。',
          )
        }
        const revision = expectedRevision(parsed)
        if (revision === undefined) {
          throw new StudioCoreError('USAGE_ERROR', 'agent model configure 需要 --revision <n>。')
        }
        const method = modelAuthMethodSchema.parse(
          required(flag(parsed, 'auth-method'), 'agent model configure 需要 --auth-method。'),
        )
        const modelConfiguration = modelConfigurationSchema.parse({
          providerId: required(flag(parsed, 'provider'), 'agent model configure 需要 --provider。'),
          modelId: required(flag(parsed, 'model'), 'agent model configure 需要 --model。'),
          credentialRequirement: {
            method,
            credentialKind: method === 'api-key' ? 'api-key' : 'harness-session',
          },
        })
        await modelAuth.select({ expectedRevision: revision, modelConfiguration })
        let data
        if (method === 'api-key') {
          if (!parsed.flags.has('stdin')) {
            throw new StudioCoreError('USAGE_ERROR', 'API Key 认证必须使用 --stdin 接收原文。')
          }
          const secret = keychainSecretSchema.parse(
            await (dependencies.readSecretInput ?? readSecretFromStandardInput)(),
          )
          data = await modelAuth.configureApiKey(secret)
        } else if (method === 'official-login') {
          data = await modelAuth.launchOfficialLogin()
        } else {
          data = await modelAuth.refreshAuthentication()
        }
        return {
          command,
          data,
          suggestedActions: [
            {
              command: 'studio agent model verify --confirm-cost --json',
              description: '认证状态有效后，主动发起一次最小模型验证。',
            },
          ],
        }
      }
      if (action === 'verify') {
        if (!parsed.flags.has('confirm-cost')) {
          throw new StudioCoreError(
            'USAGE_ERROR',
            '验证可能产生少量模型调用费用；必须显式传入 --confirm-cost。',
          )
        }
        const data = await modelAuth.verify(
          {
            requestId: crypto.randomUUID(),
            costAcknowledged: true,
            timeoutMs: integerFlag(parsed, 'timeout-ms', 120_000, 1_000, 300_000),
          },
          { signal: dependencies.signal },
        )
        return { command, data, suggestedActions: [] }
      }
      throw new StudioCoreError(
        'USAGE_ERROR',
        'agent model 需要 status、configure 或 verify 子命令。',
      )
    } finally {
      owned?.close()
    }
  }

  if (group === 'customization') {
    const customization =
      dependencies.customization ?? new CustomizationService({ core, now: dependencies.now })
    if (action === 'restore') {
      if (!parsed.flags.has('confirm')) {
        throw new StudioCoreError('USAGE_ERROR', 'customize restore 需要 --confirm。')
      }
      const revision = expectedRevision(parsed)
      if (revision === undefined) {
        throw new StudioCoreError('USAGE_ERROR', 'customize restore 需要 --revision <n>。')
      }
      return {
        command,
        data: await customization.restore({
          projectPath: rootPath,
          snapshotId: required(rest[0], 'customize restore 需要 snapshot ID。'),
          expectedRevision: revision,
          confirmed: true,
        }),
        suggestedActions: [],
      }
    }
    const harness = harnessIdSchema.safeParse(flag(parsed, 'harness'))
    if (!harness.success) {
      throw new StudioCoreError('USAGE_ERROR', 'customize 需要 --harness pi|openclaw|codex。')
    }
    if (action === 'list') {
      return {
        command,
        data: {
          recipes: knownInstallRecipes.filter(({ supportedHarnesses }) =>
            supportedHarnesses.includes(harness.data),
          ),
        },
        suggestedActions: [],
      }
    }
    if (action === 'check') {
      return {
        command,
        data: {
          recipes: await customization.check({ projectPath: rootPath, harnessId: harness.data }),
        },
        suggestedActions: [],
      }
    }
    const source = required(
      rest[0],
      `customize ${action ?? ''} 需要来源、recipe ID 或 snapshot ID。`,
    )
    if (action === 'inspect') {
      const input: CustomizationRecognitionInput = { source, harnessId: harness.data }
      return {
        command,
        data: await customization.recognize(input),
        suggestedActions: [
          {
            command: `studio customize task ${JSON.stringify(source)} --harness ${harness.data} --json`,
            description: '生成可审阅的 Coding Agent Markdown 任务。',
          },
        ],
      }
    }
    if (action === 'task') {
      const input: CustomizationTaskInput = {
        source,
        harnessId: harness.data,
        projectPath: rootPath,
        ...(flag(parsed, 'goal') ? { goal: flag(parsed, 'goal')! } : {}),
      }
      const task = await customization.task(input)
      const output = flag(parsed, 'output')
      if (output) {
        const outputPath = path.resolve(output)
        await mkdir(path.dirname(outputPath), { recursive: true })
        await writeFile(outputPath, `${task.markdown.trimEnd()}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        })
        return {
          command,
          data: { ...task, outputPath },
          suggestedActions: [{ description: '把任务文件交给选定的 Coding Agent 审阅执行。' }],
        }
      }
      return { command, data: task, suggestedActions: [] }
    }
    if (action === 'smoke') {
      return {
        command,
        data: await customization.smoke({
          projectPath: rootPath,
          recipeId: source,
          harnessId: harness.data,
        }),
        suggestedActions: [],
      }
    }
    if (action === 'install' || action === 'update') {
      if (!parsed.flags.has('confirm')) {
        throw new StudioCoreError(
          'USAGE_ERROR',
          `customize ${action} 需要 --confirm，表示已检查固定提交、校验和、License 与快照范围。`,
        )
      }
      const revision = expectedRevision(parsed)
      if (revision === undefined) {
        throw new StudioCoreError('USAGE_ERROR', `customize ${action} 需要 --revision <n>。`)
      }
      const installInput: CustomizationInstallInput = {
        projectPath: rootPath,
        recipeId: source,
        harnessId: harness.data,
        ...(flag(parsed, 'source')
          ? { localSourcePath: path.resolve(flag(parsed, 'source')!) }
          : {}),
        expectedRevision: revision,
        confirmed: true,
        operation: action,
      }
      const onAbort = () => customization.cancel()
      dependencies.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        return {
          command,
          data: await customization.install(installInput),
          suggestedActions: [
            {
              command: `studio agent inspect --project ${JSON.stringify(rootPath)} --json`,
              description: '检查 Skill 已写入共享 .agent-stack Profile。',
            },
          ],
        }
      } finally {
        dependencies.signal?.removeEventListener('abort', onAbort)
      }
    }
    if (action === 'uninstall') {
      if (!parsed.flags.has('confirm')) {
        throw new StudioCoreError('USAGE_ERROR', 'customize uninstall 需要 --confirm。')
      }
      const revision = expectedRevision(parsed)
      if (revision === undefined) {
        throw new StudioCoreError('USAGE_ERROR', 'customize uninstall 需要 --revision <n>。')
      }
      return {
        command,
        data: await customization.uninstall({
          projectPath: rootPath,
          recipeId: source,
          harnessId: harness.data,
          expectedRevision: revision,
          confirmed: true,
        }),
        suggestedActions: [],
      }
    }
    throw new StudioCoreError(
      'USAGE_ERROR',
      'customize 需要 list、check、inspect、task、install、update、smoke、uninstall 或 restore 子命令。',
    )
  }

  if (group === 'publish') {
    const owned = dependencies.publishing
      ? null
      : await createCliPublishing(rootPath, core, flag(parsed, 'data-dir'))
    const publishing = dependencies.publishing ?? owned!.service
    try {
      if (action === 'runtimes') {
        try {
          return {
            command,
            data: { runtimes: await publishing.runtimes() },
            suggestedActions: [],
          }
        } catch {
          throw new StudioCoreError(
            'MULTICA_CLI_UNAVAILABLE',
            'Multica Runtime 查询失败或超时；未执行远端写入。',
          )
        }
      }
      const { project } = await core.inspectProject(rootPath)
      const versionIdentity = flag(parsed, 'version') ?? project.versions.at(-1)?.id
      if (!versionIdentity) {
        throw new StudioCoreError('VERSION_NOT_FOUND', '发布前需要先冻结 Agent Version。', {
          suggestedActions: [
            { command: 'studio agent freeze --json', description: '冻结当前可验证配置。' },
          ],
        })
      }
      const version = core.inspectVersion(project, versionIdentity)
      const runtimeValue = flag(parsed, 'runtime-id')
      const runtimeId = runtimeValue
        ? requiredUuid(runtimeValue, '--runtime-id 必须是 Multica Runtime UUID。')
        : undefined
      const input = {
        targetId: multicaCliTargetId,
        agentId: owned?.agentId ?? dependencies.publishingAgentId ?? project.id,
        agentVersionId: version.id,
        ...(runtimeId ? { runtimeId } : {}),
      }
      if (action === 'validate') {
        return {
          command,
          data: await publishing.preview(input),
          suggestedActions: [],
        }
      }
      if (action === 'status') {
        return {
          command,
          data: {
            remote: await publishing.status(input),
            history: publishing.history(multicaCliTargetId, input.agentId),
          },
          suggestedActions: [],
        }
      }
      if (action === 'publish') {
        if (!parsed.flags.has('confirm')) {
          throw new StudioCoreError(
            'USAGE_ERROR',
            '真实发布需要 --confirm，表示已检查 payload 与远端写入范围。',
          )
        }
        const preview = await publishing.preview(input)
        if (preview.validation.status !== 'ready') {
          const first = preview.validation.issues.find(({ severity }) => severity === 'blocking')
          const code =
            first?.code === 'MULTICA_CLI_NOT_INSTALLED' || first?.code === 'MULTICA_CLI_UNSUPPORTED'
              ? 'MULTICA_CLI_UNAVAILABLE'
              : first?.code === 'MULTICA_AUTHENTICATION_REQUIRED'
                ? 'MULTICA_AUTHENTICATION_REQUIRED'
                : first?.code === 'MULTICA_RUNTIME_REQUIRED'
                  ? 'MULTICA_RUNTIME_REQUIRED'
                  : 'MULTICA_VALIDATION_FAILED'
          throw new StudioCoreError(code, first?.message ?? 'Multica 发布预检未通过。', {
            details: { validation: preview.validation },
          })
        }
        const result = await publishing.publish({ ...input, confirmed: true })
        if (result.receipt.status !== 'succeeded') {
          throw new StudioCoreError(
            result.receipt.failure?.code === 'MULTICA_AUTHENTICATION_REQUIRED'
              ? 'MULTICA_AUTHENTICATION_REQUIRED'
              : 'MULTICA_PUBLISH_FAILED',
            result.receipt.failure?.message ?? 'Multica 发布失败。',
            { details: { receipt: result.receipt } },
          )
        }
        return {
          command,
          data: result,
          suggestedActions: [
            {
              command: `studio publish status --version ${version.id} --json`,
              description: '从 Multica 重新读取并核对远端内容哈希。',
            },
          ],
        }
      }
      throw new StudioCoreError(
        'USAGE_ERROR',
        'publish 需要 runtimes、validate、publish 或 status 子命令。',
      )
    } finally {
      owned?.close()
    }
  }

  if (group === 'harness' && action === 'list') {
    const probes = await nativeAgent.probes()
    let selected: string | null = null
    let components: unknown[] = []
    try {
      const { project } = await core.inspectProject(rootPath)
      components = project.components.filter((component) =>
        component.descriptor.provides.some(
          ({ capability }) => capability === 'execution-controller',
        ),
      )
      const componentMap = new Map(project.components.map((component) => [component.id, component]))
      const owner = project.stack.capabilityOwners.find(
        ({ capability }) => capability === 'execution-controller',
      )
      selected = harnessIdFromAdapter(
        owner ? (componentMap.get(owner.componentId)?.descriptor.runtimeAdapter ?? null) : null,
      )
    } catch (error) {
      if (!(error instanceof StudioCoreError) || error.code !== 'PROJECT_NOT_FOUND') throw error
    }
    return { command, data: { selected, harnesses: probes, components }, suggestedActions: [] }
  }
  if (group === 'harness' && action === 'select') {
    const harnessResult = harnessIdSchema.safeParse(rest[0])
    if (!harnessResult.success) {
      const legacyId = z.uuid().safeParse(rest[0])
      if (!legacyId.success) {
        throw new StudioCoreError(
          'USAGE_ERROR',
          'harness select 需要 pi、openclaw、codex 或兼容期 Harness UUID。',
        )
      }
      return {
        command,
        data: await core.addStackComponent(rootPath, legacyId.data, mutation),
        suggestedActions: [
          { description: 'UUID 选择是兼容路径；新项目请直接选择 pi、openclaw 或 codex。' },
        ],
      }
    }
    return {
      command,
      data: await core.selectKnownHarness(rootPath, harnessResult.data, mutation),
      suggestedActions: [
        {
          command: `studio harness list --project ${JSON.stringify(rootPath)} --json`,
          description: '确认 Host Driver 固定版本与本机可用状态。',
        },
      ],
    }
  }
  if (group === 'harness' && action === 'remove') {
    const harnessResult = harnessIdSchema.safeParse(rest[0])
    if (!harnessResult.success) {
      const legacyId = z.uuid().safeParse(rest[0])
      if (!legacyId.success) {
        throw new StudioCoreError(
          'USAGE_ERROR',
          'harness remove 需要 pi、openclaw、codex 或兼容期 Harness UUID。',
        )
      }
      return {
        command,
        data: await core.removeStackComponent(rootPath, legacyId.data, mutation),
        suggestedActions: [],
      }
    }
    return {
      command,
      data: await core.removeStackComponent(
        rootPath,
        knownHarnessComponentIds[harnessResult.data],
        mutation,
      ),
      suggestedActions: [],
    }
  }

  if (group === 'chat' && action === 'list') {
    return {
      command,
      data: { results: await nativeAgent.list(rootPath, 'chat') },
      suggestedActions: [],
    }
  }
  if (group === 'chat' && (action === 'send' || !action)) {
    const sessionValue = flag(parsed, 'session')
    const requestValue = flag(parsed, 'request-id')
    const sessionId = sessionValue
      ? requiredUuid(sessionValue, '--session 必须是 UUID。')
      : undefined
    const requestId = requestValue
      ? requiredUuid(requestValue, '--request-id 必须是 UUID。')
      : undefined
    const owned = dependencies.nativeAgent
      ? null
      : await createCliModelAuthentication(rootPath, core, flag(parsed, 'data-dir'))
    try {
      const result = await (dependencies.nativeAgent ?? owned!.nativeAgent).execute(
        {
          projectPath: rootPath,
          kind: 'chat',
          message: required(flag(parsed, 'message') ?? rest[0], 'chat send 需要 --message。'),
          requestId,
          sessionId,
          timeoutMs: integerFlag(parsed, 'timeout-ms', 120_000, 1_000, 900_000),
          idempotencyKey: flag(parsed, 'idempotency-key'),
        },
        { signal: dependencies.signal },
      )
      return { command: 'chat send', data: assertNativeSucceeded(result), suggestedActions: [] }
    } finally {
      owned?.close()
    }
  }
  if (group === 'run' && action === 'list') {
    return {
      command,
      data: { results: await nativeAgent.list(rootPath, 'run') },
      suggestedActions: [],
    }
  }
  if (group === 'run' && (!action || action === 'start')) {
    const requestValue = flag(parsed, 'request-id')
    const requestId = requestValue
      ? requiredUuid(requestValue, '--request-id 必须是 UUID。')
      : undefined
    const owned = dependencies.nativeAgent
      ? null
      : await createCliModelAuthentication(rootPath, core, flag(parsed, 'data-dir'))
    try {
      const result = await (dependencies.nativeAgent ?? owned!.nativeAgent).execute(
        {
          projectPath: rootPath,
          kind: 'run',
          message: required(flag(parsed, 'message') ?? rest[0], 'run 需要 --message。'),
          requestId,
          timeoutMs: integerFlag(parsed, 'timeout-ms', 120_000, 1_000, 900_000),
          idempotencyKey: flag(parsed, 'idempotency-key'),
        },
        { signal: dependencies.signal },
      )
      return { command: 'run', data: assertNativeSucceeded(result), suggestedActions: [] }
    } finally {
      owned?.close()
    }
  }

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
  if (group === 'component' && action === 'list') {
    const scope = flag(parsed, 'scope') ?? 'active'
    if (!['active', 'archived', 'all'].includes(scope)) {
      throw new StudioCoreError('USAGE_ERROR', '--scope 必须是 active、archived 或 all。')
    }
    const { project } = await core.inspectProject(rootPath)
    return {
      command,
      data: {
        projectId: project.id,
        scope,
        components: project.components.filter((component) =>
          scope === 'all'
            ? true
            : scope === 'archived'
              ? Boolean(component.archivedAt)
              : !component.archivedAt,
        ),
      },
      suggestedActions: [],
    }
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
  if (group === 'component' && action === 'restore') {
    const componentId = requiredUuid(rest[0], 'component restore 需要组件 UUID。')
    return {
      command,
      data: await core.restoreComponent(rootPath, componentId, mutation),
      suggestedActions: [
        {
          command: `studio stack add ${componentId} --project ${JSON.stringify(rootPath)} --json`,
          description: '恢复后可立即加入 Stack。',
        },
      ],
    }
  }
  if (group === 'component' && action === 'contract-test') {
    const componentId = requiredUuid(rest[0], 'component contract-test 需要组件 UUID。')
    return {
      command,
      data: await core.runComponentContractTest(rootPath, componentId, mutation),
      suggestedActions: [
        {
          command: `studio component runtime-validate ${componentId} --project ${JSON.stringify(rootPath)} --json`,
          description: '契约测试通过后，仅白名单 Adapter 可进入受信最小运行验证。',
        },
      ],
    }
  }
  if (group === 'component' && action === 'runtime-validate') {
    const componentId = requiredUuid(rest[0], 'component runtime-validate 需要组件 UUID。')
    const runtime =
      dependencies.compatibilityRuntime ??
      new ChildProcessCompatibilityRuntime(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          '../runtime/compatibility-validation.mjs',
        ),
      )
    return {
      command,
      data: await core.runTrustedComponentValidation(rootPath, componentId, runtime, {
        ...mutation,
        timeoutMs: integerFlag(parsed, 'timeout-ms', 5_000, 500, 60_000),
        signal: dependencies.signal,
      }),
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
    if (!parsed.flags.has('product-agent-freeze')) {
      return { command, data: await core.freezeVersion(rootPath, mutation), suggestedActions: [] }
    }
    const owned = dependencies.modelAuth
      ? null
      : await createCliModelAuthentication(rootPath, core, flag(parsed, 'data-dir'))
    try {
      const readiness = await (dependencies.modelAuth ?? owned!.controller).view()
      if (!readiness.readiness.ready) {
        const blocker = readiness.readiness.blockers[0]
        throw new StudioCoreError(
          blocker?.code === 'stack-incompatible'
            ? 'STACK_INVALID'
            : blocker?.code.startsWith('harness-')
              ? 'HARNESS_NOT_AVAILABLE'
              : 'HARNESS_AUTHENTICATION_REQUIRED',
          blocker?.message ?? 'Agent 尚未完成模型验证。',
          {
            details: { modelReadiness: readiness.readiness.state },
            suggestedActions: blocker ? [{ description: blocker.recoveryAction }] : [],
          },
        )
      }
      return { command, data: await core.freezeVersion(rootPath, mutation), suggestedActions: [] }
    } finally {
      owned?.close()
    }
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

export async function executeCliCommand(
  parsed: ParsedArguments,
  dependencies: CliDependencies = {},
): Promise<CliCommandResult> {
  const route = routeProductCommand(parsed)
  const result = await executeCliCommandInternal(route.parsed, dependencies)
  const notice = route.command ? undefined : legacyCommandNotice(parsed)
  const routedData = route.filterHarnesses ? filterHarnessList(result.data) : result.data
  return {
    ...result,
    ...(route.command ? { command: route.command } : {}),
    data: routedData,
    ...(notice ? { notices: [notice] } : {}),
  }
}

function filterHarnessList(data: unknown): unknown {
  if (!data || typeof data !== 'object' || !('components' in data)) return data
  const value = data as { components: unknown[] }
  return {
    ...data,
    components: value.components.filter((component) => {
      if (!component || typeof component !== 'object' || !('descriptor' in component)) return false
      const descriptor = (
        component as { descriptor?: { provides?: Array<{ capability?: string }> } }
      ).descriptor
      return descriptor?.provides?.some(({ capability }) => capability === 'execution-controller')
    }),
  }
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
    else {
      console.log(summarize(result.command, result.data))
      for (const notice of result.notices ?? []) console.error(`弃用提示：${notice.message}`)
    }
  } catch (error) {
    const known =
      error instanceof StudioCoreError
        ? error
        : new StudioCoreError('UNEXPECTED', '命令执行失败，未输出内部错误细节。')
    const message = redactSensitiveText(known.message)
    const suggestedActions = known.suggestedActions.map((action) => ({
      ...(action.command ? { command: redactSensitiveText(action.command) } : {}),
      description: redactSensitiveText(action.description),
    }))
    const payload = {
      ok: false,
      error: { code: known.code, message, details: sanitizeDiagnosticValue(known.details) },
      suggestedActions,
    }
    if (json) console.error(JSON.stringify(payload))
    else {
      console.error(`${known.code}: ${message}`)
      for (const action of suggestedActions) console.error(`建议：${action.description}`)
    }
    process.exitCode = exitCodes[known.code] ?? exitCodes.UNEXPECTED
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main()
