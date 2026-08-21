import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const allowedStatuses = new Set([
  'COMPLETE',
  'MISSING',
  'PARTIAL',
  'UNTESTED',
  'EXTERNAL-BLOCKED',
  'EXPLICITLY-OUT-OF-SCOPE',
])
const incompleteStatuses = new Set(['MISSING', 'PARTIAL', 'UNTESTED'])
const requiredCommands = [
  'npm run format:check',
  'npm run lint',
  'npm run typecheck',
  'npm run test',
  'npm run build',
  'npm run package:cli',
  'npm run package:mac',
  'npm run verify:mac-package',
  'npm run test:e2e:packaged',
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function parseMarkdownMatrix(content, prefix, columnNames) {
  const rowPattern = new RegExp(`^\\| (${prefix}-\\d{3}) \\|`)
  const rows = content
    .split('\n')
    .filter((line) => rowPattern.test(line))
    .map((line) => {
      const cells = []
      let cell = ''
      let inCode = false
      for (let index = 1; index < line.length - 1; index += 1) {
        const character = line[index]
        if (character === '`' && line[index - 1] !== '\\') inCode = !inCode
        if (character === '|' && !inCode && line[index - 1] !== '\\') {
          cells.push(cell.trim())
          cell = ''
        } else {
          cell += character
        }
      }
      cells.push(cell.trim())
      return cells
    })
  return rows.map((cells) => {
    assert(cells.length === columnNames.length, `${cells[0]} matrix column count changed`)
    return Object.fromEntries(columnNames.map((name, index) => [name, cells[index]]))
  })
}

function assertSequential(rows, prefix) {
  rows.forEach((row, index) => {
    const expected = `${prefix}-${String(index + 1).padStart(3, '0')}`
    assert(
      row.id === expected,
      `${prefix} requirements must remain sequential: expected ${expected}`,
    )
  })
}

function countStatuses(rows) {
  return Object.fromEntries(
    [...allowedStatuses].map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ]),
  )
}

export function loadEvidenceState(repositoryRoot = process.cwd()) {
  const config = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'config/final-evidence.json'), 'utf8'),
  )
  const localRequirements = parseMarkdownMatrix(
    readFileSync(path.join(repositoryRoot, 'docs/local-completeness-matrix.md'), 'utf8'),
    'LC',
    [
      'id',
      'source',
      'scenario',
      'status',
      'guiEvidence',
      'cliApiEvidence',
      'automatedEvidence',
      'packagedEvidence',
      'disposition',
    ],
  )
  const releaseRequirements = parseMarkdownMatrix(
    readFileSync(path.join(repositoryRoot, 'docs/release-readiness-matrix.md'), 'utf8'),
    'RR',
    ['id', 'source', 'scenario', 'status', 'localEvidence', 'credentialBoundary', 'disposition'],
  )
  return { config, localRequirements, releaseRequirements }
}

