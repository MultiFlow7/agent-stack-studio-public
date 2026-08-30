import { access, constants } from 'node:fs/promises'
import type { NativeAgentCore } from '../../core/native-agent-core'
import { buildStudioDoctorReport } from '../../core/studio-doctor'
import type { DoctorMulticaFact, StudioDoctorFacts, StudioDoctorReport } from '../../shared/doctor'
import type { AgentPublisher } from '../connectors/agent-publisher'
import { PublisherError } from '../connectors/agent-publisher'
import type { DataMaintenanceService } from '../maintenance/data-maintenance-service'
import type { StudioProjectService } from '../projects/studio-project-service'

export async function probeMulticaReadiness(
  publisher: Pick<AgentPublisher, 'readiness' | 'runtimes'>,
  signal?: AbortSignal,
): Promise<DoctorMulticaFact> {
  if (!publisher.runtimes) {
    return {
      status: 'unavailable',
      runtimeCount: 0,
      onlineRuntimeCount: 0,
      message: 'Multica Publisher 未提供 Runtime 查询能力。',
    }
  }
  try {
    if (publisher.readiness) return await publisher.readiness(signal)
    const runtimes = await publisher.runtimes(signal)
    const onlineRuntimeCount = runtimes.filter(({ status }) => status === 'online').length
    return {
      status: onlineRuntimeCount > 0 ? 'ready' : 'unavailable',
      runtimeCount: runtimes.length,
      onlineRuntimeCount,
      message:
        onlineRuntimeCount > 0
          ? `Multica 已认证，${onlineRuntimeCount} 个 Runtime 在线。`
          : `Multica 已认证，但 ${runtimes.length} 个 Runtime 中没有在线项。`,
    }
  } catch (error) {
    const code = error instanceof PublisherError ? error.code : 'MULTICA_CLI_FAILED'
    if (code === 'MULTICA_CLI_NOT_INSTALLED') {
      return {
        status: 'not-installed',
        runtimeCount: 0,
        onlineRuntimeCount: 0,
        message: '未找到 Multica CLI。',
      }
    }
    if (code === 'MULTICA_AUTHENTICATION_REQUIRED') {
      return {
        status: 'authentication-required',
        runtimeCount: 0,
        onlineRuntimeCount: 0,
        message: 'Multica CLI 尚未登录或凭证已失效。',
      }
    }
    return {
      status: 'unavailable',
      runtimeCount: 0,
      onlineRuntimeCount: 0,
      message: 'Multica 就绪检查失败；未伪造发布成功。',
    }
  }
}

export class StudioDoctorService {
  readonly #application: StudioDoctorFacts['application']
  readonly #cliPath: string
  readonly #maintenance: DataMaintenanceService
  readonly #projects: StudioProjectService
  readonly #nativeAgent: NativeAgentCore
  readonly #publisher: Pick<AgentPublisher, 'readiness' | 'runtimes'>
  readonly #now: () => Date

  constructor(options: {
    application: Omit<StudioDoctorFacts['application'], 'cliExecutable'>
    cliPath: string
    maintenance: DataMaintenanceService
    projects: StudioProjectService
    nativeAgent: NativeAgentCore
    publisher: Pick<AgentPublisher, 'readiness' | 'runtimes'>
    now?: () => Date
  }) {
    this.#application = { ...options.application, cliExecutable: false }
    this.#cliPath = options.cliPath
    this.#maintenance = options.maintenance
    this.#projects = options.projects
    this.#nativeAgent = options.nativeAgent
    this.#publisher = options.publisher
    this.#now = options.now ?? (() => new Date())
  }

  async #projectFact(): Promise<StudioDoctorFacts['project']> {
    try {
      const state = await this.#projects.current()
      return state.project
        ? {
            status: 'healthy',
            name: state.project.name,
            revision: state.project.revision,
            formatVersion: state.project.formatVersion,
            versionsChecked: state.integrity?.versionsChecked ?? 0,
            message: '项目事实、内容哈希和不可变版本已验证。',
          }
        : {
            status: 'missing',
            name: null,
            revision: null,
            formatVersion: null,
            versionsChecked: 0,
            message: '当前未打开 .agent-stack 项目。',
          }
    } catch {
      return {
        status: 'failed',
        name: null,
        revision: null,
        formatVersion: null,
        versionsChecked: 0,
        message: '当前 .agent-stack 项目未通过完整性检查。',
      }
    }
  }

  async run(signal?: AbortSignal): Promise<StudioDoctorReport> {
    const [data, project, harnesses, multica, cliExecutable] = await Promise.all([
      this.#maintenance.status(),
      this.#projectFact(),
      this.#nativeAgent.probes(),
      probeMulticaReadiness(this.#publisher, signal),
      access(this.#cliPath, constants.X_OK).then(
        () => true,
        () => false,
      ),
    ])
    return buildStudioDoctorReport(
      {
        application: { ...this.#application, cliExecutable },
        data: {
          databaseSchemaVersion: data.databaseSchemaVersion,
          supportedDatabaseSchemaVersion: data.supportedDatabaseSchemaVersion,
          pendingRestore: data.pendingRestore,
          lastRestoreAt: data.lastRestoreAt,
        },
        project,
        harnesses,
        multica,
      },
      this.#now,
    )
  }
}
