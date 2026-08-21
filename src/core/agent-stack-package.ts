import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import packageMetadata from '../../package.json' with { type: 'json' }
import {
  AGENT_STACK_PACKAGE_FORMAT_VERSION,
  AGENT_STACK_PACKAGE_SCHEMA_ID,
  agentStackPackageExcludedContent,
  agentStackPackageSchema,
  projectExportResultSchema,
  type AgentStackPackage,
  type ProjectExportResult,
} from '../shared/agent-stack-package'
import { StudioCoreError } from './project-errors'
import { stableHash, studioProjectSchema, type StudioProject } from './project-model'

export interface UnsafePortableReference {
  path: string
  reason: 'absolute-path' | 'file-url' | 'credentialed-url' | 'query-url'
}

function referenceReason(value: string): UnsafePortableReference['reason'] | null {
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.startsWith('~/')) {
    return 'absolute-path'
  }
  if (/^file:/i.test(value)) return 'file-url'
  try {
    const url = new URL(value)
    if (url.username || url.password) return 'credentialed-url'
    if (url.search) return 'query-url'
  } catch {
    // Most project strings are names, relative references, or declarative JSON.
  }
  return null
}

export function findUnsafePortableReferences(value: unknown): UnsafePortableReference[] {
  const issues: UnsafePortableReference[] = []
  const visit = (current: unknown, segments: Array<string | number>): void => {
    if (typeof current === 'string') {
      const reason = referenceReason(current)
      if (reason) issues.push({ path: segments.join('.'), reason })
      return
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, [...segments, index]))
      return
    }
    if (current && typeof current === 'object') {
      for (const [key, item] of Object.entries(current)) visit(item, [...segments, key])
    }
  }
  visit(value, [])
  return issues
}

export function buildAgentStackPackage(project: StudioProject): AgentStackPackage {
  const parsedProject = studioProjectSchema.parse(project)
  const unsafeReferences = findUnsafePortableReferences(parsedProject)
  if (unsafeReferences.length > 0) {
    throw new StudioCoreError(
      'PACKAGE_UNSAFE',
      '项目包含不可移植的本机路径或敏感 URL，已拒绝导出。',
      {
        details: { unsafeReferences },
        suggestedActions: [
          {
            description:
              '把 Descriptor 和来源中的绝对路径改为相对引用，并移除 URL 凭据与查询参数。',
          },
          {
            command: 'studio project inspect --json',
            description: '重新检查项目事实后再导出。',
          },
        ],
      },
    )
  }
  const withoutHash = {
    $schema: AGENT_STACK_PACKAGE_SCHEMA_ID,
    packageFormatVersion: AGENT_STACK_PACKAGE_FORMAT_VERSION,
    producer: { name: 'Agent Stack Studio' as const, version: packageMetadata.version },
    project: parsedProject,
    excludedContent: agentStackPackageExcludedContent,
  }
  return agentStackPackageSchema.parse({ ...withoutHash, contentHash: stableHash(withoutHash) })
}

export function verifyAgentStackPackage(input: unknown): AgentStackPackage {
  const parsed = agentStackPackageSchema.parse(input)
  const { contentHash, ...withoutHash } = parsed
  if (stableHash(withoutHash) !== contentHash) {
    throw new StudioCoreError('PROJECT_INTEGRITY_FAILED', 'Agent Stack Package 内容哈希不匹配。', {
      details: { expectedHash: contentHash, actualHash: stableHash(withoutHash) },
    })
  }
  return parsed
}

export async function writeAgentStackPackage(
  destinationPath: string,
  agentStackPackage: AgentStackPackage,
): Promise<ProjectExportResult> {
  const destination = path.resolve(destinationPath)
  const temporaryPath = `${destination}.${randomUUID()}.tmp`
  try {
    await mkdir(path.dirname(destination), { recursive: true })
    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(agentStackPackage, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, destination)
    const directory = await open(path.dirname(destination), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw new StudioCoreError('IO_FAILED', '无法原子写入 Agent Stack Package。', {
      cause: error,
      details: { path: destination },
    })
  }
  return projectExportResultSchema.parse({
    status: 'exported',
    path: destination,
    packageHash: agentStackPackage.contentHash,
    projectRevision: agentStackPackage.project.revision,
    componentCount: agentStackPackage.project.components.length,
    workflowCount: agentStackPackage.project.workflows.length,
    versionCount: agentStackPackage.project.versions.length,
    excludedContent: agentStackPackage.excludedContent,
  })
}
