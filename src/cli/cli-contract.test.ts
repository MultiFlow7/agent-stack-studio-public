import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StudioCoreError } from '../core/project-errors'
import type { ProjectComponent, StudioProject } from '../core/project-model'
import type { SourceDiscoveryProvider } from '../core/source-discovery'
import type { DiscoveredRepository } from '../shared/source-discovery'
import type { KeychainAdapter } from '../adapters/keychain/macos-keychain-adapter'
import { executeCliCommand, parseArguments, type CliDependencies } from './studio'
import { verifyAgentStackPackage } from '../core/agent-stack-package'
import type { NativeAgentCore } from '../core/native-agent-core'
import type { StudioDoctorFacts } from '../shared/doctor'

const roots: string[] = []

function doctorFacts(): StudioDoctorFacts {
  return {
    application: {
      version: '0.9.0',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: true,
      cliExecutable: true,
      bundledCliRuntime: true,
    },
    data: null,
    project: {
      status: 'healthy',
      name: 'M32 product CLI',
      revision: 2,
      formatVersion: 2,
      versionsChecked: 0,
      message: '项目事实和内容哈希已验证。',
    },
    harnesses: ['pi', 'openclaw', 'codex'].map((id) => ({
      id: id as 'pi' | 'openclaw' | 'codex',
      label: id,
      executable: id,
      status: 'ready' as const,
      version: '1.0.0',
      requiredVersion: '1.0.0',
      capabilities: {
        prompt: 'native' as const,
        skills: 'native' as const,
        memory: 'native' as const,
        mcp: 'native' as const,
        sessions: 'native' as const,
      },
      detail: `${id} 可用。`,
    })),
    multica: {
      status: 'not-installed',
      runtimeCount: 0,
      onlineRuntimeCount: 0,
      message: '未找到 Multica CLI。',
    },
  }
}

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(tmpdir(), 'studio-cli-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((entry) => rm(entry, { recursive: true, force: true })))
})

