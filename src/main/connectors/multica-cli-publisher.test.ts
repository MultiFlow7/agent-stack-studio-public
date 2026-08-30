import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  multicaCliTargetId,
  publishPackageSchema,
  publishTargetSchema,
  type PublishPackage,
} from '../../shared/publish'
import { MulticaCliPublisher } from './multica-cli-publisher'

const directories: string[] = []
const runtimeId = '70000000-0000-4000-8000-000000000001'

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const target = publishTargetSchema.parse({
  id: multicaCliTargetId,
  connector: 'multica',
  transport: 'cli',
  label: 'Multica',
  description: 'Official CLI',
  availability: 'ready',
  externalSideEffect: true,
})

function packageFixture(overrides: { command?: string } = {}): PublishPackage {
  return publishPackageSchema.parse({
    packageVersion: 1,
    source: {
      studioVersion: '0.9.0',
      localAgentId: '10000000-0000-4000-8000-000000000001',
      agentVersionId: '30000000-0000-4000-8000-000000000001',
      agentVersionNumber: 1,
      agentVersionHash: 'a'.repeat(64),
    },
    agent: {
      name: 'Studio Agent',
      description: 'Published from Studio',
      executionMode: 'external-harness',
    },
    profile: {
      instructions: 'Answer precisely.',
      memoryMarkdown: 'Remember the public product context.',
      skills: [{ id: 'review', name: 'Review', markdown: 'Review changes carefully.' }],
      mcpServers: [
        {
          id: 'docs',
          name: 'Docs',
          transport: 'stdio',
          command: overrides.command ?? 'docs-mcp',
          args: ['--safe'],
          url: null,
        },
      ],
      toolPolicy: 'read-only',
    },
    harness: { id: 'openclaw', contractId: 'studio.harness.openclaw', version: '2026.1.30' },
    stack: {
      revision: 4,
      components: [
        {
          contractId: 'studio.harness.openclaw',
          version: '2026.1.30',
          capabilities: ['execution-controller'],
          runtimeRequired: true,
        },
      ],
      capabilityOwners: [
        { capability: 'execution-controller', contractId: 'studio.harness.openclaw' },
      ],
    },
    environmentDeclarations: [],
    requirements: {
      platforms: ['darwin-arm64', 'darwin-x64'],
      cordisVersion: '4.0.0-rc.8',
      network: 'denied',
    },
    excludedContent: [
      'local-paths',
      'keychain-secrets',
      'experiment-data',
      'chat-history',
      'run-logs',
      'artifacts',
    ],
    contentHash: 'b'.repeat(64),
  })
}

async function fakeMultica(options: { authenticated?: boolean; version?: string } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-multica-cli-'))
  directories.push(directory)
  const executable = path.join(directory, 'multica')
  const statePath = path.join(directory, 'state.json')
  await writeFile(statePath, JSON.stringify({ agents: [], creates: 0, updates: 0 }), 'utf8')
  const source = `#!/usr/bin/env node
const fs = require('node:fs')
const statePath = ${JSON.stringify(statePath)}
const authenticated = ${options.authenticated !== false}
const version = ${JSON.stringify(options.version ?? '0.4.32')}
const args = process.argv.slice(2)
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
const flag = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const save = () => fs.writeFileSync(statePath, JSON.stringify(state))
const output = (value) => process.stdout.write(JSON.stringify(value))
if (args[0] === 'version') output({ version })
else if (!authenticated) { process.stderr.write("Not authenticated. Run 'multica login'."); process.exitCode = 1 }
else if (args[0] === 'runtime' && args[1] === 'list') output([{ id: ${JSON.stringify(runtimeId)}, name: 'OpenClaw on Mac', provider: 'openclaw', status: 'online' }])
else if (args[0] === 'agent' && args[1] === 'list') output(state.agents)
else if (args[0] === 'agent' && args[1] === 'get') { const found = state.agents.find((agent) => agent.id === args[2]); if (!found) { process.stderr.write('not found'); process.exitCode = 1 } else output(found) }
else if (args[0] === 'agent' && args[1] === 'create') { const agent = { id: '80000000-0000-4000-8000-000000000001', name: flag('--name'), instructions: flag('--instructions'), mcp: fs.readFileSync(0, 'utf8') }; state.agents.push(agent); state.creates += 1; save(); output(agent) }
else if (args[0] === 'agent' && args[1] === 'update') { const agent = state.agents.find((item) => item.id === args[2]); agent.name = flag('--name'); agent.instructions = flag('--instructions'); state.updates += 1; save(); output(agent) }
else { process.stderr.write('unsupported fake command'); process.exitCode = 1 }
`
  await writeFile(executable, source, { encoding: 'utf8', mode: 0o700 })
  await chmod(executable, 0o700)
  return { executable, statePath, directory }
}

