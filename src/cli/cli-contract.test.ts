import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StudioCoreError } from '../core/project-errors'
import type { StudioProject } from '../core/project-model'
import type { SourceDiscoveryProvider } from '../core/source-discovery'
import type { DiscoveredRepository } from '../shared/source-discovery'
import type { KeychainAdapter } from '../adapters/keychain/macos-keychain-adapter'
import { executeCliCommand, parseArguments } from './studio'
import { verifyAgentStackPackage } from '../core/agent-stack-package'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(tmpdir(), 'studio-cli-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((entry) => rm(entry, { recursive: true, force: true })))
})

describe('studio CLI contract', () => {
  it('exports a verified portable project package and requires an explicit destination', async () => {
    const projectRoot = await root()
    const output = path.join(projectRoot, 'exports', 'fixture.agent-stack-package.json')
    await executeCliCommand(
      parseArguments(['project', 'init', projectRoot, '--name', 'CLI export fixture']),
    )

    const exported = await executeCliCommand(
      parseArguments(['project', 'export', '--project', projectRoot, '--output', output, '--json']),
    )
    expect(exported).toMatchObject({
      command: 'project export',
      data: { status: 'exported', path: output, projectRevision: 0 },
    })
    expect(verifyAgentStackPackage(JSON.parse(await readFile(output, 'utf8')))).toMatchObject({
      project: { name: 'CLI export fixture' },
    })
    await expect(
      executeCliCommand(parseArguments(['project', 'export', '--project', projectRoot])),
    ).rejects.toMatchObject({ code: 'USAGE_ERROR' } satisfies Partial<StudioCoreError>)
  })

  it('provisions Keychain values through stdin without returning the secret', async () => {
    const values = new Map<string, string>()
    const set = vi.fn<KeychainAdapter['set']>(({ service, account }, value) => {
      values.set(`${service}:${account}`, value)
      return Promise.resolve()
    })
    const has = vi.fn<KeychainAdapter['has']>(({ service, account }) =>
      Promise.resolve(values.has(`${service}:${account}`)),
    )
    const get = vi.fn<KeychainAdapter['get']>(({ service, account }) =>
      Promise.resolve(values.get(`${service}:${account}`) ?? null),
    )
    const remove = vi.fn<KeychainAdapter['delete']>(({ service, account }) =>
      Promise.resolve(values.delete(`${service}:${account}`)),
    )
    const keychain: KeychainAdapter = {
      set,
      has,
      get,
      delete: remove,
    }
    const configured = await executeCliCommand(
      parseArguments(['secret', 'set', 'openai-api', '--stdin', '--json']),
      { keychain, readSecretInput: () => Promise.resolve('private-value') },
    )
    expect(configured).toMatchObject({
      command: 'secret set',
      data: { service: 'studio.agentstack.desktop', account: 'openai-api', configured: true },
    })
    expect(JSON.stringify(configured)).not.toContain('private-value')
    await expect(
      executeCliCommand(parseArguments(['secret', 'status', 'openai-api']), { keychain }),
    ).resolves.toMatchObject({ data: { configured: true } })
    await expect(
      executeCliCommand(parseArguments(['secret', 'delete', 'openai-api']), { keychain }),
    ).resolves.toMatchObject({ data: { deleted: true } })
    await expect(
      executeCliCommand(parseArguments(['secret', 'set', 'openai-api']), { keychain }),
    ).rejects.toMatchObject({ code: 'USAGE_ERROR' })
    await expect(
      executeCliCommand(parseArguments(['secret', 'set', 'openai-api', '--stdin']), {
        keychain,
        readSecretInput: () => Promise.resolve('two\nlines'),
      }),
    ).rejects.toMatchObject({ code: 'USAGE_ERROR' })
  })

  it('searches, inspects, and creates a non-executing source handoff through a provider', async () => {
    const repository: DiscoveredRepository = {
      provider: 'github',
      sourceId: '42',
      owner: 'fixture',
      name: 'agent-component',
      fullName: 'fixture/agent-component',
      description: 'Public fixture',
      htmlUrl: 'https://github.com/fixture/agent-component',
      cloneUrl: 'https://github.com/fixture/agent-component.git',
      defaultBranch: 'main',
      licenseSpdx: 'MIT',
      language: 'TypeScript',
      topics: ['agent'],
      stars: 12,
      forks: 2,
      openIssues: 0,
      archived: false,
      disabled: false,
      fork: false,
      pushedAt: '2026-08-19T08:00:00.000Z',
      updatedAt: '2026-08-19T08:00:00.000Z',
      metadataLevel: 'provider-reported',
    }
    const search = vi.fn().mockResolvedValue({
      provider: 'github',
      query: 'agent',
      totalCount: 1,
      incompleteResults: false,
      items: [repository],
      page: 1,
      perPage: 10,
      cacheHit: false,
      rateLimit: { limit: 10, remaining: 9, resetAt: null, resource: 'search' },
    })
    const inspect = vi.fn().mockResolvedValue(repository)
    const discovery: SourceDiscoveryProvider = {
      id: 'github',
      search,
      inspect,
    }

    const searched = await executeCliCommand(parseArguments(['source', 'search', 'agent']), {
      discovery,
    })
    expect(searched).toMatchObject({
      command: 'source search',
      data: { items: [{ fullName: 'fixture/agent-component' }] },
    })
    const inspected = await executeCliCommand(
      parseArguments(['source', 'inspect', 'fixture/agent-component']),
      { discovery },
    )
    expect(inspected.suggestedActions[0]?.command).toContain('source handoff')
    const handedOff = await executeCliCommand(
      parseArguments([
        'source',
        'handoff',
        'fixture/agent-component',
        '--destination',
        '/tmp/component',
      ]),
      { discovery, now: () => new Date('2026-08-20T08:00:00.000Z') },
    )
    expect(handedOff.data).toMatchObject({
      destination: '/tmp/component',
      commands: [
        { executable: 'git', purpose: 'clone', requiresReview: true },
        { executable: 'studio', purpose: 'inspect', requiresReview: true },
      ],
    })
    expect(search).toHaveBeenCalledTimes(1)
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  it('supports project, component, stack, owner, validate, freeze, and version commands idempotently', async () => {
    const projectRoot = await root()
    const run = (args: string[]) =>
      executeCliCommand(
        parseArguments([...args, '--project', projectRoot, '--json', '--non-interactive']),
      )
    const initialized = await run(['project', 'init', projectRoot, '--name', 'CLI fixture'])
    expect(initialized.command).toBe('project init')
    expect(
      await run(['component', 'inspect', path.resolve('src/test/fixtures/m7/harness-x')]),
    ).toMatchObject({ command: 'component inspect' })
    await run(['component', 'import', path.resolve('src/test/fixtures/m7/harness-x')])
    await run(['component', 'import', path.resolve('src/test/fixtures/m7/research-y')])
    const inspected = await run(['project', 'inspect'])
    const project = (inspected.data as { project: StudioProject }).project
    const x = project.components.find(({ descriptor }) => descriptor.id === 'fixture.harness-x')!
    const y = project.components.find(({ descriptor }) => descriptor.id === 'fixture.research-y')!
    await run(['stack', 'add', x.id])
    await run(['stack', 'add', y.id])
    await run(['stack', 'owner', 'set', 'prompt-policy', x.id])
    await run(['stack', 'owner', 'set', 'context-builder', y.id])
    const validated = await run(['stack', 'validate'])
    expect((validated.data as { validation: { status: string } }).validation.status).toBe('ready')
    const frozen = await run(['version', 'create'])
    expect((frozen.data as { reused: boolean }).reused).toBe(false)
    expect((await run(['stack', 'freeze'])).data).toMatchObject({ reused: true })
    expect((await run(['version', 'list'])).data).toMatchObject({
      versions: [{ versionNumber: 1 }],
    })
    expect((await run(['version', 'inspect', '1'])).data).toMatchObject({ versionNumber: 1 })
    const repeatedAdd = (await run(['stack', 'add', x.id])).data as {
      project: { revision: unknown }
    }
    expect(typeof repeatedAdd.project.revision).toBe('number')

    await run(['component', 'import', path.resolve('src/test/fixtures/m7/detected')])
    const afterDetected = (await run(['project', 'inspect'])).data as { project: StudioProject }
    const detected = afterDetected.project.components.find(({ descriptor }) =>
      descriptor.id.includes('detected'),
    )!
    await run([
      'component',
      'update',
      detected.id,
      '--descriptor',
      path.resolve('src/test/fixtures/m7/detected/fixed-descriptor.json'),
    ])
    await run(['component', 'archive', detected.id])
    await run(['component', 'delete', detected.id])

    await run(['component', 'import', path.resolve('src/test/fixtures/m22/legacy-adapter')])
    const afterAdapter = (await run(['project', 'inspect'])).data as { project: StudioProject }
    const adapter = afterAdapter.project.components.find(
      ({ descriptor }) => descriptor.id === 'fixture.legacy-memory-adapter',
    )!
    await run(['stack', 'add', adapter.id])
    const adapterValidation = await run(['project', 'validate'])
    expect(adapterValidation).toMatchObject({
      data: {
        validation: {
          status: 'blocked',
          remediationTasks: [
            { kind: 'adapter-work', status: 'complete' },
            { kind: 'contract-test', status: 'complete' },
            { kind: 'runtime-validation', status: 'required' },
          ],
        },
      },
    })
    expect(
      adapterValidation.suggestedActions.some(({ description }) =>
        description.includes('最小运行验证'),
      ),
    ).toBe(true)
    await run(['stack', 'remove', adapter.id])
    await run(['component', 'delete', adapter.id])

    const audited = await run(['project', 'audit'])
    expect(audited).toMatchObject({
      command: 'project audit',
      data: { integrity: { status: 'verified', algorithm: 'sha256', versionsChecked: 1 } },
    })
    const projectPath = path.join(projectRoot, '.agent-stack')
    const tampered = JSON.parse(await readFile(projectPath, 'utf8')) as {
      versions: Array<{ snapshot: { project: { name: string } } }>
    }
    tampered.versions[0].snapshot.project.name = 'Tampered from editor'
    await writeFile(projectPath, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8')
    let auditFailure: unknown
    try {
      await run(['project', 'audit'])
    } catch (error) {
      auditFailure = error
    }
    expect(auditFailure).toBeInstanceOf(Error)
    const knownFailure = auditFailure as StudioCoreError
    expect(knownFailure.code).toBe('PROJECT_INTEGRITY_FAILED')
    expect(knownFailure.suggestedActions.map(({ command }) => command)).toContain(
      'studio project audit --json',
    )
  }, 15_000)

  it('returns stable machine errors with structured suggested actions', async () => {
    const projectRoot = await root()
    await executeCliCommand(parseArguments(['project', 'init', projectRoot]))
    await executeCliCommand(
      parseArguments([
        'component',
        'import',
        path.resolve('src/test/fixtures/m7/harness-x'),
        '--project',
        projectRoot,
      ]),
    )
    await expect(
      executeCliCommand(
        parseArguments([
          'component',
          'import',
          path.resolve('src/test/fixtures/m7/research-y'),
          '--project',
          projectRoot,
          '--revision',
          '0',
        ]),
      ),
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      suggestedActions: [{ command: 'studio project inspect --json' }],
    })

    await expect(
      executeCliCommand(
        parseArguments(['component', 'delete', randomUUID(), '--project', projectRoot]),
      ),
    ).rejects.toMatchObject({ code: 'COMPONENT_NOT_FOUND' } satisfies Partial<StudioCoreError>)
    await expect(executeCliCommand(parseArguments(['unknown', 'command']))).rejects.toMatchObject({
      code: 'USAGE_ERROR',
      suggestedActions: [{ command: 'studio help' }],
    })
    await expect(
      executeCliCommand(parseArguments(['source', 'search', 'x'])),
    ).rejects.toMatchObject({
      code: 'DISCOVERY_QUERY_INVALID',
      suggestedActions: [{ description: '补充能力、框架或仓库关键词。' }],
    })
  }, 15_000)

  it('uses Studio Core for the complete versioned Workflow CLI contract', async () => {
    const projectRoot = await root()
    const run = (args: string[]) =>
      executeCliCommand(parseArguments([...args, '--project', projectRoot, '--json']))
    await run(['project', 'init', projectRoot, '--name', 'Workflow CLI'])
    await run(['workflow', 'create', '--name', 'CLI DAG'])
    const listed = await run(['workflow', 'list'])
    const workflow = (listed.data as { workflows: StudioProject['workflows'] }).workflows[0]
    await run([
      'workflow',
      'node-add',
      workflow.id,
      '--kind',
      'operation',
      '--name',
      '准备',
      '--ref',
      'prepare',
    ])
    await run([
      'workflow',
      'node-add',
      workflow.id,
      '--kind',
      'agent-version',
      '--name',
      '执行',
      '--ref',
      randomUUID(),
    ])
    const inspected = await run(['workflow', 'inspect', workflow.id])
    const nodes = (inspected.data as StudioProject['workflows'][number]).nodes
    await run(['workflow', 'edge-add', workflow.id, nodes[0].id, nodes[1].id])
    await expect(
      run(['workflow', 'edge-add', workflow.id, nodes[1].id, nodes[0].id]),
    ).rejects.toMatchObject({ code: 'WORKFLOW_CYCLE' })
    const frozen = await run(['workflow', 'freeze', workflow.id])
    expect(frozen.data).toMatchObject({ reused: false, version: { versionNumber: 1 } })
    expect((await run(['workflow', 'freeze', workflow.id])).data).toMatchObject({ reused: true })
  })
})
