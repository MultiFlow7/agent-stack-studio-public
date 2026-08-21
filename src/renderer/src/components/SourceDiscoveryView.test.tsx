import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../shared/ipc'
import type {
  DiscoveredRepository,
  SourceHandoff,
  SourceSearchResult,
} from '../../../shared/source-discovery'
import { SourceDiscoveryView } from './SourceDiscoveryView'

const repository: DiscoveredRepository = {
  provider: 'github',
  sourceId: '42',
  owner: 'fixture',
  name: 'component',
  fullName: 'fixture/component',
  description: 'A public Agent component fixture.',
  htmlUrl: 'https://github.com/fixture/component',
  cloneUrl: 'https://github.com/fixture/component.git',
  defaultBranch: 'main',
  licenseSpdx: 'MIT',
  language: 'TypeScript',
  topics: ['agent'],
  stars: 12,
  forks: 2,
  openIssues: 0,
  archived: false,
  disabled: false,
  fork: false,
  pushedAt: '2026-08-19T08:00:00.000Z',
  updatedAt: '2026-08-19T08:00:00.000Z',
  metadataLevel: 'provider-reported',
}

const handoff: SourceHandoff = {
  formatVersion: 1,
  provider: 'github',
  repository,
  destination: 'component',
  commands: [
    {
      purpose: 'clone',
      executable: 'git',
      args: ['clone', '--', repository.cloneUrl, 'component'],
      requiresReview: true,
    },
    {
      purpose: 'inspect',
      executable: 'studio',
      args: ['component', 'inspect', 'component', '--json'],
      requiresReview: true,
    },
  ],
  safetyNotice: 'Studio 只生成交接计划，不会执行这些命令。',
  createdAt: '2026-08-20T08:00:00.000Z',
}

function installApi(overrides: Partial<StudioApi['discovery']> = {}) {
  const search = vi.fn().mockResolvedValue({
    provider: 'github',
    query: 'agent',
    totalCount: 1,
    incompleteResults: false,
    items: [repository],
    page: 1,
    perPage: 10,
    cacheHit: false,
    rateLimit: { limit: 10, remaining: 9, resetAt: null, resource: 'search' },
  })
  const handoffCall = vi.fn().mockResolvedValue(handoff)
  const cancel = vi.fn().mockResolvedValue({ cancelled: true })
  const copy = vi.fn().mockResolvedValue(undefined)
  const discovery: StudioApi['discovery'] = {
    search,
    inspect: vi.fn().mockResolvedValue(repository),
    handoff: handoffCall,
    cancel,
    copy,
    open: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  window.studio = { discovery } as unknown as StudioApi
  return { discovery, search, handoffCall, cancel, copy }
}

describe('SourceDiscoveryView', () => {
  it('explains the idle boundary and a successful empty result without downloading', async () => {
    const emptySearch = vi.fn().mockResolvedValue({
      provider: 'github',
      query: 'no matches',
      totalCount: 0,
      incompleteResults: false,
      items: [],
      page: 1,
      perPage: 10,
      cacheHit: false,
      rateLimit: { limit: 10, remaining: 9, resetAt: null, resource: 'search' },
    })
    installApi({ search: emptySearch })
    const user = userEvent.setup()
    render(<SourceDiscoveryView />)

    expect(screen.getByRole('heading', { name: '先找到候选来源，再决定是否下载' })).toBeVisible()
    expect(screen.getByText('不会自动执行 clone、install、Hook 或仓库脚本')).toBeVisible()
    await user.type(screen.getByRole('searchbox'), 'no matches')
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: '没有匹配的公开仓库' })).toBeVisible()
    expect(emptySearch).toHaveBeenCalledTimes(1)
  })

  it('searches only after submission and creates a review-required handoff', async () => {
    const { search, handoffCall, copy } = installApi()
    const user = userEvent.setup()
    render(<SourceDiscoveryView />)

    expect(screen.getByText('不下载，不执行代码')).toBeVisible()
    expect(search).not.toHaveBeenCalled()
    await user.type(screen.getByRole('searchbox'), 'agent')
    await user.click(screen.getByRole('button', { name: '搜索来源' }))

    expect(await screen.findByRole('heading', { name: 'fixture/component' })).toBeVisible()
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github', query: 'agent', page: 1 }),
    )
    await user.click(screen.getByRole('button', { name: '准备下载交接' }))
    expect(handoffCall).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Studio 只生成交接计划，不会执行这些命令。')).toBeVisible()
    expect(screen.getByText(/git clone/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '复制交接 JSON' }))
    await waitFor(() =>
      expect(copy).toHaveBeenCalledWith(expect.stringContaining('fixture/component')),
    )
  })

  it('cancels an in-flight search with Escape', async () => {
    const { cancel } = installApi({
      search: vi.fn(() => new Promise<SourceSearchResult>(() => undefined)),
    })
    const user = userEvent.setup()
    render(<SourceDiscoveryView />)

    await user.type(screen.getByRole('searchbox'), 'agent')
    await user.click(screen.getByRole('button', { name: '搜索来源' }))
    expect(screen.getByRole('button', { name: '取消搜索' })).toBeVisible()
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('heading', { name: '搜索已取消' })).toBeVisible()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['离线', '无法连接 GitHub 公开 API。', '无法连接 GitHub'],
    ['超时', 'GitHub 公开 API 在 15 秒内未响应。', 'GitHub 响应超时'],
    ['限流', 'GitHub 搜索频率已受限。', 'GitHub 搜索频率受限'],
    ['Provider 错误', 'GitHub 请求失败（500）。', 'GitHub Provider 返回错误'],
  ])('shows a recoverable %s search failure', async (_scenario, message, title) => {
    const search = vi.fn().mockRejectedValue(new Error(message))
    installApi({ search })
    const user = userEvent.setup()
    render(<SourceDiscoveryView />)

    await user.type(screen.getByRole('searchbox'), 'agent')
    await user.click(screen.getByRole('button', { name: '搜索来源' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('heading', { name: title })).toBeVisible()
    expect(screen.getByRole('button', { name: '重试搜索' })).toBeVisible()
    expect(document.body).not.toHaveTextContent('Error invoking remote method')
  })

  it('keeps an invalid query local and returns keyboard focus to editing', async () => {
    const { search } = installApi()
    const user = userEvent.setup()
    render(<SourceDiscoveryView />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'a')
    await user.click(screen.getByRole('button', { name: '搜索来源' }))
    expect(await screen.findByRole('heading', { name: '搜索条件不完整' })).toBeVisible()
    expect(screen.getByText(/当前输入没有发送到网络/)).toBeVisible()
    expect(search).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '修改搜索条件' }))
    expect(input).toHaveFocus()
  })
})