describe('MulticaCliPublisher', () => {
  it('uses the official CLI JSON contract and recovers a lost create response by content hash', async () => {
    const fake = await fakeMultica()
    const publisher = new MulticaCliPublisher({ executable: fake.executable, cwd: fake.directory })
    const publishPackage = packageFixture()
    const validation = await publisher.validate(target, publishPackage, {
      remoteAgentId: null,
      runtimeId,
    })
    expect(validation.status).toBe('ready')

    const first = await publisher.publish(target, publishPackage, {
      idempotencyKey: 'c'.repeat(64),
      remoteAgentId: null,
      runtimeId,
      signal: new AbortController().signal,
    })
    const recovered = await publisher.publish(target, publishPackage, {
      idempotencyKey: 'c'.repeat(64),
      remoteAgentId: null,
      runtimeId,
      signal: new AbortController().signal,
    })
    const remote = await publisher.inspect(target, first.remoteAgentId)
    const state = JSON.parse(await readFile(fake.statePath, 'utf8')) as { creates: number }

    expect(first).toMatchObject({ testOnly: false, remoteVersionId: publishPackage.contentHash })
    expect(recovered.remoteAgentId).toBe(first.remoteAgentId)
    expect(remote?.latestRemoteVersionId).toBe(publishPackage.contentHash)
    expect(state.creates).toBe(1)
  }, 15_000)

  it('returns precise install, authentication, version, runtime, and sensitive-data blockers', async () => {
    const missing = new MulticaCliPublisher({ executable: '/definitely/missing/multica' })
    expect(
      (await missing.validate(target, packageFixture(), { remoteAgentId: null, runtimeId })).issues,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MULTICA_CLI_NOT_INSTALLED' })]),
    )

    const old = await fakeMultica({ version: '0.4.31' })
    await expect(
      new MulticaCliPublisher({ executable: old.executable, cwd: old.directory }).readiness(),
    ).resolves.toMatchObject({ status: 'unavailable', runtimeCount: 0 })
    expect(
      (
        await new MulticaCliPublisher({
          executable: old.executable,
          cwd: old.directory,
        }).validate(target, packageFixture(), { remoteAgentId: null, runtimeId })
      ).issues,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MULTICA_CLI_UNSUPPORTED' })]),
    )

    const loggedOut = await fakeMultica({ authenticated: false })
    expect(
      (
        await new MulticaCliPublisher({
          executable: loggedOut.executable,
          cwd: loggedOut.directory,
        }).validate(target, packageFixture(), { remoteAgentId: null, runtimeId })
      ).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MULTICA_AUTHENTICATION_REQUIRED' }),
      ]),
    )

    const ready = await fakeMultica()
    await expect(
      new MulticaCliPublisher({
        executable: ready.executable,
        cwd: ready.directory,
      }).readiness(),
    ).resolves.toMatchObject({ status: 'ready', runtimeCount: 1, onlineRuntimeCount: 1 })
    const unsafe = await new MulticaCliPublisher({
      executable: ready.executable,
      cwd: ready.directory,
    }).validate(
      target,
      packageFixture({ command: ['', 'Users', 'fixture', 'private-tool'].join('/') }),
      {
        remoteAgentId: null,
        runtimeId,
      },
    )
    expect(unsafe.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SENSITIVE_CONTENT' })]),
    )
  }, 15_000)
})
