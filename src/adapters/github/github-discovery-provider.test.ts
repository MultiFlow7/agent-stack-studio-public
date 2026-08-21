import { describe, expect, it, vi } from 'vitest'
import { GithubDiscoveryProvider } from './github-discovery-provider'

const repository = {
  id: 1296269,
  name: 'Hello-World',
  full_name: 'octocat/Hello-World',
  owner: { login: 'octocat' },
  description: 'Fixture repository',
  html_url: 'https://github.com/octocat/Hello-World',
  clone_url: 'https://github.com/octocat/Hello-World.git',
  default_branch: 'main',
  license: { spdx_id: 'MIT' },
  language: 'TypeScript',
  topics: ['agent'],
  stargazers_count: 80,
  forks_count: 9,
  open_issues_count: 1,
  archived: false,
  disabled: false,
  fork: false,
  pushed_at: '2026-08-18T08:00:00.000Z',
  updated_at: '2026-08-19T08:00:00.000Z',
}

const rateHeaders = {
  etag: '"fixture"',
  'x-ratelimit-limit': '10',
  'x-ratelimit-remaining': '9',
  'x-ratelimit-reset': '1787216400',
  'x-ratelimit-resource': 'search',
}

describe('GithubDiscoveryProvider', () => {
  it('maps public metadata, sends a fixed API contract, and reuses ETag responses', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ total_count: 1, incomplete_results: false, items: [repository] }),
          { status: 200, headers: rateHeaders },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: rateHeaders }))
    const provider = new GithubDiscoveryProvider({ fetch })
    const input = {
      provider: 'github' as const,
      query: 'agent stack',
      sort: 'stars' as const,
      order: 'desc' as const,
      page: 1,
      perPage: 10,
    }

    const first = await provider.search(input)
    const second = await provider.search(input)

    expect(first).toMatchObject({
      cacheHit: false,
      items: [{ fullName: 'octocat/Hello-World', metadataLevel: 'provider-reported' }],
      rateLimit: { remaining: 9, resource: 'search' },
    })
    expect(second.cacheHit).toBe(true)
    const firstCall = fetch.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [url, init] = firstCall ?? []
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : (url?.url ?? '')
    expect(href).toContain('/search/repositories?q=agent+stack&sort=stars&order=desc')
    expect(init).toMatchObject({ method: 'GET', redirect: 'follow' })
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({ 'If-None-Match': '"fixture"' })
  })

  it('inspects only a valid GitHub owner/repo locator', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify(repository), { status: 200 }))
    const provider = new GithubDiscoveryProvider({ fetch })

    await expect(
      provider.inspect({ provider: 'github', locator: 'octocat/Hello-World' }),
    ).resolves.toMatchObject({ fullName: 'octocat/Hello-World', licenseSpdx: 'MIT' })
    await expect(
      provider.inspect({ provider: 'github', locator: 'https://example.com/owner/repo' }),
    ).rejects.toMatchObject({ code: 'DISCOVERY_QUERY_INVALID' })
  })

  it('surfaces rate limits without retrying', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: { ...rateHeaders, 'x-ratelimit-remaining': '0' },
      }),
    )
    const provider = new GithubDiscoveryProvider({ fetch })

    await expect(
      provider.search({
        provider: 'github',
        query: 'agent',
        sort: 'relevance',
        order: 'desc',
        page: 1,
        perPage: 10,
      }),
    ).rejects.toMatchObject({ code: 'DISCOVERY_RATE_LIMITED' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('distinguishes an offline network failure from a request timeout', async () => {
    const offline = new GithubDiscoveryProvider({
      fetch: vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('offline')),
    })
    const input = {
      provider: 'github' as const,
      query: 'agent',
      sort: 'relevance' as const,
      order: 'desc' as const,
      page: 1,
      perPage: 10,
    }

    await expect(offline.search(input)).rejects.toMatchObject({
      code: 'DISCOVERY_NETWORK_FAILED',
      message: '无法连接 GitHub 公开 API。',
    })

    const timeout = new GithubDiscoveryProvider({
      requestTimeoutMs: 1,
      fetch: vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('timeout')))
        })
      }),
    })
    await expect(timeout.search(input)).rejects.toMatchObject({
      code: 'DISCOVERY_TIMEOUT',
      message: 'GitHub 公开 API 在 0.001 秒内未响应。',
    })
  })

  it.each([
    [422, 'DISCOVERY_QUERY_INVALID'],
    [500, 'DISCOVERY_PROVIDER_FAILED'],
  ])('maps provider response %i to %s without retrying', async (status, code) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ message: 'fixture failure' }), { status }))
    const provider = new GithubDiscoveryProvider({ fetch })

    await expect(
      provider.search({
        provider: 'github',
        query: 'agent',
        sort: 'relevance',
        order: 'desc',
        page: 1,
        perPage: 10,
      }),
    ).rejects.toMatchObject({ code })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
