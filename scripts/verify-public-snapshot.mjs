import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sensitiveFileNamePatterns = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:id_rsa|id_ed25519)(?:\.|$)/i,
  /\.(?:pem|key|p12|pfx|mobileprovision|provisionprofile|keystore|jks|sqlite|sqlite3|db|log)$/i,
  /(^|\/)(?:credentials?|secrets?|tokens?|cookies?|sessions?)\.(?:json|ya?ml|txt|ini|conf)$/i,
]

const sensitiveContentPatterns = [
  { category: 'private-key', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g },
  { category: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    category: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  { category: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { category: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { category: 'stripe-live-key', pattern: /\bsk_live_[A-Za-z0-9]{16,}\b/g },
  { category: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
]

const allowedEmailDomains = new Set(['example.test', 'users.noreply.github.com'])
const allowedUserNames = new Set(['researcher', 'runner', 'test', 'tester'])
const approvedBinaryAssets = new Set(['build/icon.icns', 'build/icon.png'])

function addUniqueIssue(issues, issue) {
  if (
    !issues.some(
      (candidate) => candidate.path === issue.path && candidate.category === issue.category,
    )
  ) {
    issues.push(issue)
  }
}

export function inspectPublicSnapshotFile(filePath, content) {
  const normalizedPath = filePath.split(path.sep).join('/')
  const issues = []

  for (const pattern of sensitiveFileNamePatterns) {
    if (pattern.test(normalizedPath)) {
      addUniqueIssue(issues, { path: normalizedPath, category: 'sensitive-file-name' })
    }
  }

  if (Buffer.isBuffer(content) && content.includes(0)) {
    if (!approvedBinaryAssets.has(normalizedPath)) {
      addUniqueIssue(issues, { path: normalizedPath, category: 'unapproved-binary' })
    }
    return issues
  }
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : content

  for (const { category, pattern } of sensitiveContentPatterns) {
    pattern.lastIndex = 0
    if (pattern.test(text)) addUniqueIssue(issues, { path: normalizedPath, category })
  }

  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
    if (match[0].toLowerCase() === 'git@github.com') continue
    const domain = match[1].toLowerCase()
    if (!allowedEmailDomains.has(domain)) {
      addUniqueIssue(issues, { path: normalizedPath, category: 'non-fixture-email' })
    }
  }

  const userPathPatterns = [
    /\/Users\/([A-Za-z0-9._-]+)\//g,
    /[A-Za-z]:\\Users\\([A-Za-z0-9._-]+)\\/g,
    /\/home\/([A-Za-z0-9._-]+)\//g,
  ]
  for (const pattern of userPathPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (!allowedUserNames.has(match[1])) {
        addUniqueIssue(issues, { path: normalizedPath, category: 'personal-user-path' })
      }
    }
  }

  return issues
}

export function verifyPublicSnapshot(repositoryRoot = process.cwd()) {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: repositoryRoot,
      encoding: 'buffer',
    },
  )
  const trackedPaths = output.toString('utf8').split('\0').filter(Boolean)
  const issues = trackedPaths.flatMap((filePath) =>
    inspectPublicSnapshotFile(filePath, readFileSync(path.join(repositoryRoot, filePath))),
  )
  if (issues.length > 0) {
    const summary = issues.map((issue) => `${issue.category}: ${issue.path}`).join('\n')
    throw new Error(`Public snapshot privacy verification failed:\n${summary}`)
  }
  return { trackedFileCount: trackedPaths.length }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  const result = verifyPublicSnapshot()
  console.log(`PUBLIC_SNAPSHOT_PRIVACY VERIFIED (${result.trackedFileCount} tracked files)`)
}
