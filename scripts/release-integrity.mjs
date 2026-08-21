import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export function checksumManifestName({ version, architecture }) {
  return `SHA256SUMS-${version}-${architecture}.txt`
}

export async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

export function formatChecksumManifest(entries) {
  return [...entries]
    .sort((left, right) => left.fileName.localeCompare(right.fileName))
    .map(({ fileName, sha256 }) => `${sha256}  ${fileName}`)
    .join('\n')
    .concat('\n')
}

export function parseChecksumManifest(contents) {
  const entries = new Map()
  for (const line of contents.trim().split('\n')) {
    const match = line.match(/^([a-f0-9]{64})  ([^/]+)$/)
    if (!match) throw new Error(`无效的 SHA-256 清单行：${line}`)
    if (entries.has(match[2])) throw new Error(`SHA-256 清单包含重复文件：${match[2]}`)
    entries.set(match[2], match[1])
  }
  return entries
}

export async function verifyReleaseChecksums({ checksumPath, artifactPaths }) {
  const entries = parseChecksumManifest(await readFile(checksumPath, 'utf8'))
  const expectedNames = artifactPaths.map((artifactPath) => path.basename(artifactPath)).sort()
  const actualNames = [...entries.keys()].sort()
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error('SHA-256 清单中的发布物集合与预期不一致。')
  }

  for (const artifactPath of artifactPaths) {
    const fileName = path.basename(artifactPath)
    const actual = await sha256File(artifactPath)
    if (entries.get(fileName) !== actual) throw new Error(`SHA-256 校验失败：${fileName}`)
  }
}