export function verifyEvidenceLedger(
  repositoryRoot = process.cwd(),
  { strict = false, requireArtifacts = false } = {},
) {
  const state = loadEvidenceState(repositoryRoot)
  const { config, localRequirements, releaseRequirements } = state
  assert(config.contractVersion === 1, 'Unsupported final evidence contract')
  assert(localRequirements.length >= 97, 'The frozen local matrix lost requirements')
  assert(releaseRequirements.length >= 39, 'The release matrix lost requirements')
  assertSequential(localRequirements, 'LC')
  assertSequential(releaseRequirements, 'RR')

  const allRequirements = [...localRequirements, ...releaseRequirements]
  const requirementIds = new Set(allRequirements.map(({ id }) => id))
  for (const requirement of allRequirements) {
    assert(allowedStatuses.has(requirement.status), `${requirement.id} has an invalid status`)
  }

  const dimensions = config.stateDimensions
  assert(new Set(dimensions).size === 8, 'Exactly eight unique flow-state dimensions are required')
  for (const required of [
    'empty',
    'loading',
    'success',
    'failure',
    'cancel',
    'conflict',
    'external-refresh',
    'keyboard',
  ]) {
    assert(dimensions.includes(required), `Missing flow-state dimension: ${required}`)
  }

  const catalogIds = new Set(Object.keys(config.evidenceCatalog))
  const usedCatalogIds = new Set()
  const flowIds = new Set()
  for (const flow of config.flows) {
    assert(!flowIds.has(flow.id), `Duplicate flow id: ${flow.id}`)
    flowIds.add(flow.id)
    assert(flow.requirementIds.length > 0, `${flow.id} must map to frozen requirements`)
    for (const requirementId of flow.requirementIds) {
      assert(requirementIds.has(requirementId), `${flow.id} references unknown ${requirementId}`)
    }
    assert(
      JSON.stringify(Object.keys(flow.states).sort()) === JSON.stringify([...dimensions].sort()),
      `${flow.id} must classify all eight states`,
    )
    for (const evidenceId of Object.values(flow.states)) {
      assert(catalogIds.has(evidenceId), `${flow.id} references unknown evidence ${evidenceId}`)
      usedCatalogIds.add(evidenceId)
    }
  }

  for (const [evidenceId, evidence] of Object.entries(config.evidenceCatalog)) {
    assert(usedCatalogIds.has(evidenceId), `Unused evidence catalog entry: ${evidenceId}`)
    assert(['verified', 'boundary'].includes(evidence.kind), `${evidenceId} has invalid kind`)
    if (evidence.kind === 'boundary') {
      assert(evidence.rationale?.length >= 20, `${evidenceId} boundary needs a rationale`)
    }
    assert(evidence.references?.length > 0, `${evidenceId} needs evidence references`)
    assert(
      evidence.references.some(({ path: referencePath }) =>
        /(?:\.test\.|scripts\/e2e-packaged-app\.mjs$)/.test(referencePath),
      ),
      `${evidenceId} needs an automated evidence reference`,
    )
    for (const reference of evidence.references) {
      const absolutePath = path.join(repositoryRoot, reference.path)
      assert(existsSync(absolutePath), `${evidenceId} evidence path is missing: ${reference.path}`)
      assert(
        readFileSync(absolutePath, 'utf8').includes(reference.contains),
        `${evidenceId} evidence token is missing from ${reference.path}`,
      )
    }
  }

  const screenshotIds = new Set()
  const screenshotStates = new Set()
  const packagedHarness = readFileSync(
    path.join(repositoryRoot, 'scripts/e2e-packaged-app.mjs'),
    'utf8',
  )
  for (const screenshot of config.screenshots) {
    assert(!screenshotIds.has(screenshot.id), `Duplicate screenshot id: ${screenshot.id}`)
    screenshotIds.add(screenshot.id)
    assert(flowIds.has(screenshot.flowId), `${screenshot.id} references unknown flow`)
    assert(dimensions.includes(screenshot.state), `${screenshot.id} has an invalid state`)
    assert(
      screenshot.path.startsWith('artifacts/packaged-app-e2e'),
      `${screenshot.id} must remain a local packaged artifact`,
    )
    const tracked = execFileSync('git', ['ls-files', '--', screenshot.path], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim()
    assert(tracked === '', `${screenshot.path} must not be published in Git`)
    execFileSync('git', ['check-ignore', '--quiet', screenshot.path], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    })
    assert(
      packagedHarness.includes(screenshot.producerToken),
      `${screenshot.id} producer is missing`,
    )
    if (requireArtifacts) {
      assert(
        existsSync(path.join(repositoryRoot, screenshot.path)),
        `${screenshot.path} is missing`,
      )
    }
    screenshotStates.add(screenshot.state)
  }
  for (const requiredState of [
    'empty',
    'success',
    'failure',
    'cancel',
    'conflict',
    'external-refresh',
  ]) {
    assert(screenshotStates.has(requiredState), `Screenshot matrix lacks ${requiredState} evidence`)
  }

  assert(
    JSON.stringify(config.validationCommands) === JSON.stringify(requiredCommands),
    'Final validation command list changed',
  )
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'))
  const expectedPackages = [
    'release/mac-arm64/Agent Stack Studio.app',
    `release/Agent Stack Studio-${packageJson.version}-arm64.dmg`,
    `release/Agent Stack Studio-${packageJson.version}-arm64.zip`,
    `release/release-dry-run-${packageJson.version}-arm64.json`,
  ]
  assert(
    JSON.stringify(config.packageArtifacts) === JSON.stringify(expectedPackages),
    'Package evidence paths must derive from package.json version',
  )
  if (requireArtifacts) {
    for (const artifactPath of config.packageArtifacts) {
      assert(existsSync(path.join(repositoryRoot, artifactPath)), `${artifactPath} is missing`)
    }
  }

  const externalBlocked = allRequirements
    .filter(({ status }) => status === 'EXTERNAL-BLOCKED')
    .map(({ id }) => id)
    .sort()
  assert(
    JSON.stringify(externalBlocked) === JSON.stringify([...config.allowedExternalBlocked].sort()),
    'EXTERNAL-BLOCKED requirements exceed the approved external boundary',
  )

  for (const requirement of localRequirements) {
    if (requirement.status === 'COMPLETE') {
      assert(
        !['', '无', 'N/A', '文档边界'].includes(requirement.automatedEvidence),
        `${requirement.id} lacks automated evidence`,
      )
      assert(requirement.guiEvidence.length > 0, `${requirement.id} lacks GUI boundary evidence`)
      assert(
        requirement.packagedEvidence.length > 0,
        `${requirement.id} lacks packaged boundary evidence`,
      )
    }
  }

  if (strict) {
    const incomplete = allRequirements.filter(({ status }) => incompleteStatuses.has(status))
    assert(
      incomplete.length === 0,
      `Incomplete requirements remain: ${incomplete.map(({ id }) => id)}`,
    )
  }

  return {
    ...state,
    summary: {
      local: countStatuses(localRequirements),
      release: countStatuses(releaseRequirements),
      flowCount: config.flows.length,
      screenshotCount: config.screenshots.length,
      requirementCount: allRequirements.length,
    },
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  const strict = process.argv.includes('--strict')
  const requireArtifacts = process.argv.includes('--require-artifacts')
  const { summary } = verifyEvidenceLedger(process.cwd(), { strict, requireArtifacts })
  console.log(
    `FINAL_EVIDENCE_LEDGER VERIFIED (${summary.requirementCount} requirements, ${summary.flowCount} flows, ${summary.screenshotCount} local screenshots)`,
  )
}
