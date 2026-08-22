import { randomUUID } from 'node:crypto'
import type { ImportScan } from '../../shared/import'
import { AppError } from '../../shared/errors'
import { scanProject } from './static-project-scanner'

export class ImportService {
  readonly #sessions = new Map<string, { scan: ImportScan; expiresAt: number }>()
  readonly #now: () => number
  readonly #ttlMs: number

  constructor(options: { now?: () => number; ttlMs?: number } = {}) {
    this.#now = options.now ?? Date.now
    this.#ttlMs = options.ttlMs ?? 15 * 60_000
  }

  async scan(sourcePath: string): Promise<ImportScan> {
    this.#prune()
    const scan = await scanProject(sourcePath, randomUUID())
    while (this.#sessions.size >= 20) {
      const oldest = this.#sessions.keys().next().value
      if (!oldest) break
      this.#sessions.delete(oldest)
    }
    this.#sessions.set(scan.scanId, { scan, expiresAt: this.#now() + this.#ttlMs })
    return scan
  }

  consume(scanId: string): ImportScan {
    this.#prune()
    const session = this.#sessions.get(scanId)
    if (!session) throw new AppError('NOT_FOUND', '导入扫描已失效，请重新选择文件夹。')
    this.#sessions.delete(scanId)
    return session.scan
  }

  #prune(): void {
    const now = this.#now()
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(id)
    }
  }
}
