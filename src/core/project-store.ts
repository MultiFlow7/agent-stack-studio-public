import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  PROJECT_FILE_NAME,
  PROJECT_FORMAT_VERSION,
  LEGACY_PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_ID,
  studioProjectV1Schema,
  studioProjectSchema,
  type StudioProject,
} from './project-model'
import { StudioCoreError } from './project-errors'
import { verifyProjectIntegrity, type ProjectIntegrityReport } from './project-integrity'

export interface ProjectReadResult {
  path: string
  project: StudioProject
  migrated: boolean
  recovered: boolean
  integrity: ProjectIntegrityReport
}

function projectPath(inputPath: string): string {
  return path.basename(inputPath) === PROJECT_FILE_NAME
    ? path.resolve(inputPath)
    : path.join(path.resolve(inputPath), PROJECT_FILE_NAME)
}

function backupPath(filePath: string): string {
  return `${filePath}.backup`
}

const DEAD_LOCK_GRACE_MS = 30_000
const INVALID_LOCK_STALE_MS = 5 * 60_000

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function removeStaleLock(lockPath: string): Promise<boolean> {
  try {
    const [contents, metadata] = await Promise.all([readFile(lockPath, 'utf8'), stat(lockPath)])
    let stale = Date.now() - metadata.mtimeMs >= INVALID_LOCK_STALE_MS
    try {
      const lock = JSON.parse(contents) as { pid?: unknown; createdAt?: unknown }
      if (typeof lock.pid === 'number' && Number.isInteger(lock.pid) && lock.pid > 0) {
        const createdAt =
          typeof lock.createdAt === 'string' ? new Date(lock.createdAt).getTime() : metadata.mtimeMs
        stale = Date.now() - createdAt >= DEAD_LOCK_GRACE_MS && !processIsAlive(lock.pid)
      }
    } catch {
      // Invalid metadata is only removed after the longer mtime-based threshold.
    }
    if (!stale || (await readFile(lockPath, 'utf8')) !== contents) return false
    await rm(lockPath)
    return true
  } catch {
    return false
  }
}

function migrateProject(raw: unknown): { project: StudioProject; migrated: boolean } {
  const current = studioProjectSchema.safeParse(raw)
  if (current.success) return { project: current.data, migrated: false }
  if (!raw || typeof raw !== 'object' || !('formatVersion' in raw)) {
    throw new StudioCoreError('PROJECT_INVALID', '项目文件不符合 Agent Stack Project 格式。', {
      details: { validationIssues: current.error.issues },
    })
  }
  const legacy = raw as Record<string, unknown>
  if (legacy.formatVersion !== 0 && legacy.formatVersion !== 1) {
    throw new StudioCoreError('PROJECT_INVALID', '项目文件版本不受当前 Studio 支持。', {
      details: { formatVersion: legacy.formatVersion, supportedVersion: PROJECT_FORMAT_VERSION },
    })
  }
  try {
    const legacyWithoutWorkflows = { ...legacy }
    delete legacyWithoutWorkflows.workflows
    const versionOne = studioProjectV1Schema.parse(
      legacy.formatVersion === 1
        ? legacy
        : {
            ...legacyWithoutWorkflows,
            $schema: LEGACY_PROJECT_SCHEMA_ID,
            formatVersion: 1,
            revision: typeof legacy.revision === 'number' ? legacy.revision : 0,
            components: Array.isArray(legacy.components) ? legacy.components : [],
            stack:
              legacy.stack ??
              ({ executionMode: 'agent-loop', componentIds: [], capabilityOwners: [] } as const),
            versions: Array.isArray(legacy.versions) ? legacy.versions : [],
          },
    )
    return {
      migrated: true,
      project: studioProjectSchema.parse({
        ...versionOne,
        $schema: PROJECT_SCHEMA_ID,
        formatVersion: PROJECT_FORMAT_VERSION,
        workflows: [],
      }),
    }
  } catch (error) {
    throw new StudioCoreError(
      'PROJECT_MIGRATION_FAILED',
      `旧项目文件无法迁移到格式 v${PROJECT_FORMAT_VERSION}。`,
      { cause: error, details: { fromVersion: legacy.formatVersion } },
    )
  }
}

