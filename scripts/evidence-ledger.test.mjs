import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildFinalReport } from './generate-final-report.mjs'
import { parseMarkdownMatrix, verifyEvidenceLedger } from './evidence-ledger.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('final evidence ledger', () => {
  it('parses escaped-free Markdown matrix rows into named fields', () => {
    expect(
      parseMarkdownMatrix('| LC-001 | source | scenario | COMPLETE |', 'LC', [
        'id',
        'source',
        'scenario',
        'status',
      ]),
    ).toEqual([{ id: 'LC-001', source: 'source', scenario: 'scenario', status: 'COMPLETE' }])
    expect(
      parseMarkdownMatrix('| RR-001 | source | `alpha|beta` | COMPLETE |', 'RR', [
        'id',
        'source',
        'scenario',
        'status',
      ])[0]?.scenario,
    ).toBe('`alpha|beta`')
  })

  it('verifies every frozen row, eight-state flow and local screenshot producer', () => {
    const result = verifyEvidenceLedger(repositoryRoot)
    expect(result.summary).toMatchObject({
      requirementCount: 150,
      flowCount: 8,
      screenshotCount: 23,
    })
  })

  it('builds a deterministic machine-readable report without release artifacts in tests', () => {
    const report = buildFinalReport(repositoryRoot, {
      generatedAt: '2026-08-21T00:00:00.000Z',
      strict: false,
      requireArtifacts: false,
    })
    expect(report.baseline).toBe('bceec476a6205a047efab7523ec75015ad70a905')
    expect(report.requirements).toHaveLength(150)
    expect(
      report.screenshots.every(({ publication }) => publication === 'local-only-gitignored'),
    ).toBe(true)
  })
})
