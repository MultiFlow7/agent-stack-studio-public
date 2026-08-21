import { randomUUID } from 'node:crypto'
import type { ImportScan } from '../../shared/import'
import { AppError } from '../../shared/errors'
import { scanProject } from './static-project-scanner'

export class ImportService {
  readonly #sessions = new Map<string, ImportScan>()

  async scan(sourcePath: string): Promise<ImportScan> {
    const scan = await scanProject(sourcePath, randomUUID())
    this.#sessions.set(scan.scanId, scan)
    return scan
  }

  consume(scanId: string): ImportScan {
    const scan = this.#sessions.get(scanId)
    if (!scan) throw new AppError('NOT_FOUND', '导入扫描已失效，请重新选择文件夹。')
    this.#sessions.delete(scanId)
    return scan
  }
}