describe('studio CLI contract', () => {
  it('statically recognizes known sources and writes complete unknown-source tasks', async () => {
    const outputRoot = await root()
    const inspected = await executeCliCommand(
      parseArguments([
        'customize',
        'inspect',
        'https://github.com/anthropics/skills',
        '--harness',
        'openclaw',
        '--json',
      ]),
    )
    expect(inspected).toMatchObject({
      command: 'customize inspect',
      data: {
        status: 'known',
        recipe: {
          id: 'anthropic-algorithmic-art',
          executionPolicy: 'content-only',
        },
      },
    })

    const unknown = path.join(outputRoot, 'unknown-source')
    const output = path.join(outputRoot, 'handoffs', 'unknown.md')
    await mkdir(unknown)
    await writeFile(path.join(unknown, 'package.json'), '{"name":"unknown-source"}\n')
    const task = await executeCliCommand(
      parseArguments([
        'customize',
        'task',
        unknown,
        '--harness',
        'pi',
        '--project',
        outputRoot,
        '--output',
        output,
        '--json',
      ]),
    )
    expect(task).toMatchObject({
      command: 'customize task',
      data: { outputPath: output, recognition: { status: 'unknown' } },
    })
    const markdown = await readFile(output, 'utf8')
    expect(markdown).toContain('## 强制安全边界')
    expect(markdown).toContain('## 能力映射待办')
    expect(markdown).toContain('## 验收条件')

    await expect(
      executeCliCommand(
        parseArguments([
          'customize',
          'install',
          'anthropic-algorithmic-art',
          '--harness',
          'openclaw',
          '--project',
          outputRoot,
          '--revision',
          '0',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'USAGE_ERROR' })
  })

  it('routes component lifecycle commands through one customization service', async () => {
    const projectPath = await root()
    const check = vi.fn().mockResolvedValue([])
    const install = vi.fn().mockResolvedValue({ status: 'reused', operation: 'update' })
    const smoke = vi.fn().mockResolvedValue({ status: 'passed' })
    const uninstall = vi.fn().mockResolvedValue({ status: 'uninstalled' })
    const restore = vi.fn().mockResolvedValue({ status: 'restored' })
    const customization = {
      recognize: vi.fn(),
      task: vi.fn(),
      install,
      check,
      smoke,
      uninstall,
      restore,
      cancel: vi.fn(),
    } as unknown as NonNullable<CliDependencies['customization']>

    const listed = await executeCliCommand(
      parseArguments(['customize', 'list', '--harness', 'codex', '--json']),
      { customization },
    )
    expect(
      (listed.data as { recipes: Array<{ id: string }> }).recipes.map(({ id }) => id),
    ).toContain('anthropic-brand-guidelines')
    await executeCliCommand(
      parseArguments(['customize', 'check', '--harness', 'codex', '--project', projectPath]),
      { customization },
    )
    await executeCliCommand(
      parseArguments([
        'customize',
        'update',
        'anthropic-brand-guidelines',
        '--harness',
        'codex',
        '--project',
        projectPath,
        '--revision',
        '4',
        '--confirm',
      ]),
      { customization },
    )
    await executeCliCommand(
      parseArguments([
        'customize',
        'smoke',
        'anthropic-brand-guidelines',
        '--harness',
        'codex',
        '--project',
        projectPath,
      ]),
      { customization },
    )
    await executeCliCommand(
      parseArguments([
        'customize',
        'uninstall',
        'anthropic-brand-guidelines',
        '--harness',
        'codex',
        '--project',
        projectPath,
        '--revision',
        '4',
        '--confirm',
      ]),
      { customization },
    )
    await executeCliCommand(
      parseArguments([
        'customize',
        'restore',
        '30000000-0000-4000-8000-000000000003',
        '--project',
        projectPath,
        '--revision',
        '5',
        '--confirm',
      ]),
      { customization },
    )

    expect(check).toHaveBeenCalledWith({ projectPath, harnessId: 'codex' })
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ operation: 'update' }))
    expect(smoke).toHaveBeenCalledWith(
      expect.objectContaining({ recipeId: 'anthropic-brand-guidelines' }),
    )
    expect(uninstall).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4 }))
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 5 }))
  })

  it('routes Multica publish commands through the injected shared service and requires confirmation', async () => {
    const projectRoot = await root()
    const runtimeId = '50000000-0000-4000-8000-000000000001'
    const remoteAgentId = '60000000-0000-4000-8000-000000000001'
    await executeCliCommand(
      parseArguments(['agent', 'create', projectRoot, '--name', 'M34 publish CLI']),
    )
    await executeCliCommand(
      parseArguments(['harness', 'select', 'openclaw', '--project', projectRoot]),
    )
    const frozen = await executeCliCommand(
      parseArguments(['stack', 'freeze', '--project', projectRoot]),
    )
    const frozenData = frozen.data as {
      version: { id: string }
      result: { project: { id: string } }
    }
    const version = frozenData.version
    const projectId = frozenData.result.project.id
    const preview = {
      target: { id: 'studio://publishers/multica-cli' },
      package: { contentHash: 'b'.repeat(64) },
      validation: { status: 'ready', issues: [], checkedAt: '2026-08-23T00:00:00.000Z' },
      priorReceipt: null,
    }
    const publishing = {
      runtimes: vi.fn().mockResolvedValue([
        {
          id: runtimeId,
          label: 'OpenClaw local',
          provider: 'openclaw',
          status: 'online',
        },
      ]),
      preview: vi.fn().mockResolvedValue(preview),
      publish: vi.fn().mockResolvedValue({
        reused: false,
        receipt: { status: 'succeeded', remoteAgentId },
      }),
      status: vi.fn().mockResolvedValue({ state: 'in-sync' }),
      history: vi.fn().mockReturnValue({ receipts: [], mapping: null }),
    } as unknown as NonNullable<CliDependencies['publishing']>
    const dependencies = { publishing } satisfies CliDependencies

    await expect(
      executeCliCommand(parseArguments(['publish', 'runtimes', '--json']), dependencies),
    ).resolves.toMatchObject({ data: { runtimes: [{ id: runtimeId }] } })
    const validated = await executeCliCommand(
      parseArguments([
        'publish',
        'validate',
        '--project',
        projectRoot,
        '--version',
        version.id,
        '--runtime-id',
        runtimeId,
        '--json',
      ]),
      dependencies,
    )
    expect(validated.data).toBe(preview)
    expect(publishing.preview).toHaveBeenCalledWith({
      targetId: 'studio://publishers/multica-cli',
      agentId: projectId,
      agentVersionId: version.id,
      runtimeId,
    })
    await expect(
      executeCliCommand(
        parseArguments(['publish', 'publish', '--project', projectRoot, '--version', version.id]),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'USAGE_ERROR' })
    await expect(
      executeCliCommand(
        parseArguments([
          'publish',
          'publish',
          '--project',
          projectRoot,
          '--version',
          version.id,
          '--runtime-id',
          runtimeId,
          '--confirm',
        ]),
        dependencies,
      ),
    ).resolves.toMatchObject({ data: { receipt: { remoteAgentId } } })
    expect(publishing.publish).toHaveBeenCalledWith({
      targetId: 'studio://publishers/multica-cli',
      agentId: projectId,
      agentVersionId: version.id,
      runtimeId,
      confirmed: true,
    })
  })

  it('maps Multica Runtime transport failures to the stable CLI exit-code domain', async () => {
    const publishing = {
      runtimes: vi.fn().mockRejectedValue(new Error('private transport detail')),
      preview: vi.fn(),
      publish: vi.fn(),
      status: vi.fn(),
      history: vi.fn(),
    } as unknown as NonNullable<CliDependencies['publishing']>

    await expect(
      executeCliCommand(parseArguments(['publish', 'runtimes', '--json']), { publishing }),
    ).rejects.toMatchObject({
      code: 'MULTICA_CLI_UNAVAILABLE',
      message: 'Multica Runtime 查询失败或超时；未执行远端写入。',
    })
  })

  it('routes M32 product commands through the same Core and reports legacy aliases', async () => {
    const projectRoot = await root()
    await expect(
      executeCliCommand(
        parseArguments([
          'agent',
          'create',
          path.join(projectRoot, 'old-mode'),
          '--execution-mode',
          'hybrid',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'USAGE_ERROR' })
    const legacy = await executeCliCommand(
      parseArguments(['project', 'init', projectRoot, '--name', 'M32 product CLI']),
    )
    expect(legacy).toMatchObject({
      command: 'project init',
      notices: [
        {
          code: 'DEPRECATED_COMMAND',
          replacement: 'studio agent create',
        },
      ],
    })
    expect(legacy.data).toMatchObject({ project: { stack: { executionMode: 'external-harness' } } })

    const inspected = await executeCliCommand(
      parseArguments(['agent', 'inspect', '--project', projectRoot, '--json']),
    )
    expect(inspected).toMatchObject({
      command: 'agent inspect',
      data: { project: { name: 'M32 product CLI' } },
    })
    expect(inspected.notices).toBeUndefined()

    await executeCliCommand(
      parseArguments([
        'harness',
        'import',
        path.resolve('src/test/fixtures/m7/harness-x'),
        '--project',
        projectRoot,
      ]),
    )
    await executeCliCommand(
      parseArguments([
        'component',
        'import',
        path.resolve('src/test/fixtures/m7/research-y'),
        '--project',
        projectRoot,
      ]),
    )
    const harnesses = await executeCliCommand(
      parseArguments(['harness', 'list', '--project', projectRoot]),
      {
        nativeAgent: {
          probes: () => Promise.resolve([]),
        } as unknown as NativeAgentCore,
      },
    )
    expect(harnesses).toMatchObject({
      command: 'harness list',
      data: { components: [{ descriptor: { id: 'fixture.harness-x' } }] },
    })
    expect(
      (harnesses.data as { components: ProjectComponent[] }).components.some(
        ({ descriptor }) => descriptor.id === 'fixture.research-y',
      ),
    ).toBe(false)

    const harness = (harnesses.data as { components: ProjectComponent[] }).components[0]
    expect(harness).toBeDefined()
    if (!harness) throw new Error('Harness fixture missing from filtered product list.')
    await expect(
      executeCliCommand(
        parseArguments(['harness', 'select', harness.id, '--project', projectRoot]),
      ),
    ).resolves.toMatchObject({ command: 'harness select' })
    await expect(
      executeCliCommand(parseArguments(['doctor', '--project', projectRoot]), {
        doctorFacts: () => Promise.resolve(doctorFacts()),
      }),
    ).resolves.toMatchObject({
      command: 'doctor',
      data: {
        schemaVersion: 1,
        status: 'degraded',
        counts: { passed: 6, warnings: 1, blocking: 0 },
        checks: [
          { id: 'application-platform', status: 'pass' },
          { id: 'cli-distribution', status: 'pass' },
          { id: 'project-integrity', status: 'pass' },
          { id: 'harness-pi', status: 'pass' },
          { id: 'harness-openclaw', status: 'pass' },
          { id: 'harness-codex', status: 'pass' },
          { id: 'multica-publish', status: 'warning' },
        ],
      },
    })
  })

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
    expect(
      (
        (await run(['component', 'list', '--scope', 'archived'])).data as {
          components: ProjectComponent[]
        }
      ).components.map(({ id }) => id),
    ).toContain(detected.id)
    await run(['component', 'restore', detected.id])
    expect(
      (
        (await run(['component', 'list', '--scope', 'active'])).data as {
          components: ProjectComponent[]
        }
      ).components.map(({ id }) => id),
    ).toContain(detected.id)
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
    await run(['component', 'archive', adapter.id])
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
