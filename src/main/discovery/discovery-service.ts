import { createSourceHandoff, type SourceDiscoveryProvider } from '../../core/source-discovery'
import type {
  DiscoveredRepository,
  SourceHandoff,
  SourceHandoffInput,
  SourceLocatorInput,
  SourceSearchInput,
  SourceSearchResult,
} from '../../shared/source-discovery'

export class DiscoveryService {
  readonly #provider: SourceDiscoveryProvider
  readonly #now: () => Date
  #active: AbortController | null = null

  constructor(options: { provider: SourceDiscoveryProvider; now?: () => Date }) {
    this.#provider = options.provider
    this.#now = options.now ?? (() => new Date())
  }

  search(input: SourceSearchInput): Promise<SourceSearchResult> {
    return this.#run((signal) => this.#provider.search(input, signal))
  }

  inspect(input: SourceLocatorInput): Promise<DiscoveredRepository> {
    return this.#run((signal) => this.#provider.inspect(input, signal))
  }

  handoff(input: SourceHandoffInput): Promise<SourceHandoff> {
    return this.#run(async (signal) => {
      const repository = await this.#provider.inspect(input, signal)
      return createSourceHandoff(repository, input.destination, this.#now)
    })
  }

  cancel(): boolean {
    if (!this.#active) return false
    this.#active.abort()
    this.#active = null
    return true
  }

  close(): void {
    this.cancel()
  }

  async #run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.cancel()
    const controller = new AbortController()
    this.#active = controller
    try {
      return await operation(controller.signal)
    } finally {
      if (this.#active === controller) this.#active = null
    }
  }
}
