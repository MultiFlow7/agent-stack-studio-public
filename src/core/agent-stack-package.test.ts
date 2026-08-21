import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import packageMetadata from '../../package.json'
import type { StudioCoreError } from './project-errors'
import { StudioCore } from './studio-core'
import {
  buildAgentStackPackage,
  findUnsafePortableReferences,
  verifyAgentStackPackage,
} from './agent-stack-package'

const temporaryPaths: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-stack-package-'))
  temporaryPaths.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  )
})

describe('Agent Stack Package', () => {
  it('builds a deterministic, verified package from the exact portable project facts', async () => {
    const root = await temporaryDirectory()
    const core = new StudioCore()
    let { project } = await core.initProject(root, { name: '可移植 Fixture' })
    project = (await core.createWorkflow(root, { name: '可移植 Workflow' })).project
    const workflowId = project.workflows[0].id
    project = (
      await core.addWorkflowNode(root, workflowId, {
        kind: 'operation',
        name: '准备',
        operation: 'prepare',
      })
    ).project
    project = (await core.freezeWorkflowVersion(root, workflowId)).result.project

    const first = buildAgentStackPackage(project)
    const second = buildAgentStackPackage(project)
    expect(second).toEqual(first)
    expect(first.producer.version).toBe(packageMetadata.version)
    expect(first.project).toEqual(project)
    expect(first).toMatchObject({
      packageFormatVersion: 2,
      project: { formatVersion: 2, workflows: [{ versions: [{ versionNumber: 1 }] }] },
    })
    expect(first.excludedContent).toEqual([
      'keychain-secrets',
      'sqlite-local-index',
      'runs-and-experiments',
      'receipts-and-remote-mappings',
      'artifacts-and-logs',
      'absolute-local-paths',
    ])
    expect(verifyAgentStackPackage(first)).toEqual(first)

    const tampered = structuredClone(first)
    tampered.project.name = 'tampered'
    expect(() => verifyAgentStackPackage(tampered)).toThrow('内容哈希不匹配')
  })

  it('exports atomically with owner-only permissions and never overwrites .agent-stack', async () => {
    const root = await temporaryDirectory()
    const core = new StudioCore()
    await core.initProject(root, { name: 'Export fixture' })
    const destination = path.join(root, 'exports', 'fixture.agent-stack-package.json')

    const result = await core.exportProjectPackage(root, destination)
    expect(result).toMatchObject({
      status: 'exported',
      path: destination,
      projectRevision: 0,
      componentCount: 0,
      versionCount: 0,
    })
    const exported = verifyAgentStackPackage(JSON.parse(await readFile(destination, 'utf8')))
    expect(exported.contentHash).toBe(result.status === 'exported' ? result.packageHash : '')
    expect((await stat(destination)).mode & 0o777).toBe(0o600)
    expect(JSON.stringify(exported)).not.toContain('keychainLocator')
    expect(JSON.stringify(exported)).not.toContain('secretValue')

    await expect(
      core.exportProjectPackage(root, path.join(root, '.agent-stack')),
    ).rejects.toMatchObject({
      code: 'PACKAGE_DESTINATION_INVALID',
    } satisfies Partial<StudioCoreError>)
  })

  it('rejects absolute paths, file URLs, URL credentials, and query parameters', async () => {
    expect(
      findUnsafePortableReferences({
        absolute: '/Users/tester/private',
        windows: 'C:\\Users\\tester\\private',
        home: '~/private',
        file: 'file:///tmp/private',
        credential: 'https://token:secret@example.test/repository.git',
        query: 'https://example.test/repository.git?token=secret',
        safe: ['relative/manifest.json', 'git@github.com:owner/repository.git'],
      }),
    ).toEqual([
      { path: 'absolute', reason: 'absolute-path' },
      { path: 'windows', reason: 'absolute-path' },
      { path: 'home', reason: 'absolute-path' },
      { path: 'file', reason: 'file-url' },
      { path: 'credential', reason: 'credentialed-url' },
      { path: 'query', reason: 'query-url' },
    ])

    const root = await temporaryDirectory()
    const core = new StudioCore()
    const { project } = await core.initProject(root, {
      name: 'Unsafe fixture',
      description: '/Users/tester/private',
    })
    expect(() => buildAgentStackPackage(project)).toThrow('已拒绝导出')
    try {
      buildAgentStackPackage(project)
    } catch (error) {
      expect(error).toMatchObject({
        code: 'PACKAGE_UNSAFE',
        details: { unsafeReferences: [{ path: 'description', reason: 'absolute-path' }] },
      } satisfies Partial<StudioCoreError>)
    }
  })
})
