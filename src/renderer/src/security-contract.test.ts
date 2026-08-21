import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Renderer security contract', () => {
  it('ships a restrictive, offline content security policy', () => {
    const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
    const html = readFileSync(path.join(currentDirectory, '..', 'index.html'), 'utf8')
    const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1]

    expect(policy).toBeDefined()
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "connect-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
    ]) {
      expect(policy).toContain(directive)
    }
    expect(policy).not.toMatch(/unsafe-(?:inline|eval)|https?:/)
  })
})
