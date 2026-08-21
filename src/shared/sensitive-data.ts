const REDACTED = '[REDACTED]'
const MAX_DIAGNOSTIC_STRING_LENGTH = 8_000
const MAX_COLLECTION_ITEMS = 100

const sensitiveKeyPattern =
  /(?:^|[-_])(authorization|cookie|credential|password|passwd|private[-_]?key|secret|token|api[-_]?key)(?:$|[-_])/i
const tokenPatterns = [
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
]

function redactUrl(candidate: string): string {
  try {
    const url = new URL(candidate)
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol)) return candidate
    if (url.username || url.password) {
      url.username = REDACTED
      url.password = ''
    }
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveKeyPattern.test(key)) url.searchParams.set(key, REDACTED)
    }
    return url.toString()
  } catch {
    return candidate
  }
}

export function redactSensitiveText(value: string): string {
  let redacted = value
    .slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, `$1 ${REDACTED}`)
    .replace(
      /\b(password|passwd|secret|token|api[-_]?key|authorization)\s*[:=]\s*([^\s,;]+)/gi,
      `$1=${REDACTED}`,
    )
  for (const pattern of tokenPatterns) redacted = redacted.replace(pattern, REDACTED)
  return redacted.replace(/(?:https?|ssh|git):\/\/[^\s"'<>]+/gi, redactUrl)
}

export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]'
  if (typeof value === 'string') return redactSensitiveText(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean' || value === null) return value
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_COLLECTION_ITEMS)
      .map((item) => sanitizeDiagnosticValue(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value).slice(0, MAX_COLLECTION_ITEMS)) {
      result[key] = sensitiveKeyPattern.test(key)
        ? REDACTED
        : sanitizeDiagnosticValue(child, depth + 1)
    }
    return result
  }
  if (typeof value === 'symbol') return value.description ?? 'symbol'
  if (typeof value === 'undefined') return 'undefined'
  return '[unsupported]'
}

export function sanitizedErrorMessage(error: unknown, fallback: string): string {
  return redactSensitiveText(error instanceof Error ? error.message : fallback) || fallback
}
