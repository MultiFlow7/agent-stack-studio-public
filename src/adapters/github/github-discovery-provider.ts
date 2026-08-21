import { z } from 'zod'
import packageMetadata from '../../../package.json' with { type: 'json' }
import { StudioCoreError } from '../../core/project-errors'
import type { SourceDiscoveryProvider } from '../../core/source-discovery'
import {
  discoveredRepositorySchema,
  sourceSearchInputSchema,
  sourceSearchResultSchema,
  type DiscoveredRepository,
  type SourceLocatorInput,
  type SourceRateLimit,
  type SourceSearchInput,
  type SourceSearchResult,
} from '../../shared/source-discovery'

const API_BASE = 'https://api.github.com'
const API_VERSION = '2022-11-28'
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const MAX_CACHE_ENTRIES = 50

const githubRepositorySchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  full_name: z.string().min(3),
  owner: z.object({ login: z.string().min(1) }),
  description: z.string().nullable().optional(),
  html_url: z.url(),
  clone_url: z.url(),
  default_branch: z.string().min(1),
  license: z.object({ spdx_id: z.string().nullable().optional() }).nullable().optional(),
  language: z.string().nullable().optional(),
  topics: z.array(z.string()).optional(),
  stargazers_count: z.number().int().nonnegative(),
  forks_count: z.number().int().nonnegative(),
  open_issues_count: z.number().int().nonnegative(),
  archived: z.boolean().optional(),
  disabled: z.boolean().optional(),
  fork: z.boolean().optional(),
  pushed_at: z.iso.datetime().nullable().optional(),
  updated_at: z.iso.datetime(),
})

const githubSearchResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  incomplete_results: z.boolean(),
  items: z.array(githubRepositorySchema),
})

interface SearchCacheEntry {
  etag: string
  result: SourceSearchResult
}

type Fetch = typeof fetch

function headerInteger(headers: Headers, name: string): number | null {
  const raw = headers.get(name)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 ? value : null
}

function rateLimit(headers: Headers): SourceRateLimit {
  const reset = headerInteger(headers, 'x-ratelimit-reset')
  return {
    limit: headerInteger(headers, 'x-ratelimit-limit'),
    remaining: headerInteger(headers, 'x-ratelimit-remaining'),
    resetAt: reset === null ? null : new Date(reset * 1_000).toISOString(),
    resource: headers.get('x-ratelimit-resource'),
  }
}

function mapRepository(input: z.infer<typeof githubRepositorySchema>): DiscoveredRepository {
  return discoveredRepositorySchema.parse({
    provider: 'github',
    sourceId: String(input.id),
    owner: input.owner.login,
    name: input.name,
    fullName: input.full_name,
    description: input.description ?? null,
    htmlUrl: input.html_url,
    cloneUrl: input.clone_url,
    defaultBranch: input.default_branch,
    licenseSpdx:
      input.license?.spdx_id && input.license.spdx_id !== 'NOASSERTION'
        ? input.license.spdx_id
        : null,
    language: input.language ?? null,
    topics: input.topics ?? [],
    stars: input.stargazers_count,
    forks: input.forks_count,
    openIssues: input.open_issues_count,
    archived: input.archived ?? false,
    disabled: input.disabled ?? false,
    fork: input.fork ?? false,
    pushedAt: input.pushed_at ?? null,
    updatedAt: input.updated_at,
    metadataLevel: 'provider-reported',
  })
}

function parseLocator(locator: string): { owner: string; repository: string } {
  let value = locator.trim()
  if (value.startsWith('https://')) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw invalidLocator(locator)
    }
    if (
      !['github.com', 'www.github.com'].includes(url.hostname) ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw invalidLocator(locator)
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 2) throw invalidLocator(locator)
    value = `${segments[0]}/${segments[1]}`
  }
  const [owner, rawRepository, ...extra] = value.split('/')
  const repository = rawRepository?.replace(/\.git$/, '')
  if (
    !owner ||
    !repository ||
    extra.length > 0 ||
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(repository)
  ) {
    throw invalidLocator(locator)
  }
  return { owner, repository }
}

function invalidLocator(locator: string): StudioCoreError {
  return new StudioCoreError(
    'DISCOVERY_QUERY_INVALID',
    '仓库定位必须是 owner/repo 或 GitHub 仓库 URL。',
    {
      details: { locatorLength: locator.length },
      suggestedActions: [{ description: '使用例如 octocat/Hello-World 的公开仓库定位。' }],
    },
  )
}

async function responseMessage(response: Response): Promise<string | undefined> {
  try {
    const payload = z
      .object({ message: z.string().max(1_000).optional() })
      .parse(await response.json())
    return payload.message
  } catch {
    return undefined
  }
}

export class GithubDiscoveryProvider implements SourceDiscoveryProvider {
  readonly id = 'github' as const
  readonly #fetch: Fetch
  readonly #requestTimeoutMs: number
  readonly #searchCache = new Map<string, SearchCacheEntry>()

  constructor(options: { fetch?: Fetch; requestTimeoutMs?: number } = {}) {
    this.#fetch = options.fetch ?? globalThis.fetch
    const configuredTimeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.#requestTimeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout >= 1 && configuredTimeout <= 60_000
        ? configuredTimeout
        : DEFAULT_REQUEST_TIMEOUT_MS
  }

