import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createCodexSimulationServer } from './codex-openai-simulation.mjs'

const execute = promisify(execFile)
const repositoryRoot = process.cwd()
const cliPath = path.join(repositoryRoot, 'dist/cli/studio.mjs')

async function cli(args, environment) {
  const { stdout } = await execute(process.execPath, [cliPath, ...args, '--json'], {
    cwd: repositoryRoot,
    env: environment,
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  const payload = JSON.parse(stdout)
  if (!payload.ok) throw new Error(`Studio CLI failed: ${payload.error?.code ?? 'UNKNOWN'}`)
  return payload
}

async function version(executable) {
  const { stdout } = await execute(executable, ['--version'], {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

async function verifyHarness(harness, projectRoot, environment) {
  await cli(
    ['agent', 'create', projectRoot, '--name', `${harness} simulation acceptance`],
    environment,
  )
  await cli(['harness', 'select', harness, '--project', projectRoot], environment)
  const expectedRun = `${harness.toUpperCase()}_CODEX_SIMULATION_RUN_OK`
  const expectedChat = `${harness.toUpperCase()}_CODEX_SIMULATION_CHAT_OK`
  const run = await cli(
    [
      'run',
      '--project',
      projectRoot,
      '--message',
      `Reply exactly: ${expectedRun}`,
      '--timeout-ms',
      '240000',
      '--idempotency-key',
      `${harness}-codex-simulation-run-v1`,
      '--non-interactive',
    ],
    environment,
  )
  const chat = await cli(
    [
      'chat',
      'send',
      '--project',
      projectRoot,
      '--message',
      `Reply exactly: ${expectedChat}`,
      '--timeout-ms',
      '240000',
    ],
    environment,
  )
  for (const [kind, payload, expected] of [
    ['run', run, expectedRun],
    ['chat', chat, expectedChat],
  ]) {
    if (
      payload.data?.status !== 'succeeded' ||
      payload.data?.responseMarkdown.trim() !== expected
    ) {
      throw new Error(`${harness} ${kind} did not return the fixed acceptance marker.`)
    }
    if (payload.data?.modelLayer?.kind !== 'codex-simulation') {
      throw new Error(`${harness} ${kind} was not explicitly labeled as Codex simulation.`)
    }
  }
  return [run.data, chat.data].map((result) => ({
    kind: result.kind,
    status: result.status,
    harness: result.harness,
    harnessVersion: result.harnessVersion,
    projectRevision: result.projectRevision,
    projectHash: result.projectHash,
    modelLayer: result.modelLayer,
    expectedMarkerMatched: true,
    simulationBoundaryDeclared: result.degradedFeatures.some((item) => item.includes('不计作')),
  }))
}

async function main() {
  const simulation = await createCodexSimulationServer()
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'studio-codex-harness-e2e-'))
  try {
    const details = await simulation.listen()
    const environment = {
      ...process.env,
      STUDIO_CODEX_SIMULATION: '1',
      STUDIO_CODEX_SIMULATION_URL: details.endpoint,
    }
    const toolVersions = {
      pi: await version('pi'),
      openclaw: await version('openclaw'),
      codex: await version('codex'),
    }
    const results = []
    for (const harness of ['pi', 'openclaw']) {
      results.push(
        ...(await verifyHarness(harness, path.join(tempRoot, `${harness}-project`), environment)),
      )
    }
    const evidence = {
      contractVersion: 1,
      generatedAt: new Date().toISOString(),
      mode: 'codex-simulation-test-only',
      endpoint: 'loopback-redacted',
      toolVersions,
      results,
      privacy: {
        containsLocalPaths: false,
        containsCredentials: false,
        containsPromptsOrResponses: false,
      },
    }
    const artifactDirectory = path.join(repositoryRoot, 'artifacts')
    await mkdir(artifactDirectory, { recursive: true })
    await writeFile(
      path.join(artifactDirectory, 'codex-simulated-harness-evidence.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    process.stdout.write('CODEX_SIMULATED_HARNESS_E2E VERIFIED (pi run/chat, openclaw run/chat)\n')
  } finally {
    await simulation.close().catch(() => undefined)
    await rm(tempRoot, { recursive: true, force: true })
  }
}

void main()
