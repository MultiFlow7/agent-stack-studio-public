import { harnessIdFromAdapter } from '../../core/known-harnesses'
import { StudioCoreError } from '../../core/project-errors'
import { harnessModelCapability, type HarnessModelSelection } from '../../shared/model-auth'
import { modelAuthViewSchema, type ModelAuthView } from '../../shared/model-auth-ipc'
import type { StudioProjectService } from '../projects/studio-project-service'
import type { ModelAuthIpcService } from '../ipc/register-model-auth-ipc'
import type { ModelAuthGateway, ModelAuthService } from './model-auth-service'

export class ModelAuthController implements ModelAuthIpcService {
  readonly #service: ModelAuthService
  readonly #projects: StudioProjectService
  readonly #gateway: Pick<ModelAuthGateway, 'probe'>

  constructor(options: {
    service: ModelAuthService
    projects: StudioProjectService
    gateway: Pick<ModelAuthGateway, 'probe'>
  }) {
    this.#service = options.service
    this.#projects = options.projects
    this.#gateway = options.gateway
  }

  async view(): Promise<ModelAuthView> {
    const state = await this.#projects.current()
    const harnessId = this.#selectedHarness(state.project)
    const readiness = await this.#service.status()
    const capability = harnessId ? harnessModelCapability(harnessId) : null
    return modelAuthViewSchema.parse({
      harness: capability ? { id: capability.harnessId, label: capability.harnessLabel } : null,
      capability,
      probe: harnessId ? await this.#gateway.probe(harnessId) : null,
      selection: state.project?.modelConfiguration ?? null,
      readiness,
    })
  }

  async select(input: Parameters<ModelAuthIpcService['select']>[0]): Promise<ModelAuthView> {
    const state = await this.#projects.current()
    const harnessId = this.#selectedHarness(state.project)
    if (!harnessId) {
      throw new StudioCoreError('HARNESS_NOT_AVAILABLE', '请先选择 Native Harness。')
    }
    const selection: HarnessModelSelection = { harnessId, ...input.modelConfiguration }
    await this.#service.select({ selection, expectedRevision: input.expectedRevision })
    return this.view()
  }

  async configureApiKey(secret: string): Promise<ModelAuthView> {
    await this.#service.configure({ method: 'api-key', secret })
    return this.view()
  }

  async launchOfficialLogin(): Promise<ModelAuthView> {
    await this.#service.configure({ method: 'official-login' })
    return this.view()
  }

  async refreshAuthentication(options: { signal?: AbortSignal } = {}): Promise<ModelAuthView> {
    const configuration = (await this.#projects.current()).project?.modelConfiguration
    if (configuration?.credentialRequirement.method === 'existing-login') {
      await this.#service.configure({
        method: 'existing-login',
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } else {
      await this.#service.inspect(options)
    }
    return this.view()
  }

  async verify(
    input: Parameters<ModelAuthIpcService['verify']>[0],
    options: { signal?: AbortSignal } = {},
  ): Promise<ModelAuthView> {
    await this.#service.verify({
      costAcknowledged: input.costAcknowledged,
      timeoutMs: input.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    })
    return this.view()
  }

  #selectedHarness(
    project: Awaited<ReturnType<StudioProjectService['current']>>['project'],
  ): HarnessModelSelection['harnessId'] | null {
    if (!project) return null
    const controller = project.stack.capabilityOwners.find(
      ({ capability }) => capability === 'execution-controller',
    )
    const descriptor = controller
      ? project.components.find(({ id }) => id === controller.componentId)?.descriptor
      : undefined
    return harnessIdFromAdapter(descriptor?.runtimeAdapter ?? null)
  }
}
