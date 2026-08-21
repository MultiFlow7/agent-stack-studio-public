import { describe, expect, it } from 'vitest'
import { AppError, toPublicError } from './errors'
import {
  redactSensitiveText,
  sanitizeDiagnosticValue,
  sanitizedErrorMessage,
} from './sensitive-data'

describe('sensitive diagnostic redaction', () => {
  it('redacts credentialed URLs, authorization values and provider tokens', () => {
    const githubToken = ['ghp', '12345678901234567890'].join('_')
    const text = redactSensitiveText(
      `Bearer top-secret https://user:pass@example.test/repo?token=query-secret ${githubToken}`,
    )
    expect(text).not.toContain('top-secret')
    expect(text).not.toContain('user:pass')
    expect(text).not.toContain('query-secret')
    expect(text).not.toContain(githubToken)
    expect(text).toContain('[REDACTED]')
  })

  it('redacts sensitive object fields and safely serializes unusual values', () => {
    expect(
      sanitizeDiagnosticValue({ token: 'raw', nested: { count: 1n, value: Number.NaN } }),
    ).toEqual({ token: '[REDACTED]', nested: { count: '1', value: null } })
  })

  it('sanitizes unexpected error messages before persistence', () => {
    expect(sanitizedErrorMessage(new Error('password=hunter2'), 'fallback')).toBe(
      'password=[REDACTED]',
    )
  })

  it('redacts known application errors before they cross IPC', () => {
    expect(toPublicError(new AppError('VALIDATION_FAILED', 'token=raw-secret')).message).toBe(
      'token=[REDACTED]',
    )
  })
})
