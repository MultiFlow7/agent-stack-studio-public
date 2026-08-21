export type AppErrorCode =
  | 'VALIDATION_FAILED'
  | 'PERSISTENCE_FAILED'
  | 'RUNTIME_FAILED'
  | 'NOT_FOUND'
  | 'UNEXPECTED'

export class AppError extends Error {
  readonly code: AppErrorCode

  constructor(code: AppErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AppError'
    this.code = code
  }
}

export function toPublicError(error: unknown): Error {
  if (error instanceof AppError) return new Error(redactSensitiveText(error.message))
  return new Error('Agent Stack Studio 无法完成此操作，请重试。')
}
import { redactSensitiveText } from './sensitive-data'
