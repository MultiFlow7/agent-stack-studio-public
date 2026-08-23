import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const unresolvedPatterns = [
  { category: 'todo', pattern: /\bTODO\b/i },
  { category: 'fixme', pattern: /\bFIXME\b/i },
  { category: 'hack', pattern: /\bHACK\b/i },
  { category: 'placeholder-copy', pattern: /\b(?:coming soon|not implemented)\b|待实现|稍后提供/i },
  { category: 'dead-action', pattern: /onClick=\{\(\)\s*=>\s*(?:undefined|null)\}/ },
]

function normalized(filePath) {
  return filePath.split(path.sep).join('/')
}

export function inspectAcceptanceSource(filePath, content, contract) {
  const sourcePath = normalized(filePath)
  const issues = []
  for (const { category, pattern } of unresolvedPatterns) {
    if (pattern.test(content)) issues.push({ path: sourcePath, category })
  }

  for (const match of content.matchAll(/placeholder="([^"]+)"/g)) {
    const approved = contract.approvedPlaceholders.some(
      (entry) => entry.path === sourcePath && entry.value === match[1] && entry.purpose,
    )
    if (!approved) issues.push({ path: sourcePath, category: 'unclassified-input-placeholder' })
  }

  const harnessTokens = [
    ...content.matchAll(/\bSTUDIO_(?:CAPTURE|E2E|PACKAGED|SMOKE)[A-Z0-9_]*\b/g),
  ].map(([token]) => token)
  const approval = contract.approvedHarnesses.find((entry) => entry.path === sourcePath)
  for (const token of new Set(harnessTokens)) {
    if (!approval?.purpose || !approval.tokens.includes(token)) {
      issues.push({ path: sourcePath, category: `unclassified-harness:${token}` })
    }
  }
  return issues
}

export function inspectNavigation(appSource, commandCenterSource, contract) {
  const issues = []
  const entries = [
    ...appSource.matchAll(
      /\{ id: '([^']+)', label: '([^']+)', icon: \w+, enabled: (true|false) \}/g,
    ),
  ]
  const actual = new Map(entries.map(([, id, label, enabled]) => [id, { label, enabled }]))
  for (const { id, label } of contract.navigation) {
    const entry = actual.get(id)
    if (!entry)
      issues.push({ path: 'src/renderer/src/App.tsx', category: `missing-navigation:${id}` })
    else if (entry.label !== label || entry.enabled !== 'true') {
      issues.push({
        path: 'src/renderer/src/App.tsx',
        category: `disabled-or-mismatched-navigation:${id}`,
      })
    }
    if (!appSource.includes(`view === '${id}'`)) {
      issues.push({ path: 'src/renderer/src/App.tsx', category: `unrendered-navigation:${id}` })
    }
    if (!commandCenterSource.includes(`['${id}', '${label}'`)) {
      issues.push({ path: 'src/core/command-center.ts', category: `unsearchable-navigation:${id}` })
    }
  }
  for (const id of actual.keys()) {
    if (!contract.navigation.some((entry) => entry.id === id)) {
      issues.push({
        path: 'config/local-acceptance.json',
        category: `unclassified-navigation:${id}`,
      })
    }
  }
  return issues
}

export function verifyLocalAcceptance(repositoryRoot = process.cwd()) {
  const contract = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'config/local-acceptance.json'), 'utf8'),
  )
  if (contract.contractVersion !== 1) throw new Error('Unsupported local acceptance contract.')
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src', 'scripts'],
    { cwd: repositoryRoot, encoding: 'buffer' },
  )
  const sourcePaths = output
    .toString('utf8')
    .split('\0')
    .filter(
      (filePath) =>
        filePath &&
        /\.(?:ts|tsx|mjs)$/.test(filePath) &&
        !/\.test\.(?:ts|tsx|mjs)$/.test(filePath) &&
        !filePath.startsWith('src/test/') &&
        filePath !== 'scripts/verify-local-acceptance.mjs',
    )
  const issues = sourcePaths.flatMap((filePath) =>
    inspectAcceptanceSource(
      filePath,
      readFileSync(path.join(repositoryRoot, filePath), 'utf8'),
      contract,
    ),
  )
  issues.push(
    ...inspectNavigation(
      readFileSync(path.join(repositoryRoot, 'src/renderer/src/App.tsx'), 'utf8'),
      readFileSync(path.join(repositoryRoot, 'src/core/command-center.ts'), 'utf8'),
      contract,
    ),
  )
  if (issues.length) {
    throw new Error(
      `Local acceptance verification failed:\n${issues.map(({ category, path: issuePath }) => `${category}: ${issuePath}`).join('\n')}`,
    )
  }
  return {
    navigationCount: contract.navigation.length,
    placeholderCount: contract.approvedPlaceholders.length,
    harnessCount: contract.approvedHarnesses.length,
    sourceFileCount: sourcePaths.length,
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  const result = verifyLocalAcceptance()
  console.log(
    `LOCAL_ACCEPTANCE_AUDIT VERIFIED (${result.sourceFileCount} production sources, ${result.navigationCount} destinations, ${result.placeholderCount} classified input hints, ${result.harnessCount} packaged harnesses)`,
  )
}
