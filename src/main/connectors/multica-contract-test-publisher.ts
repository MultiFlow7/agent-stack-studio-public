import { createHash } from 'node:crypto'
import {
  localContractTestTargetId,
  publishValidationSchema,
  type PublishPackage,
  type PublishTarget,
  type PublishValidation,
} from '../../shared/publish'
import type {
  AgentPublisher,
  PublisherContext,
  PublisherOutcome,
  RemoteAgentSummary,
} from './agent-publisher'

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function containsSensitiveShape(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  for (const [key, child] of Object.entries(value)) {
    if (/(secret|token|password|keychain|absolutePath|workspacePath)/i.test(key)) return true
    if (containsSensitiveShape(child)) return true
  }
  return false
}

export class MulticaContractTestPublisher implements AgentPublisher {
  readonly #remote = new Map<string, RemoteAgentSummary>()

  validate(
    target: PublishTarget,
    publishPackage: PublishPackage,
    signal?: AbortSignal,
  ): Promise<PublishValidation> {
    if (signal?.aborted)
      return Promise.reject(new DOMException('Publishing aborted.', 'AbortError'))
    const issues: PublishValidation['issues'] = []
    if (target.id !== localContractTestTargetId || target.transport !== 'contract-test') {
      issues.push({
        field: 'target',
        severity: 'blocking',
        code: 'TARGET_UNAVAILABLE',
        message: '真实 Multica Transport 尚未配置，需要先确认官方认证与接口。',
      })
    }
    if (publishPackage.stack.components.length === 0) {
      issues.push({
        field: 'stack.components',
        severity: 'blocking',
        code: 'EMPTY_STACK',
        message: '发布包不能包含空 Stack。',
      })
    }
    if (containsSensitiveShape(publishPackage)) {
      issues.push({
        field: 'package',
        severity: 'blocking',
        code: 'SENSITIVE_CONTENT',
        message: '发布包出现密钥或本地路径字段。',
      })
    }
    issues.push({
      field: 'target',
      severity: 'warning',
      code: 'LOCAL_TEST_ONLY',
      message: '当前目标仅验证 Connector Contract，不发起网络请求。',
    })
    return Promise.resolve(
      publishValidationSchema.parse({
        status: issues.some(({ severity }) => severity === 'blocking') ? 'blocked' : 'ready',
        issues,
        checkedAt: new Date().toISOString(),
      }),
    )
  }

  async publish(
    target: PublishTarget,
    publishPackage: PublishPackage,
    context: PublisherContext,
  ): Promise<PublisherOutcome> {
    if (context.signal.aborted) throw new DOMException('Publishing aborted.', 'AbortError')
    const validation = await this.validate(target, publishPackage, context.signal)
    if (validation.status === 'blocked') throw new Error('发布预检未通过。')
    const remoteAgentId =
      context.remoteAgentId ?? `test-agent-${shortHash(publishPackage.source.localAgentId)}`
    const remoteVersionId = `test-version-${shortHash(context.idempotencyKey)}`
    this.#remote.set(remoteAgentId, {
      remoteAgentId,
      latestRemoteVersionId: remoteVersionId,
      displayName: publishPackage.agent.name,
    })
    return {
      remoteAgentId,
      remoteVersionId,
      message: '本地 Connector Contract 已完整接收发布包。',
      publishedFields: ['agent', 'source', 'stack', 'environmentDeclarations', 'requirements'],
      testOnly: true,
    }
  }

  inspect(
    _target: PublishTarget,
    remoteAgentId: string,
    signal?: AbortSignal,
  ): Promise<RemoteAgentSummary | null> {
    if (signal?.aborted)
      return Promise.reject(new DOMException('Publishing aborted.', 'AbortError'))
    return Promise.resolve(this.#remote.get(remoteAgentId) ?? null)
  }
}
