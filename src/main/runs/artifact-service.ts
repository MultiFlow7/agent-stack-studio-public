import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RunArtifact, RuntimeRunResult } from '../../shared/run'

export class ArtifactService {
  readonly #root: string

  constructor(root: string) {
    this.#root = root
  }

  async writeResult(
    runId: string,
    result: RuntimeRunResult,
  ): Promise<Omit<RunArtifact, 'id' | 'createdAt'>> {
    const relativePath = path.join(runId, 'result.json')
    const directory = path.join(this.#root, runId)
    const contents = `${JSON.stringify(result, null, 2)}\n`
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(this.#root, relativePath), contents, {
      encoding: 'utf8',
      flag: 'wx',
    })
    return {
      runId,
      kind: 'output',
      relativePath,
      contentHash: createHash('sha256').update(contents).digest('hex'),
      sizeBytes: Buffer.byteLength(contents),
    }
  }
}
