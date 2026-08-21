import type { PublishPackage, PublishTarget, PublishValidation } from '../../shared/publish'

export interface PublisherContext {
  idempotencyKey: string
  remoteAgentId: string | null
  signal: AbortSignal
}

export interface PublisherOutcome {
  remoteAgentId: string
  remoteVersionId: string
  message: string
  publishedFields: string[]
  testOnly: boolean
}

export interface RemoteAgentSummary {
  remoteAgentId: string
  latestRemoteVersionId: string
  displayName: string
}

export interface AgentPublisher {
  validate(
    target: PublishTarget,
    publishPackage: PublishPackage,
    signal?: AbortSignal,
  ): Promise<PublishValidation>
  publish(
    target: PublishTarget,
    publishPackage: PublishPackage,
    context: PublisherContext,
  ): Promise<PublisherOutcome>
  inspect(
    target: PublishTarget,
    remoteAgentId: string,
    signal?: AbortSignal,
  ): Promise<RemoteAgentSummary | null>
}
