export type StudioCoreErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_ALREADY_EXISTS'
  | 'PROJECT_INVALID'
  | 'PROJECT_MIGRATION_FAILED'
  | 'PROJECT_INTEGRITY_FAILED'
  | 'PACKAGE_UNSAFE'
  | 'PACKAGE_DESTINATION_INVALID'
  | 'REVISION_CONFLICT'
  | 'COMPONENT_NOT_FOUND'
  | 'COMPONENT_IN_USE'
  | 'COMPONENT_INVALID'
  | 'STACK_INVALID'
  | 'VERSION_NOT_FOUND'
  | 'WORKFLOW_NOT_FOUND'
  | 'WORKFLOW_VERSION_NOT_FOUND'
  | 'WORKFLOW_INVALID'
  | 'WORKFLOW_CYCLE'
  | 'UNSAFE_SOURCE'
  | 'IO_FAILED'
  | 'DISCOVERY_QUERY_INVALID'
  | 'DISCOVERY_NETWORK_FAILED'
  | 'DISCOVERY_TIMEOUT'
  | 'DISCOVERY_RATE_LIMITED'
  | 'DISCOVERY_PROVIDER_FAILED'
  | 'DISCOVERY_PROVIDER_UNAVAILABLE'
  | 'SOURCE_NOT_FOUND'
  | 'OPERATION_CANCELLED'
  | 'KEYCHAIN_FAILED'
  | 'KEYCHAIN_UNAVAILABLE'
  | 'USAGE_ERROR'
  | 'UNEXPECTED'

export interface SuggestedAction {
  command?: string
  description: string
}

export class StudioCoreError extends Error {
  readonly code: StudioCoreErrorCode
  readonly details: Record<string, unknown>
  readonly suggestedActions: SuggestedAction[]

  constructor(
    code: StudioCoreErrorCode,
    message: string,
    options: {
      cause?: unknown
      details?: Record<string, unknown>
      suggestedActions?: SuggestedAction[]
    } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'StudioCoreError'
    this.code = code
    this.details = options.details ?? {}
    this.suggestedActions = options.suggestedActions ?? []
  }
}
