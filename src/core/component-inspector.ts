import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { componentDescriptorSchema, type ComponentDescriptor } from '../shared/component'
import {
  componentSourceSnapshotSchema,
  evidenceLevelSchema,
  gitSnapshotSchema,
  projectComponentSchema,
  type EvidenceLevel,
  type ProjectComponent,
} from './project-model'
import { StudioCoreError } from './project-errors'

const executeFile = promisify(execFile)
const MAX_TEXT_BYTES = 1_000_000
const MAX_TREE_ENTRIES = 400
const MAX_TREE_DEPTH = 4
const manifestNames = ['agent-stack.component.json', 'component.json'] as const

export function sanitizeGitRemote(value: string | null): string | null {
  const candidate = value?.trim()
  if (!candidate || candidate.length > 2_000) return null
  const scp = candidate.includes('://')
    ? null
    : /^(?:[^@\s]+@)?([A-Za-z0-9.-]+):([^\s]+)$/.exec(candidate)
  if (scp?.[1] && scp[2] && !path.isAbsolute(candidate)) {
    return `ssh://${scp[1]}/${scp[2].replace(/^\/+/, '')}`
  }
  try {
    const url = new URL(candidate)
    if (!['http:', 'https:', 'ssh:', 'git:'].includes(url.protocol) || !url.hostname) return null
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export const componentInspectionSchema = z
  .object({
    source: componentSourceSnapshotSchema,
    descriptor: componentDescriptorSchema,
    evidenceLevel: evidenceLevelSchema,
    warnings: z.array(z.string()),
    safety: z.object({
      executedProjectCode: z.literal(false),
      followedSymbolicLinks: z.literal(false),
    }),
  })
  .strict()

export type ComponentInspection = z.infer<typeof componentInspectionSchema>

async function readSafeText(filePath: string): Promise<string> {
  const metadata = await lstat(filePath)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new StudioCoreError('UNSAFE_SOURCE', `拒绝读取非普通文件：${filePath}`)
  }
  if (metadata.size > MAX_TEXT_BYTES) {
    throw new StudioCoreError('UNSAFE_SOURCE', `文件超过静态扫描上限：${filePath}`)
  }
  return readFile(filePath, 'utf8')
}

async function findNamedFile(root: string, names: readonly string[]): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true })
  const byLowerName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]))
  for (const name of names) {
    const entry = byLowerName.get(name.toLowerCase())
    if (entry?.isFile() && !entry.isSymbolicLink()) return path.join(root, entry.name)
  }
  return null
}

async function collectTree(root: string): Promise<string[]> {
  const result: string[] = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_TREE_DEPTH || result.length >= MAX_TREE_ENTRIES) return
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )
    for (const entry of entries) {
      if (result.length >= MAX_TREE_ENTRIES) break
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.venv') continue
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      if (entry.isSymbolicLink()) {
        result.push(`${relative}@symlink`)
      } else if (entry.isDirectory()) {
        result.push(`${relative}/`)
        await visit(absolute, depth + 1)
      } else if (entry.isFile()) {
        result.push(relative)
      }
    }
  }
  await visit(root, 0)
  return result
}

async function inspectGit(root: string) {
  const run = async (args: string[]): Promise<string | null> => {
    try {
      const { stdout } = await executeFile(
        '/usr/bin/git',
        ['-c', 'core.hooksPath=/dev/null', '-C', root, ...args],
        {
          env: {
            PATH: '/usr/bin:/bin',
            LANG: 'C',
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null',
          },
          maxBuffer: MAX_TEXT_BYTES,
          timeout: 5_000,
        },
      )
      return stdout.trim()
    } catch {
      return null
    }
  }
  const [commit, rawRemote, statusText] = await Promise.all([
    run(['rev-parse', 'HEAD']),
    run(['remote', 'get-url', 'origin']),
    run(['status', '--porcelain=v1', '--untracked-files=normal']),
  ])
  const remote = sanitizeGitRemote(rawRemote)
  let statusValue: 'clean' | 'modified' | 'untracked' | 'unavailable' = 'unavailable'
  if (statusText !== null) {
    if (statusText.length === 0) statusValue = 'clean'
    else if (statusText.split('\n').some((line) => line.startsWith('??'))) statusValue = 'untracked'
    else statusValue = 'modified'
  }
  return gitSnapshotSchema.parse({
    remote: remote || null,
    commit: commit && /^[a-f0-9]{40}$/.test(commit) ? commit : null,
    status: statusValue,
  })
}

