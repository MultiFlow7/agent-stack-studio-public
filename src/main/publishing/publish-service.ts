import type { AgentService } from '../agents/agent-service'
import type { ComponentService } from '../components/component-service'
import type { AgentPublisher } from '../connectors/agent-publisher'
import { buildPublishPackage, publishIdempotencyKey } from '../domain/publish-package'
import type { PublishRepository } from '../persistence/publish-repository'
import type { RunService } from '../runs/run-service'
import { AppError } from '../../shared/errors'
import {
  localContractTestTargetId,
  publishHistorySchema,
  publishPreviewSchema,
  publishResultSchema,
  publishTargetsSchema,
  publishValidationSchema,
  unconfiguredMulticaTargetId,
  type PublishExecuteInput,
  type PublishHistory,
  type PublishPreview,
  type PublishPreviewInput,
  type PublishResult,
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
    id: unconfiguredMulticaTargetId,
    connector: 'multica',
    transport: 'unconfigured',
    label: 'Multica',
    description: '等待确认官方认证、CLI 或公开 API 后接入。',
    availability: 'decision-required',
    externalSideEffect: true,
  },
])

export class PublishService {
  readonly #agents: AgentService
  readonly #components: ComponentService
  readonly #runs: Pick<RunService, 'list'>
  readonly #repository: PublishRepository
  readonly #publisher: AgentPublisher

  constructor(options: {
    agents: AgentService
    components: ComponentService
    runs: Pick<RunService, 'list'>
    repository: PublishRepository
    publisher: AgentPublisher
  }) {
    this.#agents = options.agents
    this.#components = options.components
    this.#runs = options.runs
    this.#repository = options.repository
    this.#publisher = options.publisher
  }

  targets(): PublishTarget[] {
    return targets
  }

  async preview(input: PublishPreviewInput): Promise<PublishPreview> {
    const target = this.#target(input.targetId)
    const detail = this.#agents.getActive(input.agentId)
    const version = detail.versions.find(({ id }) => id === input.agentVersionId)
    if (!version) throw new AppError('NOT_FOUND', '指定的 Agent Version 不存在。')
    const publishPackage = buildPublishPackage({ version, components: this.#components.list() })
    const connectorValidation = await this.#publisher.validate(target, publishPackage)
    const issues = [...connectorValidation.issues]
    const stack = this.#components.getStack(input.agentId)
    if (
      stack.compilation.status !== 'ready' ||
      version.snapshot.stack.revision !== stack.revision
    ) {
      issues.push({
        field: 'agentVersion.stack',
        severity: 'blocking',
        code: 'STACK_DRIFT',
        message: '当前 Stack 与所选版本不一致，请先创建新的不可变版本。',
      })
    }
    const verified = this.#runs
      .list(input.agentId)
      .some((run) => run.agentVersionId === version.id && run.status === 'succeeded')
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
    const pending = this.#repository.createPending({
      targetId: preview.target.id,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      publishPackage: preview.package,
      idempotencyKey,
    })
    try {
      const mapping = this.#repository.getMapping(preview.target.id, input.agentId)
      const outcome = await this.#publisher.publish(preview.target, preview.package, {
        idempotencyKey,
        remoteAgentId: mapping?.remoteAgentId ?? null,
      })
      return publishResultSchema.parse({
        receipt: this.#repository.completeSuccess(pending.id, outcome),
        reused: false,
      })
    } catch (error) {
      return publishResultSchema.parse({
        receipt: this.#repository.completeFailure(pending.id, {
          code: 'CONNECTOR_FAILED',
          message: error instanceof Error ? error.message : '发布目标返回未知错误。',
          retryable: true,
        }),
        reused: false,
      })
    }
  }

  history(targetId: string, agentId: string): PublishHistory {
    this.#target(targetId)
    return publishHistorySchema.parse(this.#repository.history(targetId, agentId))
  }

  #target(targetId: string): PublishTarget {
    const target = targets.find(({ id }) => id === targetId)
    if (!target) throw new AppError('NOT_FOUND', '指定的发布目标不存在。')
    return target
  }
}
