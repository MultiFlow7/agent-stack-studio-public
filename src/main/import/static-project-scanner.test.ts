import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanProject } from './static-project-scanner'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('scanProject', () => {
  it('extracts evidence from manifests without executing project code', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'agent-import-'))
    temporaryDirectories.push(directory)
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: '@research/evaluation-agent',
        scripts: { postinstall: 'exit 99' },
        dependencies: { '@langchain/langgraph': '1.0.0' },
      }),
    )
    await writeFile(path.join(directory, 'AGENTS.md'), '# Instructions')

    const scan = await scanProject(directory, '4d3f3df6-4895-4d8e-8435-772764990db7')

    expect(scan.suggestedName).toBe('evaluation agent')
    expect(scan.projectType).toBe('node')
    expect(scan.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'package.json', detail: 'Node 包清单' }),
        expect.objectContaining({ detail: '声明了 @langchain/langgraph 依赖' }),
        expect.objectContaining({ path: 'AGENTS.md' }),
      ]),
    )
  })
})
