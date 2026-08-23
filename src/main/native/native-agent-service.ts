import type { NativeAgentCore } from '../../core/native-agent-core'
import type {
  NativeAgentResult,
  NativeAgentUiExecuteInput,
  NativeAgentUiListInput,
} from '../../shared/native-agent'
import { StudioCoreError } from '../../core/project-errors'
import type { StudioProjectService } from '../projects/studio-project-service'

export class NativeAgentService {
  readonly #core: NativeAgentCore
  readonly #projects: StudioProjectService

  constructor(options: { core: NativeAgentCore; projects: StudioProjectService }) {
    this.#core = options.core
    this.#projects = options.projects
  }

  probes() {
    return this.#core.probes()
  }

  async execute(
    input: NativeAgentUiExecuteInput,
    signal?: AbortSignal,
  ): Promise<NativeAgentResult> {
    const state = await this.#projects.current()
    if (!state.projectPath) throw new StudioCoreError('PROJECT_NOT_FOUND', '请先打开 Studio 项目。')
    return this.#core.execute({ ...input, projectPath: state.projectPath }, { signal })
  }

  async list(input: NativeAgentUiListInput): Promise<NativeAgentResult[]> {
    const state = await this.#projects.current()
    if (!state.projectPath) return []
    return this.#core.list(state.projectPath, input.kind)
  }

  cancel(requestId: string): boolean {
    return this.#core.cancel(requestId)
  }
}
