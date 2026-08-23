import type { AgentService } from '../agents/agent-service'
import type { ComponentService } from '../components/component-service'
import type { AgentPublisher } from '../connectors/agent-publisher'
import { PublisherError } from '../connectors/agent-publisher'
import { buildPublishPackage, publishIdempotencyKey } from '../domain/publish-package'
import type { PublishRepository } from '../persistence/publish-repository'
import type { RunService } from '../runs/run-service'
import { AppError } from '../../shared/errors'
import {
  localContractTestTargetId,
  multicaCliTargetId,
  publishHistorySchema,
  publishPreviewSchema,
  publishResultSchema,
  publishRemoteStatusSchema,
  publishTargetsSchema,
  publishValidationSchema,
  unconfiguredMulticaTargetId,
  type PublishExecuteInput,
  type PublishHistory,
  type PublishPreview,
  type PublishPreviewInput,
  type PublishResult,
  type PublishRemoteStatus,
  type PublishStatusInput,
  type MulticaRuntime,
  type PublishTarget,
} from '../../shared/publish'

const targets = publishTargetsSchema.parse([
  {
    id: localContractTestTargetId,
    connector: 'multica',
    transport: 'contract-test',
    label: '本地 Contract Test Target',
    description: '验证 Multica Connector 发布包、幂等与 Receipt，不发起网络请求。',
    availability: 'ready',
    externalSideEffect: false,
  },
  {
    id: multicaCliTargetId,
    connector: 'multica',
    transport: 'cli',
    label: 'Multica',
    description: '通过官方 Multica CLI 发布到当前工作空间。',
    availability: 'ready',
    externalSideEffect: true,
  },
  {
    id: unconfiguredMulticaTargetId,
    connector: 'multica',
    transport: 'unconfigured',
    label: 'Multica（历史未配置目标）',
    description: '只为读取历史 Receipt 保留，不接受新发布。',
    availability: 'decision-required',
    externalSideEffect: true,
  },
])

// The official CLI can spend several seconds starting its authenticated transport before the
// first JSON response. These bounds cover the complete multi-command validate/publish operation,
// while each subprocess remains independently bounded by the connector.
const VALIDATION_TIMEOUT_MS = 45_000
const PUBLISH_TIMEOUT_MS = 120_000

class PublisherTimeoutError extends Error {
  constructor() {
    super('发布目标在时限内未响应。')
    this.name = 'PublisherTimeoutError'
  }
}

