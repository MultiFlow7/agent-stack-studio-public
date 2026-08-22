import { appendFile, chmod, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { sanitizeDiagnosticValue } from '../../shared/sensitive-data'

export class AppLogger {
  readonly #logDirectory: string
  #pending: Promise<void> = Promise.resolve()

  constructor(logDirectory: string) {
    this.#logDirectory = logDirectory
  }

  write(level: 'info' | 'error', event: string, details: Record<string, unknown> = {}) {
    const write = this.#pending
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.#logDirectory, { recursive: true, mode: 0o700 })
        await chmod(this.#logDirectory, 0o700)
        const entry = JSON.stringify({
          timestamp: new Date().toISOString(),
          level,
          event,
          details: sanitizeDiagnosticValue(details),
        })
        const logPath = path.join(this.#logDirectory, 'studio.log')
        await appendFile(logPath, `${entry}\n`, { encoding: 'utf8', mode: 0o600 })
        await chmod(logPath, 0o600)
      })
    this.#pending = write
    return write
  }
}