  async search(input: SourceSearchInput, signal?: AbortSignal): Promise<SourceSearchResult> {
    const validation = sourceSearchInputSchema.safeParse(input)
    if (!validation.success) {
      throw new StudioCoreError('DISCOVERY_QUERY_INVALID', 'GitHub 搜索条件无效。', {
        details: { issues: validation.error.issues },
        suggestedActions: [{ description: '使用至少两个字符，并检查排序与分页范围。' }],
      })
    }
    const parsed = validation.data
    const url = new URL('/search/repositories', API_BASE)
    url.searchParams.set('q', parsed.query)
    if (parsed.sort !== 'relevance') {
      url.searchParams.set('sort', parsed.sort)
      url.searchParams.set('order', parsed.order)
    }
    url.searchParams.set('page', String(parsed.page))
    url.searchParams.set('per_page', String(parsed.perPage))
    const cache = this.#searchCache.get(url.href)
    const response = await this.#request(url, signal, cache?.etag)
    if (response.status === 304 && cache) {
      return sourceSearchResultSchema.parse({
        ...cache.result,
        cacheHit: true,
        rateLimit: rateLimit(response.headers),
      })
    }
    await this.#assertResponse(response)
    let payload: z.infer<typeof githubSearchResponseSchema>
    try {
      payload = githubSearchResponseSchema.parse(await response.json())
    } catch (error) {
      throw new StudioCoreError('DISCOVERY_PROVIDER_FAILED', 'GitHub 返回了无法识别的搜索结果。', {
        cause: error,
        suggestedActions: [{ description: '稍后重试，或在 GitHub 网站中直接搜索。' }],
      })
    }
    const result = sourceSearchResultSchema.parse({
      provider: 'github',
      query: parsed.query,
      totalCount: payload.total_count,
      incompleteResults: payload.incomplete_results,
      items: payload.items.map(mapRepository),
      page: parsed.page,
      perPage: parsed.perPage,
      cacheHit: false,
      rateLimit: rateLimit(response.headers),
    })
    const etag = response.headers.get('etag')
    if (etag) {
      this.#searchCache.delete(url.href)
      this.#searchCache.set(url.href, { etag, result })
      while (this.#searchCache.size > MAX_CACHE_ENTRIES) {
        const oldest = this.#searchCache.keys().next().value
        if (!oldest) break
        this.#searchCache.delete(oldest)
      }
    }
    return result
  }

  async inspect(input: SourceLocatorInput, signal?: AbortSignal): Promise<DiscoveredRepository> {
    const { owner, repository } = parseLocator(input.locator)
    const url = new URL(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
      API_BASE,
    )
    const response = await this.#request(url, signal)
    await this.#assertResponse(response)
    try {
      return mapRepository(githubRepositorySchema.parse(await response.json()))
    } catch (error) {
      throw new StudioCoreError('DISCOVERY_PROVIDER_FAILED', 'GitHub 返回了无法识别的仓库信息。', {
        cause: error,
        suggestedActions: [{ description: '在 GitHub 网站中检查该仓库。' }],
      })
    }
  }

  async #request(url: URL, signal?: AbortSignal, etag?: string): Promise<Response> {
    const timeout = AbortSignal.timeout(this.#requestTimeoutMs)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': `agent-stack-studio/${packageMetadata.version}`,
    }
    if (etag) headers['If-None-Match'] = etag
    try {
      return await this.#fetch(url, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: requestSignal,
      })
    } catch (error) {
      if (signal?.aborted) {
        throw new StudioCoreError('OPERATION_CANCELLED', 'GitHub 发现操作已取消。')
      }
      if (timeout.aborted) {
        throw new StudioCoreError(
          'DISCOVERY_TIMEOUT',
          `GitHub 公开 API 在 ${this.#requestTimeoutMs / 1_000} 秒内未响应。`,
          {
            cause: error,
            suggestedActions: [
              { description: '检查网络或代理延迟后重试。' },
              { description: '也可在 GitHub 网站搜索，再使用本地组件导入。' },
            ],
          },
        )
      }
      throw new StudioCoreError('DISCOVERY_NETWORK_FAILED', '无法连接 GitHub 公开 API。', {
        cause: error,
        suggestedActions: [
          { description: '检查网络或代理设置后重试。' },
          { description: '也可在 GitHub 网站搜索，再使用本地组件导入。' },
        ],
      })
    }
  }

  async #assertResponse(response: Response): Promise<void> {
    if (response.ok || response.status === 304) return
    const limit = rateLimit(response.headers)
    const message = await responseMessage(response)
    const isRateLimit =
      response.status === 429 ||
      (response.status === 403 &&
        (limit.remaining === 0 || message?.toLowerCase().includes('rate limit')))
    if (isRateLimit) {
      throw new StudioCoreError('DISCOVERY_RATE_LIMITED', 'GitHub 搜索频率已受限。', {
        details: { status: response.status, rateLimit: limit, providerMessage: message },
        suggestedActions: [
          {
            description: limit.resetAt
              ? `在 ${limit.resetAt} 之后重试。`
              : '等待至少一分钟后重试。',
          },
        ],
      })
    }
    if (response.status === 404) {
      throw new StudioCoreError('SOURCE_NOT_FOUND', '找不到该 GitHub 公开仓库。', {
        details: { status: response.status, providerMessage: message },
        suggestedActions: [{ description: '检查 owner/repo 拼写或仓库可见性。' }],
      })
    }
    if (response.status === 422) {
      throw new StudioCoreError('DISCOVERY_QUERY_INVALID', 'GitHub 无法处理该搜索条件。', {
        details: { status: response.status, providerMessage: message },
        suggestedActions: [{ description: '简化搜索词或检查 GitHub 搜索限定符。' }],
      })
    }
    throw new StudioCoreError(
      'DISCOVERY_PROVIDER_FAILED',
      `GitHub 请求失败（${response.status}）。`,
      {
        details: { status: response.status, providerMessage: message },
        suggestedActions: [{ description: '稍后重试。' }],
      },
    )
  }
}
