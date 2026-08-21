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
  #active: { key: string; controller: AbortController; promise: Promise<unknown> } | null = null

  constructor(options: { provider: SourceDiscoveryProvider; now?: () => Date }) {
    this.#provider = options.provider
    this.#now = options.now ?? (() => new Date())
  }

  search(input: SourceSearchInput): Promise<SourceSearchResult> {
    return this.#run(`search:${JSON.stringify(input)}`, (signal) =>
      this.#provider.search(input, signal),
    )
  }

  inspect(input: SourceLocatorInput): Promise<DiscoveredRepository> {
    return this.#run(`inspect:${JSON.stringify(input)}`, (signal) =>
      this.#provider.inspect(input, signal),
    )
  }

  handoff(input: SourceHandoffInput): Promise<SourceHandoff> {
    return this.#run(`handoff:${JSON.stringify(input)}`, async (signal) => {
      const repository = await this.#provider.inspect(input, signal)
      return createSourceHandoff(repository, input.destination, this.#now)
    })
  }

  cancel(): boolean {
    if (!this.#active) return false
    this.#active.controller.abort()
    this.#active = null
    return true
  }

  close(): void {
    this.cancel()
  }

  #run<T>(key: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#active?.key === key) return this.#active.promise as Promise<T>
    this.cancel()
    const controller = new AbortController()
    const promise = operation(controller.signal).finally(() => {
      if (this.#active?.controller === controller) this.#active = null
    })
    this.#active = { key, controller, promise }
    return promise
  }
}
