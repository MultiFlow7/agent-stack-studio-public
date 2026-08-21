import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export class AppLogger {
  readonly #logDirectory: string

  constructor(logDirectory: string) {
    this.#logDirectory = logDirectory
  }

  async write(level: 'info' | 'error', event: string, details: Record<string, unknown> = {}) {
    await mkdir(this.#logDirectory, { recursive: true })
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...details,
    })
    await appendFile(path.join(this.#logDirectory, 'studio.log'), `${entry}\n`, 'utf8')
  }
}
