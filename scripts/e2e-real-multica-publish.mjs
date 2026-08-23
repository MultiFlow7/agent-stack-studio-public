import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createCodexSimulationServer } from './codex-openai-simulation.mjs'

const execute = promisify(execFile)
const repositoryRoot = process.cwd()
const cliPath = path.join(repositoryRoot, 'dist/cli/studio.mjs')

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function cli(args, environment) {
  try {
    const { stdout } = await execute(process.execPath, [cliPath, ...args, '--json'], {
      cwd: repositoryRoot,
      env: environment,
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    const payload = JSON.parse(stdout)
    if (!payload.ok) throw new Error(payload.error?.code ?? 'UNKNOWN')
    return payload
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    throw new Error(`Real Multica acceptance command failed (${code}).`)
  }
}

async function main() {
  if (process.env.STUDIO_MULTICA_REAL_ACCEPTANCE !== '1') {
    throw new Error('Set STUDIO_MULTICA_REAL_ACCEPTANCE=1 after authorizing a real remote write.')
  }
  const simulation = await createCodexSimulationServer()
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'studio-multica-e2e-'))
  const projectRoot = path.join(tempRoot, 'project')
  const dataRoot = path.join(tempRoot, 'data')
  try {
    const details = await simulation.listen()
    const environment = {
      ...process.env,
      STUDIO_CODEX_SIMULATION: '1',
      STUDIO_CODEX_SIMULATION_URL: details.endpoint,
    }
    const suffix = randomUUID().slice(0, 8)
    await cli(
      ['agent', 'create', projectRoot, '--name', `Agent Stack Studio M34 Acceptance ${suffix}`],
      environment,
    )
    await cli(['harness', 'select', 'pi', '--project', projectRoot], environment)
    const run = await cli(
      [
        'run',
        '--project',
        projectRoot,
        '--message',
        'Reply exactly: M34_LOCAL_VERIFICATION_OK',
        '--timeout-ms',
        '240000',
        '--idempotency-key',
        `m34-multica-${suffix}`,
        '--non-interactive',
      ],
      environment,
    )
    if (
      run.data?.status !== 'succeeded' ||
      run.data?.modelLayer?.kind !== 'codex-simulation' ||
      run.data?.responseMarkdown.trim() !== 'M34_LOCAL_VERIFICATION_OK'
    ) {
      throw new Error('Local Native Harness verification did not succeed.')
    }
    const frozen = await cli(['agent', 'freeze', '--project', projectRoot], environment)
    const versionId = frozen.data?.version?.id
    if (typeof versionId !== 'string') throw new Error('Frozen Version ID is missing.')
    const common = ['--project', projectRoot, '--version', versionId, '--data-dir', dataRoot]
    const runtimes = await cli(
      ['publish', 'runtimes', '--project', projectRoot, '--data-dir', dataRoot],
      environment,
    )
    const runtime = runtimes.data?.runtimes?.find(
      (candidate) => candidate.provider === 'pi' && candidate.status === 'online',
    )
    if (!runtime?.id) throw new Error('No online Pi Runtime is available.')

    const validated = await cli(
      ['publish', 'validate', ...common, '--runtime-id', runtime.id],
      environment,
    )
    if (validated.data?.validation?.status !== 'ready') {
      throw new Error('Real Multica validation is blocked.')
    }
    const publishPackage = validated.data.package
    const serializedPackage = JSON.stringify(publishPackage)
    if (
      /(?:\/Users\/|\/tmp\/|\/private\/|file:\/\/|api[_-]?key|password|token)/i.test(
        serializedPackage,
      )
    ) {
      throw new Error('Publish package contains a privacy-sensitive value.')
    }

    const first = await cli(
      ['publish', 'publish', ...common, '--runtime-id', runtime.id, '--confirm'],
      environment,
    )
    const second = await cli(
      ['publish', 'publish', ...common, '--runtime-id', runtime.id, '--confirm'],
      environment,
    )
    const status = await cli(['publish', 'status', ...common], environment)
    const firstReceipt = first.data?.receipt
    const secondReceipt = second.data?.receipt
    const remote = status.data?.remote
    if (
      firstReceipt?.status !== 'succeeded' ||
      !firstReceipt.remoteAgentId ||
      secondReceipt?.remoteAgentId !== firstReceipt.remoteAgentId ||
      second.data?.reused !== true ||
      remote?.state !== 'in-sync' ||
      remote?.remoteAgentId !== firstReceipt.remoteAgentId ||
      remote?.localContentHash !== publishPackage.contentHash ||
      remote?.remoteContentHash !== publishPackage.contentHash
    ) {
      throw new Error('Multica publish, idempotent retry, or remote hash verification failed.')
    }

    const evidence = {
      contractVersion: 1,
      generatedAt: new Date().toISOString(),
      mode: 'real-multica-cli',
      multicaVersion: '0.4.32',
      harness: { id: 'pi', version: run.data.harnessVersion },
      localVerification: {
        status: run.data.status,
        modelLayer: run.data.modelLayer,
        expectedMarkerMatched: true,
      },
      frozenVersion: { id: versionId, contentHash: publishPackage.source.agentVersionHash },
      publishPackage: {
        contentHash: publishPackage.contentHash,
        excludedContent: publishPackage.excludedContent,
        containsLocalPathsOrCredentials: false,
      },
      validation: { status: validated.data.validation.status },
      publish: {
        firstStatus: firstReceipt.status,
        firstReused: first.data.reused,
        retryStatus: secondReceipt.status,
        retryReused: second.data.reused,
        sameRemoteIdentity: true,
        remoteAgentFingerprint: fingerprint(firstReceipt.remoteAgentId),
      },
      status: {
        state: remote.state,
        localContentHash: remote.localContentHash,
        remoteContentHash: remote.remoteContentHash,
        hashesMatch: true,
      },
      privacy: {
        containsLocalPaths: false,
        containsCredentials: false,
        containsRuntimeOrWorkspaceIdentity: false,
        containsPromptsResponsesChatsOrLogs: false,
      },
    }
    const artifactDirectory = path.join(repositoryRoot, 'artifacts')
    await mkdir(artifactDirectory, { recursive: true })
    await writeFile(
      path.join(artifactDirectory, 'real-multica-publish-evidence.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    process.stdout.write('REAL_MULTICA_PUBLISH_E2E VERIFIED (validate, publish, retry, status)\n')
  } finally {
    await simulation.close().catch(() => undefined)
    await rm(tempRoot, { recursive: true, force: true })
  }
}

void main()