async function withPublisherTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new PublisherTimeoutError())
    }, timeoutMs)
  })
  try {
    return await Promise.race([operation(controller.signal), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class PublishService {
  readonly #agents: AgentService
  readonly #components: ComponentService
  readonly #runs: Pick<RunService, 'list'>
  readonly #repository: PublishRepository
  readonly #publisher: AgentPublisher
  readonly #previewInFlight = new Map<string, Promise<PublishPreview>>()
  readonly #inFlight = new Map<string, Promise<PublishResult>>()
  readonly #nativeVerification?: (agentId: string, agentVersionId: string) => Promise<boolean>
  readonly #visibleTargets: PublishTarget[]

  constructor(options: {
    agents: AgentService
    components: ComponentService
    runs: Pick<RunService, 'list'>
    repository: PublishRepository
    publisher: AgentPublisher
    nativeVerification?: (agentId: string, agentVersionId: string) => Promise<boolean>
    includeLegacyTargets?: boolean
  }) {
    this.#agents = options.agents
    this.#components = options.components
    this.#runs = options.runs
    this.#repository = options.repository
    this.#publisher = options.publisher
    this.#nativeVerification = options.nativeVerification
    this.#visibleTargets = options.includeLegacyTargets
      ? targets
      : targets.filter(({ id }) => id === multicaCliTargetId)
  }

  targets(): PublishTarget[] {
    return this.#visibleTargets
  }

  runtimes(): Promise<MulticaRuntime[]> {
    if (!this.#publisher.runtimes) return Promise.resolve([])
    return withPublisherTimeout(VALIDATION_TIMEOUT_MS, (signal) =>
      this.#publisher.runtimes!(signal),
    )
  }

  preview(input: PublishPreviewInput): Promise<PublishPreview> {
    const key = JSON.stringify(input)
    const existing = this.#previewInFlight.get(key)
    if (existing) return existing
    const task = this.#preview(input).finally(() => {
      if (this.#previewInFlight.get(key) === task) this.#previewInFlight.delete(key)
    })
    this.#previewInFlight.set(key, task)
    return task
  }

  async #preview(input: PublishPreviewInput): Promise<PublishPreview> {
    const target = this.#target(input.targetId)
    const detail = this.#agents.getActive(input.agentId)
    const version = detail.versions.find(({ id }) => id === input.agentVersionId)
    if (!version) throw new AppError('NOT_FOUND', '指定的 Agent Version 不存在。')
    const publishPackage = buildPublishPackage({
      version: this.#agents.materializeVersion(input.agentId, version),
      components: this.#components.list(),
    })
    const mapping = this.#repository.getMapping(target.id, input.agentId)
    const connectorValidation = await withPublisherTimeout(VALIDATION_TIMEOUT_MS, (signal) =>
      this.#publisher.validate(target, publishPackage, {
        remoteAgentId: mapping?.remoteAgentId ?? null,
        runtimeId: input.runtimeId ?? null,
        signal,
      }),
    )
    const issues = [...connectorValidation.issues]
    const stack = this.#components.getStack(input.agentId)
    if (
      stack.compilation.status !== 'ready' ||
      this.#agents.materializeVersion(input.agentId, version).snapshot.stack.revision !==
        stack.revision
    ) {
      issues.push({
        field: 'agentVersion.stack',
        severity: 'blocking',
        code: 'STACK_DRIFT',
        message: '当前 Stack 与所选版本不一致，请先创建新的不可变版本。',
      })
    }
    const legacyVerified = this.#runs
      .list(input.agentId)
      .some((run) => run.agentVersionId === version.id && run.status === 'succeeded')
    const verified =
      legacyVerified ||
      (this.#nativeVerification
        ? await this.#nativeVerification(input.agentId, input.agentVersionId)
        : false)
    if (!verified) {
      issues.push({
        field: 'agentVersion.verification',
        severity: 'blocking',
        code: 'VERSION_NOT_VERIFIED',
        message: '所选版本还没有成功的本地 Run，不能进入发布。',
      })
    }
    const validation = publishValidationSchema.parse({
      status: issues.some(({ severity }) => severity === 'blocking') ? 'blocked' : 'ready',
      issues,
      checkedAt: new Date().toISOString(),
    })
    return publishPreviewSchema.parse({
      target,
      package: publishPackage,
      validation,
      priorReceipt: this.#repository.findSucceeded(
        target.id,
        version.id,
        publishPackage.contentHash,
      ),
    })
  }

  async publish(input: PublishExecuteInput): Promise<PublishResult> {
    const preview = await this.preview(input)
    if (preview.validation.status !== 'ready') {
      throw new AppError('VALIDATION_FAILED', '发布预检未通过，未向目标发送任何内容。')
    }
    if (preview.priorReceipt) {
      return publishResultSchema.parse({ receipt: preview.priorReceipt, reused: true })
    }
    const idempotencyKey = publishIdempotencyKey(preview.target.id, preview.package)
    const existing = this.#inFlight.get(idempotencyKey)
    if (existing) return existing
    const task = this.#publishOnce(input, preview, idempotencyKey).finally(() => {
      if (this.#inFlight.get(idempotencyKey) === task) this.#inFlight.delete(idempotencyKey)
    })
    this.#inFlight.set(idempotencyKey, task)
    return task
  }

  async #publishOnce(
    input: PublishExecuteInput,
    preview: PublishPreview,
    idempotencyKey: string,
  ): Promise<PublishResult> {
    const pending = this.#repository.createPending({
      targetId: preview.target.id,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      publishPackage: preview.package,
      idempotencyKey,
    })
    try {
      const mapping = this.#repository.getMapping(preview.target.id, input.agentId)
      const outcome = await withPublisherTimeout(PUBLISH_TIMEOUT_MS, (signal) =>
        this.#publisher.publish(preview.target, preview.package, {
          idempotencyKey,
          remoteAgentId: mapping?.remoteAgentId ?? null,
          runtimeId: input.runtimeId ?? null,
          signal,
        }),
      )
      return publishResultSchema.parse({
        receipt: this.#repository.completeSuccess(pending.id, outcome),
        reused: false,
      })
    } catch (error) {
      return publishResultSchema.parse({
        receipt: this.#repository.completeFailure(pending.id, {
          code:
            error instanceof PublisherTimeoutError
              ? 'CONNECTOR_TIMEOUT'
              : error instanceof PublisherError
                ? error.code
                : 'CONNECTOR_FAILED',
          message:
            error instanceof PublisherTimeoutError
              ? '发布目标响应超时；重试会复用同一幂等键。'
              : error instanceof PublisherError
                ? error.message
                : '发布目标请求失败，未保存远端错误细节。',
          retryable: error instanceof PublisherError ? error.retryable : true,
        }),
        reused: false,
      })
    }
  }

  history(targetId: string, agentId: string): PublishHistory {
    this.#target(targetId)
    return publishHistorySchema.parse(this.#repository.history(targetId, agentId))
  }

  async status(input: PublishStatusInput): Promise<PublishRemoteStatus> {
    const preview = await this.preview(input)
    const mapping = this.#repository.getMapping(preview.target.id, input.agentId)
    if (!mapping) {
      return publishRemoteStatusSchema.parse({
        state: 'not-published',
        remoteAgentId: null,
        localContentHash: preview.package.contentHash,
        remoteContentHash: null,
        displayName: null,
        checkedAt: new Date().toISOString(),
        message: '该本地 Agent 尚未建立 Multica 身份映射。',
      })
    }
    try {
      const remote = await withPublisherTimeout(VALIDATION_TIMEOUT_MS, (signal) =>
        this.#publisher.inspect(preview.target, mapping.remoteAgentId, signal),
      )
      const remoteHash =
        remote?.latestRemoteVersionId && /^[a-f0-9]{64}$/.test(remote.latestRemoteVersionId)
          ? remote.latestRemoteVersionId
          : null
      return publishRemoteStatusSchema.parse({
        state:
          remoteHash === preview.package.contentHash
            ? 'in-sync'
            : remote
              ? 'drifted'
              : 'unreachable',
        remoteAgentId: mapping.remoteAgentId,
        localContentHash: preview.package.contentHash,
        remoteContentHash: remoteHash,
        displayName: remote?.displayName ?? null,
        checkedAt: new Date().toISOString(),
        message:
          remoteHash === preview.package.contentHash
            ? 'Multica Agent 与所选冻结版本内容哈希一致。'
            : remote
              ? 'Multica Agent 已被修改或不含可验证的 Studio 内容标记。'
              : 'Multica Agent 不存在或当前账户无权读取。',
      })
    } catch (error) {
      return publishRemoteStatusSchema.parse({
        state: 'unreachable',
        remoteAgentId: mapping.remoteAgentId,
        localContentHash: preview.package.contentHash,
        remoteContentHash: null,
        displayName: null,
        checkedAt: new Date().toISOString(),
        message:
          error instanceof PublisherError
            ? error.message
            : '无法从 Multica 获取真实远端状态；错误细节已脱敏。',
      })
    }
  }

  #target(targetId: string): PublishTarget {
    const target = targets.find(({ id }) => id === targetId)
    if (!target) throw new AppError('NOT_FOUND', '指定的发布目标不存在。')
    return target
  }
}