function detectedDescriptor(
  root: string,
  packageManifest: Record<string, unknown> | null,
): ComponentDescriptor {
  const rawName =
    typeof packageManifest?.name === 'string' ? packageManifest.name : path.basename(root)
  const slug = rawName
    .toLowerCase()
    .replace(/^@/, '')
    .replaceAll(/[^a-z0-9]+/g, '.')
    .replaceAll(/^\.|\.$/g, '')
  const id = slug.includes('.') ? slug : `local.${slug || 'component'}`
  const version =
    typeof packageManifest?.version === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageManifest.version)
      ? packageManifest.version
      : '0.0.0'
  return componentDescriptorSchema.parse({
    contractVersion: 1,
    id,
    name: rawName.slice(0, 100),
    version,
    kind: 'component',
    source: { kind: 'static-import', location: '.', license: 'UNKNOWN' },
    platforms: ['darwin-arm64', 'darwin-x64'],
    provides: [
      {
        capability: 'execution-controller',
        implementation: `${id}.detected`,
        replaceability: 'unknown',
        confidence: 'detected',
        activation: 'owner-only',
      },
    ],
    requires: [],
    configSchema: null,
    runtimeAdapter: null,
    compatibility: {
      level: 'unknown',
      validation: 'declared',
      detail: '未发现显式 Component Manifest；缺少能力替换边界、契约测试和受信运行证据。',
    },
    evidence: [
      {
        kind: 'static-check',
        status: 'passed',
        method: 'safe-static-inspection-v2',
        detail: '由安全静态检查生成候选 Descriptor，未执行项目代码。',
      },
    ],
  })
}

export async function inspectComponentSource(sourcePath: string): Promise<ComponentInspection> {
  let root: string
  try {
    root = await realpath(sourcePath)
    if (!(await stat(root)).isDirectory()) throw new Error('not-directory')
  } catch (error) {
    throw new StudioCoreError('COMPONENT_NOT_FOUND', '组件来源目录不存在或不可读取。', {
      cause: error,
      details: { sourcePath },
    })
  }
  const manifestPath = await findNamedFile(root, manifestNames)
  const readmePath = await findNamedFile(root, ['README.md', 'README.txt', 'README'])
  const licensePath = await findNamedFile(root, ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'])
  const packagePath = await findNamedFile(root, ['package.json'])
  let packageManifest: Record<string, unknown> | null = null
  if (packagePath) {
    try {
      packageManifest = JSON.parse(await readSafeText(packagePath)) as Record<string, unknown>
    } catch {
      packageManifest = null
    }
  }
  let descriptor: ComponentDescriptor
  let evidenceLevel: EvidenceLevel = 'detected'
  const warnings: string[] = []
  if (manifestPath) {
    try {
      const raw = JSON.parse(await readSafeText(manifestPath)) as unknown
      const wrapped = z
        .object({ manifestVersion: z.literal(1), component: componentDescriptorSchema })
        .strict()
        .safeParse(raw)
      descriptor = wrapped.success ? wrapped.data.component : componentDescriptorSchema.parse(raw)
      evidenceLevel = 'declared'
    } catch (error) {
      throw new StudioCoreError('COMPONENT_INVALID', 'Component Manifest 无效。', {
        cause: error,
        details: { manifestPath },
      })
    }
  } else {
    descriptor = detectedDescriptor(root, packageManifest)
    warnings.push(
      '未发现 agent-stack.component.json，已生成机器证据不足的候选 Descriptor；用户编辑不能代替技术验证。',
    )
  }
  if (readmePath) await readSafeText(readmePath)
  if (licensePath) await readSafeText(licensePath)
  const files = await collectTree(root)
  const git = await inspectGit(root)
  if (git.status === 'modified' || git.status === 'untracked') {
    warnings.push('Git 工作树包含未提交变更，冻结版本时会保留该状态证据。')
  }
  const inspectedAt = new Date().toISOString()
  const source = componentSourceSnapshotSchema.parse({
    path: root,
    manifestPath,
    readmePath,
    licensePath,
    git,
    files,
    contentHash: createHash('sha256')
      .update(JSON.stringify({ descriptor, git, files }))
      .digest('hex'),
    inspectedAt,
  })
  return componentInspectionSchema.parse({
    source,
    descriptor,
    evidenceLevel,
    warnings,
    safety: { executedProjectCode: false, followedSymbolicLinks: false },
  })
}

export function componentFromInspection(
  inspection: ComponentInspection,
  existing?: ProjectComponent,
): ProjectComponent {
  const timestamp = new Date().toISOString()
  const portablePath =
    inspection.source.git.remote ??
    `local-source:${inspection.descriptor.id}@${inspection.descriptor.version}`
  const portableFile = (filePath: string | null) =>
    filePath ? path.relative(inspection.source.path, filePath).split(path.sep).join('/') : null
  return projectComponentSchema.parse({
    id: existing?.id ?? randomUUID(),
    descriptor: inspection.descriptor,
    evidenceLevel: inspection.evidenceLevel,
    source: {
      ...inspection.source,
      path: portablePath,
      manifestPath: portableFile(inspection.source.manifestPath),
      readmePath: portableFile(inspection.source.readmePath),
      licensePath: portableFile(inspection.source.licensePath),
    },
    archivedAt: existing?.archivedAt ?? null,
    importedAt: existing?.importedAt ?? timestamp,
    updatedAt: timestamp,
    auditTrail: [
      ...(existing?.auditTrail ?? []),
      {
        id: randomUUID(),
        action: existing ? 'static-inspected' : 'imported',
        actor: 'system',
        summary: existing
          ? '已重新执行安全静态检查，未执行项目代码。'
          : '已完成首次安全静态导入，未执行项目代码。',
        recordedAt: timestamp,
      },
    ],
  })
}
