import { describe, expect, it } from 'vitest'
import type { DiscoveredRepository } from '../shared/source-discovery'
import { createSourceHandoff } from './source-discovery'

describe('source discovery handoff', () => {
  it('creates structured review-required commands without executing them', () => {
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

    const handoff = createSourceHandoff(
      repository,
      'checked/component',
      () => new Date('2026-08-20T09:00:00.000Z'),
    )

    expect(handoff).toMatchObject({
      formatVersion: 1,
      destination: 'checked/component',
      commands: [
        {
          executable: 'git',
          args: [
            'clone',
            '--filter=blob:none',
            '--',
            'https://github.com/fixture/component.git',
            'checked/component',
          ],
          requiresReview: true,
        },
        { executable: 'studio', requiresReview: true },
      ],
      createdAt: '2026-08-20T09:00:00.000Z',
    })
  })
})
