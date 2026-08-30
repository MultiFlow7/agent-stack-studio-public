import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudioCore } from '../../core/studio-core'
import {
  buildAgentModelReadiness,
  modelVerificationStatusSchema,
  type HarnessModelSelection,
} from '../../shared/model-auth'
import { studioProjectStateSchema } from '../../shared/studio-project'
import type { StudioProjectService } from '../projects/studio-project-service'
import { ModelAuthController } from './model-auth-controller'
import type {
  ModelAuthGateway,
  ModelAuthProjectGateway,
  ModelAuthService,
} from './model-auth-service'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function fixture(method: 'official-login' | 'existing-login' = 'existing-login') {
  const directory = await mkdtemp(path.join(tmpdir(), 'model-auth-controller-'))
  directories.push(directory)
  const root = path.join(directory, 'project')
  const core = new StudioCore()
  await core.initProject(root, { name: 'Controller Agent' })
  const harness = await core.selectKnownHarness(root, 'openclaw')
  const selection: HarnessModelSelection = {
    harnessId: 'openclaw',
    providerId: 'openai-codex',
    modelId: 'gpt-5.1-codex',
    credentialRequirement: { method, credentialKind: 'harness-session' },
  }
  await core.updateModelConfiguration(
    root,
    {
      providerId: selection.providerId,
      modelId: selection.modelId,
      credentialRequirement: selection.credentialRequirement,
    },
    { expectedRevision: harness.project.revision },
  )
  const current: ModelAuthProjectGateway['current'] = async () => {
    const inspected = await core.inspectProject(root)
    return studioProjectStateSchema.parse({
      projectPath: inspected.path,
      localAgentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      project: inspected.project,
      validation: core.validate(inspected.project),
      integrity: inspected.integrity,
      recovered: false,
      changedExternally: false,
      cliPath: '/Applications/Agent Stack Studio.app/Contents/MacOS/studio-cli',
    })
  }
  const verification = modelVerificationStatusSchema.parse({
    state: 'not-run',
    configurationHash: null,
    checkedAt: null,
    failure: null,
  })
  const readiness = buildAgentModelReadiness({
    stackCompatible: true,
    harnessStatus: 'ready',
    configurationState: 'configured',
    configuration: {
      providerId: selection.providerId,
      modelId: selection.modelId,
      credentialRequirement: selection.credentialRequirement,
    },
    authentication: null,
    verification,
  })
  const status = vi.fn(() => Promise.resolve(readiness))
  const configure = vi.fn(() => Promise.resolve(readiness))
  const inspect = vi.fn(() => Promise.resolve(readiness))
  const select = vi.fn(() => Promise.resolve(readiness))
  const verify = vi.fn(() => Promise.resolve(readiness))
  const service = {
    status,
    configure,
    inspect,
    select,
    verify,
    // A deliberately sensitive-looking implementation detail must never enter ModelAuthView.
    localBinding: {
      bindingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      keychainAccount: 'model:project:openclaw:openai-codex',
      secretReferenceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      secret: 'opaque-controller-canary',
    },
  } as unknown as ModelAuthService
  const probe = vi.fn<Pick<ModelAuthGateway, 'probe'>['probe']>((harnessId) =>
    Promise.resolve({
      id: harnessId,
      label: 'OpenClaw',
      executable: '/opt/homebrew/bin/openclaw',
      status: 'ready',
      version: '2026.1.30',
      requiredVersion: '>=2026.1.30',
      capabilities: {
        prompt: 'native',
        skills: 'native',
        memory: 'adapted',
        mcp: 'adapted',
        sessions: 'native',
      },
      detail: '已就绪。',
    }),
  )
  const controller = new ModelAuthController({
    service,
    projects: { current } as StudioProjectService,
    gateway: { probe },
  })
  return { controller, calls: { status, configure, inspect, select, verify, probe }, selection }
}

describe('ModelAuthController', () => {
  it('projects a Renderer-safe view without local binding, locator, or secret facts', async () => {
    const { controller, selection } = await fixture()

    const view = await controller.view()

    expect(view).toMatchObject({
      harness: { id: 'openclaw', label: 'OpenClaw' },
      selection: {
        providerId: selection.providerId,
        modelId: selection.modelId,
        credentialRequirement: selection.credentialRequirement,
      },
      readiness: { state: 'unauthenticated', ready: false },
    })
    const serialized = JSON.stringify(view)
    expect(serialized).not.toMatch(/bindingId|secretReferenceId|keychainAccount/i)
    expect(serialized).not.toContain('opaque-controller-canary')
  })

  it('binds and refreshes existing-login through the Service without launching official login', async () => {
    const { controller, calls } = await fixture()
    const controllerSignal = new AbortController()

    await controller.refreshAuthentication({ signal: controllerSignal.signal })

    expect(calls.configure).toHaveBeenCalledWith({
      method: 'existing-login',
      signal: controllerSignal.signal,
    })
    expect(calls.inspect).not.toHaveBeenCalled()
    expect(calls.status).toHaveBeenCalled()
  })

  it('uses the explicit official-login path and never forwards token material', async () => {
    const { controller, calls } = await fixture('official-login')

    await controller.launchOfficialLogin()

    expect(calls.configure).toHaveBeenCalledWith({ method: 'official-login' })
    expect(JSON.stringify(calls.configure.mock.calls)).not.toMatch(/token|secret|api[-_]?key/i)
  })
})
