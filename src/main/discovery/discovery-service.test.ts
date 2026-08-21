import { describe, expect, it, vi } from 'vitest'
import { StudioCoreError } from '../../core/project-errors'
import type { SourceDiscoveryProvider } from '../../core/source-discovery'
import type {
  DiscoveredRepository,
  SourceSearchInput,
  SourceSearchResult,
} from '../../shared/source-discovery'
import { DiscoveryService } from './discovery-service'

const repository: DiscoveredRepository = {
  provider: 'github',
  sourceId: '42',
  owner: 'fixture',
  name: 'component',
  fullName: 'fixture/component',
  description: null,
  htmlUrl: 'https://github.com/fixture/component',
  cloneUrl: 'https://github.com/fixture/component.git',
  defaultBranch: 'main',
  licenseSpdx: null,
  language: null,
  topics: [],
  stars: 0,
  forks: 0,
  openIssues: 0,
  archived: false,
  disabled: false,
  fork: false,
  pushedAt: null,
  updatedAt: '2026-08-20T08:00:00.000Z',
  metadataLevel: 'provider-reported',
}

describe('DiscoveryService', () => {
  it('creates a handoff without executing repository commands', async () => {
    const provider: SourceDiscoveryProvider = {
      id: 'github',
      search: vi.fn(),
      inspect: vi.fn().mockResolvedValue(repository),
    }
    const service = new DiscoveryService({
      provider,
      now: () => new Date('2026-08-20T09:00:00.000Z'),
    })

    await expect(
      service.handoff({ provider: 'github', locator: 'fixture/component' }),
    ).resolves.toMatchObject({
      commands: [{ purpose: 'clone' }, { purpose: 'inspect' }],
      createdAt: '2026-08-20T09:00:00.000Z',
    })
  })

  it('cancels the active provider request', async () => {
    const provider: SourceDiscoveryProvider = {
      id: 'github',
      search: vi.fn((_input: SourceSearchInput, signal?: AbortSignal) => {
        return new Promise<SourceSearchResult>((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new StudioCoreError('OPERATION_CANCELLED', 'cancelled')),
          )
        })
      }),
      inspect: vi.fn(),
    }
    const service = new DiscoveryService({ provider })
    const pending = service.search({
      provider: 'github',
      query: 'agent',
      sort: 'relevance',
      order: 'desc',
      page: 1,
      perPage: 10,
    })

    expect(service.cancel()).toBe(true)
    await expect(pending).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' })
    expect(service.cancel()).toBe(false)
  })
})
