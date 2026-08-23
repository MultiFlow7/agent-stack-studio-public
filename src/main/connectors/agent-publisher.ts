import type {
  MulticaRuntime,
  PublishPackage,
  PublishTarget,
  PublishValidation,
} from '../../shared/publish'
import type { DoctorMulticaFact } from '../../shared/doctor'

export interface PublisherContext {
  idempotencyKey: string
  remoteAgentId: string | null
  runtimeId: string | null
  signal: AbortSignal
}

export interface PublisherValidationContext {
  remoteAgentId: string | null
  runtimeId: string | null
  signal?: AbortSignal
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

export class PublisherError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable: boolean) {
    super(message)
    this.name = 'PublisherError'
    this.code = code
    this.retryable = retryable
  }
}

export interface AgentPublisher {
  readiness?(signal?: AbortSignal): Promise<DoctorMulticaFact>
  runtimes?(signal?: AbortSignal): Promise<MulticaRuntime[]>
  validate(
    target: PublishTarget,
    publishPackage: PublishPackage,
    context?: PublisherValidationContext,
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
