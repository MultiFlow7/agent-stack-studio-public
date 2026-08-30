import { chmod, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export class WorkspaceService {
  readonly #root: string

  constructor(root: string) {
    this.#root = root
  }

  async create(agentId: string): Promise<string> {
    const workspacePath = path.join(this.#root, agentId)
    await mkdir(workspacePath, { recursive: true, mode: 0o700 })
    await chmod(workspacePath, 0o700)
    await writeFile(
      path.join(workspacePath, 'workspace.json'),
      `${JSON.stringify({ agentId, formatVersion: 1 }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    return workspacePath
  }

  async remove(agentId: string): Promise<void> {
    await rm(path.join(this.#root, agentId), { recursive: true, force: true })
  }
}
