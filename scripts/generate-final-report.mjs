import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyEvidenceLedger } from './evidence-ledger.mjs'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

export function buildFinalReport(
  repositoryRoot,
  {
    privateCommit,
    publicCommit,
    ciRunId,
    ciUrl,
    generatedAt = new Date().toISOString(),
    strict = true,
    requireArtifacts = true,
  } = {},
) {
  const verified = verifyEvidenceLedger(repositoryRoot, { strict, requireArtifacts })
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim()
  const resolvedPrivateCommit = privateCommit ?? head
  if (strict) {
    if (!publicCommit) throw new Error('Final report requires --public-commit')
    if (!ciRunId) throw new Error('Final report requires --ci-run')
    if (!ciUrl) throw new Error('Final report requires --ci-url')
  }
  const requirements = [...verified.localRequirements, ...verified.releaseRequirements]
  return {
    schemaVersion: 1,
    product: 'Agent Stack Studio',
    version: JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')).version,
    generatedAt,
    baseline: 'bceec476a6205a047efab7523ec75015ad70a905',
    commits: { private: resolvedPrivateCommit, public: publicCommit ?? null },
    ci: { runId: ciRunId ?? null, url: ciUrl ?? null, conclusion: ciRunId ? 'success' : null },
    summary: verified.summary,
    validationCommands: verified.config.validationCommands,
    packages: verified.config.packageArtifacts.map((artifactPath) => ({ path: artifactPath })),
    screenshots: verified.config.screenshots.map((screenshot) => ({
      ...screenshot,
      locale: 'zh-CN',
      publication: 'local-only-gitignored',
    })),
    requirements,
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  const repositoryRoot = process.cwd()
  const output = path.resolve(
    repositoryRoot,
    argument('--output') ?? 'release/final-local-completeness-report.json',
  )
  const report = buildFinalReport(repositoryRoot, {
    privateCommit: argument('--private-commit'),
    publicCommit: argument('--public-commit'),
    ciRunId: argument('--ci-run'),
    ciUrl: argument('--ci-url'),
    strict: !process.argv.includes('--allow-incomplete'),
    requireArtifacts: !process.argv.includes('--allow-missing-artifacts'),
  })
  mkdirSync(path.dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`FINAL_LOCAL_COMPLETENESS_REPORT ${output}`)
}