async function parseFile(
  filePath: string,
): Promise<{ project: StudioProject; migrated: boolean; integrity: ProjectIntegrityReport }> {
  let contents: string
  try {
    contents = await readFile(filePath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    throw new StudioCoreError(
      code === 'ENOENT' ? 'PROJECT_NOT_FOUND' : 'IO_FAILED',
      code === 'ENOENT'
        ? `未在 ${path.dirname(filePath)} 找到 ${PROJECT_FILE_NAME}。`
        : '无法读取项目文件。',
      { cause: error, details: { path: filePath } },
    )
  }
  try {
    const result = migrateProject(JSON.parse(contents) as unknown)
    return { ...result, integrity: verifyProjectIntegrity(result.project) }
  } catch (error) {
    if (error instanceof StudioCoreError) throw error
    throw new StudioCoreError('PROJECT_INVALID', '项目文件不是有效的 JSON。', {
      cause: error,
      details: { path: filePath },
    })
  }
}

async function atomicWrite(
  filePath: string,
  project: StudioProject,
  preserveBackup: boolean,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    if (preserveBackup) await copyFile(filePath, backupPath(filePath))
    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(project, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, filePath)
    const directory = await open(path.dirname(filePath), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw new StudioCoreError('IO_FAILED', '无法原子写入项目文件。', {
      cause: error,
      details: { path: filePath },
    })
  }
}

async function acquireWriteLock(filePath: string): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(lockPath, 'wx', 0o600)
      const token = randomUUID()
      await handle.writeFile(
        `${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`,
        'utf8',
      )
      await handle.sync()
      const lockedHandle = handle
      let released = false
      return async () => {
        if (released) return
        released = true
        await lockedHandle.close()
        let contents: string
        try {
          contents = await readFile(lockPath, 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
          throw error
        }
        let current: { token?: unknown }
        try {
          current = JSON.parse(contents) as { token?: unknown }
        } catch {
          return
        }
        if (current.token === token) await rm(lockPath, { force: true })
      }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      if (handle) await rm(lockPath, { force: true })
      if (
        !handle &&
        attempt === 0 &&
        (error as NodeJS.ErrnoException).code === 'EEXIST' &&
        (await removeStaleLock(lockPath))
      ) {
        continue
      }
      throw new StudioCoreError(
        'REVISION_CONFLICT',
        '另一个 Studio 进程正在写入项目，请重新读取后重试。',
        {
          cause: error,
          details: { lockPath },
          suggestedActions: [
            {
              command: 'studio project inspect --json',
              description: '等待当前写入完成后重新读取。',
            },
          ],
        },
      )
    }
  }
  throw new Error('Project lock acquisition exhausted unexpectedly.')
}

export class ProjectStore {
  resolve(inputPath: string): string {
    return projectPath(inputPath)
  }

  async init(rootPath: string, project: StudioProject): Promise<ProjectReadResult> {
    const filePath = projectPath(rootPath)
    await mkdir(path.dirname(filePath), { recursive: true })
    const release = await acquireWriteLock(filePath)
    try {
      try {
        const existing = await this.#readLocked(filePath, false)
        if (existing.project.id === project.id || existing.project.name === project.name)
          return existing
        throw new StudioCoreError('PROJECT_ALREADY_EXISTS', `${filePath} 已存在。`, {
          details: { path: filePath, projectId: existing.project.id },
        })
      } catch (error) {
        if (!(error instanceof StudioCoreError) || error.code !== 'PROJECT_NOT_FOUND') throw error
      }
      await atomicWrite(filePath, studioProjectSchema.parse(project), false)
      return {
        path: filePath,
        project,
        migrated: false,
        recovered: false,
        integrity: verifyProjectIntegrity(project),
      }
    } finally {
      await release()
    }
  }

  async read(inputPath: string, options: { recover?: boolean } = {}): Promise<ProjectReadResult> {
    const filePath = projectPath(inputPath)
    try {
      const result = await parseFile(filePath)
      if (!result.migrated) return { path: filePath, ...result, recovered: false }
    } catch (error) {
      if (
        !options.recover ||
        !(error instanceof StudioCoreError) ||
        error.code === 'PROJECT_NOT_FOUND'
      ) {
        throw error
      }
    }
    const release = await acquireWriteLock(filePath)
    try {
      return await this.#readLocked(filePath, options.recover ?? false)
    } finally {
      await release()
    }
  }

  async #readLocked(filePath: string, recover: boolean): Promise<ProjectReadResult> {
    try {
      const result = await parseFile(filePath)
      if (result.migrated) await atomicWrite(filePath, result.project, true)
      return { path: filePath, ...result, recovered: false }
    } catch (error) {
      if (!recover || !(error instanceof StudioCoreError) || error.code === 'PROJECT_NOT_FOUND')
        throw error
      try {
        const backup = await parseFile(backupPath(filePath))
        const preservedInvalidPath = `${filePath}.invalid-${Date.now()}`
        await copyFile(filePath, preservedInvalidPath).catch(() => undefined)
        await atomicWrite(filePath, backup.project, false)
        return { path: filePath, ...backup, recovered: true }
      } catch (recoveryError) {
        if (error instanceof StudioCoreError && error.code === 'PROJECT_INTEGRITY_FAILED') {
          throw new StudioCoreError(
            'PROJECT_INTEGRITY_FAILED',
            '不可变项目版本完整性检查失败，最后有效备份也无法恢复。',
            {
              cause: recoveryError,
              details: {
                ...error.details,
                path: filePath,
                backupPath: backupPath(filePath),
                backupRecoveryFailed: true,
              },
              suggestedActions: error.suggestedActions,
            },
          )
        }
        throw new StudioCoreError('PROJECT_INVALID', '项目文件无效，备份恢复也未成功。', {
          cause: recoveryError,
          details: { path: filePath, backupPath: backupPath(filePath) },
        })
      }
    }
  }

  async write(
    inputPath: string,
    project: StudioProject,
    expectedRevision: number,
  ): Promise<ProjectReadResult> {
    const filePath = projectPath(inputPath)
    const release = await acquireWriteLock(filePath)
    try {
      const current = await this.#readLocked(filePath, true)
      if (current.project.revision !== expectedRevision) {
        throw new StudioCoreError('REVISION_CONFLICT', '项目已被其他进程修改，请重新读取后再试。', {
          details: { expectedRevision, actualRevision: current.project.revision },
          suggestedActions: [
            { command: 'studio project inspect --json', description: '重新读取项目状态。' },
          ],
        })
      }
      const parsed = studioProjectSchema.parse(project)
      await atomicWrite(current.path, parsed, true)
      return {
        path: current.path,
        project: parsed,
        migrated: false,
        recovered: false,
        integrity: verifyProjectIntegrity(parsed),
      }
    } finally {
      await release()
    }
  }
}
