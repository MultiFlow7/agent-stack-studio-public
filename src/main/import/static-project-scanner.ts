import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ImportScan, ScanEvidence } from '../../shared/import'

const maxManifestBytes = 1_000_000
const recognizedFiles = new Set([
  'AGENTS.md',
  'agent-stack.json',
  'component.yaml',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
])

function safeName(name: string): string {
  const normalized = name
    .replace(/^@[^/]+\//, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return normalized.length > 0 ? normalized.slice(0, 80) : '导入的 Agent'
}

async function readSmallText(filePath: string): Promise<string | undefined> {
  const metadata = await stat(filePath)
  if (!metadata.isFile() || metadata.size > maxManifestBytes) return undefined
  return readFile(filePath, 'utf8')
}

export async function scanProject(sourcePath: string, scanId: string): Promise<ImportScan> {
  const directory = await stat(sourcePath)
  if (!directory.isDirectory()) throw new Error('所选导入路径不是文件夹。')

  const entries = await readdir(sourcePath, { withFileTypes: true })
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name))
  const evidence: ScanEvidence[] = []
  let suggestedName = safeName(path.basename(sourcePath))
  let projectType: ImportScan['projectType'] = 'unknown'

  if (files.has('package.json')) {
    const contents = await readSmallText(path.join(sourcePath, 'package.json'))
    if (contents) {
      try {
        const packageManifest = JSON.parse(contents) as {
          name?: unknown
          dependencies?: Record<string, unknown>
          devDependencies?: Record<string, unknown>
        }
        if (typeof packageManifest.name === 'string') suggestedName = safeName(packageManifest.name)
        projectType = 'node'
        evidence.push({ kind: 'manifest', path: 'package.json', detail: 'Node 包清单' })
        const dependencies = {
          ...packageManifest.dependencies,
          ...packageManifest.devDependencies,
        }
        for (const dependency of ['cordis', 'langchain', '@langchain/langgraph', 'openai']) {
          if (dependency in dependencies) {
            evidence.push({
              kind: 'dependency',
              path: 'package.json',
              detail: `声明了 ${dependency} 依赖`,
            })
          }
        }
      } catch {
        evidence.push({
          kind: 'manifest',
          path: 'package.json',
          detail: '包清单存在，但不是有效的 JSON',
        })
      }
    }
  }

  if (files.has('pyproject.toml') || files.has('requirements.txt')) {
    if (projectType === 'unknown') projectType = 'python'
    const manifest = files.has('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt'
    evidence.push({ kind: 'manifest', path: manifest, detail: 'Python 项目清单' })
  }
  if (files.has('agent-stack.json') || files.has('component.yaml')) {
    projectType = 'agent-config'
    const manifest = files.has('agent-stack.json') ? 'agent-stack.json' : 'component.yaml'
    evidence.push({ kind: 'manifest', path: manifest, detail: 'Agent Stack 描述文件' })
  }
  if (files.has('AGENTS.md')) {
    evidence.push({ kind: 'convention', path: 'AGENTS.md', detail: 'Agent 指令文件' })
  }

  const unrecognizedManifests = [...files].filter((file) => recognizedFiles.has(file)).length === 0
  return {
    scanId,
    sourcePath,
    suggestedName,
    projectType,
    evidence,
    warnings: unrecognizedManifests ? ['未发现可识别的 Agent 或包清单，请检查导入后的草稿。'] : [],
  }
}
