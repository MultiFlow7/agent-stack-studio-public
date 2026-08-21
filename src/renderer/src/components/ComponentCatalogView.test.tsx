import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { builtInComponents } from '../../../main/components/built-in-components'
import type { ComponentCatalogItem } from '../../../shared/component-catalog'
import type { StudioApi } from '../../../shared/ipc'
import { ComponentCatalogView } from './ComponentCatalogView'

const item: ComponentCatalogItem = {
  component: {
    ...builtInComponents[0],
    createdAt: '2026-08-20T01:00:00.000Z',
    updatedAt: '2026-08-20T02:00:00.000Z',
  },
  usedByAgents: [
    {
      id: '92d74aaf-b86c-4e84-978b-b35d227e0c79',
      name: 'Research Agent',
      archivedAt: null,
      draftRevision: 3,
    },
  ],
  affectedVersions: [
    {
      agentId: '92d74aaf-b86c-4e84-978b-b35d227e0c79',
      agentName: 'Research Agent',
      versionId: '3b129300-9e8a-4a70-ae02-e2dc1cba565e',
      versionNumber: 2,
      createdAt: '2026-08-20T03:00:00.000Z',
    },
  ],
  validationRecord: {
    status: 'runtime-verified',
    recordedAt: '2026-08-20T02:00:00.000Z',
  },
}

function installComponentApi(options?: {
  catalog?: StudioApi['components']['catalog']
  get?: StudioApi['components']['get']
}) {
  const catalog = options?.catalog ?? vi.fn(() => Promise.resolve([item]))
  const get = options?.get ?? vi.fn(() => Promise.resolve(item))
  window.studio = {
    components: {
      catalog,
      get,
      list: vi.fn(() => Promise.resolve([item.component])),
      getStack: vi.fn(() => Promise.reject(new Error('unused'))),
      addToStack: vi.fn(() => Promise.reject(new Error('unused'))),
      removeFromStack: vi.fn(() => Promise.reject(new Error('unused'))),
      selectOwner: vi.fn(() => Promise.reject(new Error('unused'))),
    },
  } as unknown as StudioApi
  return { catalog, get }
}

describe('ComponentCatalogView', () => {
  it('opens a command-center component destination directly', async () => {
    const { get } = installComponentApi()
    render(<ComponentCatalogView initialComponentId={item.component.id} />)

    await waitFor(() => expect(get).toHaveBeenCalledWith(item.component.id))
    expect(await screen.findByRole('heading', { name: 'Manifest 与来源' })).toBeVisible()
  })

  it('shows the local empty state after the catalog finishes loading', async () => {
    installComponentApi({ catalog: vi.fn(() => Promise.resolve([])) })
    render(<ComponentCatalogView />)

    expect(screen.getByLabelText('正在载入组件')).toHaveAttribute('aria-busy', 'true')
    expect(await screen.findByRole('heading', { name: '尚无本地组件记录' })).toBeVisible()
  })

  it('filters the catalog and opens the complete component detail from the keyboard', async () => {
    const { get } = installComponentApi()
    const user = userEvent.setup()
    render(<ComponentCatalogView />)

    expect(await screen.findByText('1 个 Agent 草稿')).toBeVisible()
    expect(screen.getByText('1 个不可变版本')).toBeVisible()
    expect(screen.getByText('最近验证记录')).toBeVisible()

    await user.type(screen.getByLabelText('搜索'), '不存在的组件')
    expect(screen.getByText('没有符合当前筛选条件的组件。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '清除筛选' }))
    await user.selectOptions(screen.getByLabelText('兼容状态'), 'adapter')
    expect(screen.getByText('没有符合当前筛选条件的组件。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '清除筛选' }))
    await user.selectOptions(screen.getByLabelText('来源'), 'generated-adapter')
    expect(screen.getByText('没有符合当前筛选条件的组件。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '清除筛选' }))

    const open = screen.getByRole('button', { name: /本地 Harness X/ })
    open.focus()
    await user.keyboard('{Enter}')
    expect(get).toHaveBeenCalledWith(item.component.id)
    expect(await screen.findByRole('heading', { name: 'Manifest 与来源' })).toBeVisible()
    expect(screen.getByText('配置 Schema')).toBeVisible()
    expect(screen.getByText('Adapter / Fork 状态')).toBeVisible()
    expect(screen.getByText('契约测试与来源证据')).toBeVisible()
    expect(screen.getByText('当前使用方与受影响版本')).toBeVisible()
    expect(screen.getAllByText('Research Agent')).toHaveLength(2)
    expect(document.getElementById('component-detail-panel')).toHaveFocus()
  })

  it('keeps catalog and detail failures contextual and retryable', async () => {
    const catalog = vi
      .fn<StudioApi['components']['catalog']>()
      .mockRejectedValueOnce(new Error('组件索引不可用。'))
      .mockResolvedValue([item])
    const get = vi
      .fn<StudioApi['components']['get']>()
      .mockRejectedValueOnce(new Error('详情读取失败。'))
      .mockResolvedValue(item)
    installComponentApi({ catalog, get })
    const user = userEvent.setup()
    render(<ComponentCatalogView />)

    expect(await screen.findByText('组件索引不可用。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '重试' }))
    await user.click(await screen.findByRole('button', { name: /本地 Harness X/ }))
    expect(await screen.findByText('详情读取失败。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getByText('Manifest 与来源')).toBeVisible())
  })
})
