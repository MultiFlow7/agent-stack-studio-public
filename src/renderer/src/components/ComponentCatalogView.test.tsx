import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { builtInComponents } from '../../../main/components/built-in-components'
import type { ComponentCatalogItem } from '../../../shared/component-catalog'
import type { StudioApi } from '../../../shared/ipc'
import { assessComponentCompatibility } from '../../../shared/compatibility-assessment'
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

  it('keeps a cancelled import unchanged and makes a completed import immediately selectable', async () => {
    const catalog = vi
      .fn<StudioApi['components']['catalog']>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([item])
    installComponentApi({ catalog })
    const current = {
      project: { revision: 2 },
    } as Awaited<ReturnType<NonNullable<StudioApi['studioProject']>['current']>>
    const importComponent = vi
      .fn<NonNullable<StudioApi['studioProject']>['importComponent']>()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ project: { revision: 3 } } as never)
    window.studio.studioProject = {
      current: vi.fn().mockResolvedValue(current),
      importComponent,
    } as unknown as NonNullable<StudioApi['studioProject']>
    const user = userEvent.setup()
    render(<ComponentCatalogView />)

    await user.click(await screen.findByRole('button', { name: '导入第一个组件' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '导入第一个组件' }))
    expect(
      await screen.findByText('组件已静态导入，现在可以在 Agent 的 Stack 中选择。'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /本地 Harness X/ })).toBeVisible()
  })

  it('updates structured Descriptor fields without upgrading evidence and confirms removal', async () => {
    installComponentApi()
    let archived = false
    const archivedItem: ComponentCatalogItem = {
      ...item,
      component: { ...item.component, archivedAt: '2026-08-22T10:00:00.000Z' },
    }
    window.studio.components.get = vi.fn(() => Promise.resolve(archived ? archivedItem : item))
    const current = {
      project: { revision: 4 },
    } as Awaited<ReturnType<NonNullable<StudioApi['studioProject']>['current']>>
    const updateDescriptor = vi
      .fn<NonNullable<StudioApi['studioProject']>['updateDescriptor']>()
      .mockResolvedValue(current)
    const archiveComponent = vi
      .fn<NonNullable<StudioApi['studioProject']>['archiveComponent']>()
      .mockImplementation(() => {
        archived = true
        return Promise.resolve(current)
      })
    const deleteComponent = vi
      .fn<NonNullable<StudioApi['studioProject']>['deleteComponent']>()
      .mockResolvedValue(current)
    window.studio.studioProject = {
      current: vi.fn().mockResolvedValue(current),
      updateDescriptor,
      archiveComponent,
      deleteComponent,
    } as unknown as NonNullable<StudioApi['studioProject']>
    const user = userEvent.setup()
    render(<ComponentCatalogView />)

    await user.click(await screen.findByRole('button', { name: /本地 Harness X/ }))
    await user.click(screen.getByRole('button', { name: '更新 Descriptor' }))
    const name = screen.getByLabelText('名称')
    await user.clear(name)
    await user.type(name, '本地 Harness X 更新')
    await user.click(screen.getByRole('button', { name: '保存 Descriptor' }))

    await waitFor(() => expect(updateDescriptor).toHaveBeenCalledTimes(1))
    const update = updateDescriptor.mock.calls[0]?.[0]
    expect(update?.componentId).toBe(item.component.id)
    expect(update?.expectedRevision).toBe(4)
    expect(update?.descriptor.name).toBe('本地 Harness X 更新')
    expect(update?.descriptor.compatibility.validation).toBe('runtime-verified')

    await user.click(screen.getByRole('button', { name: '归档组件' }))
    await waitFor(() =>
      expect(archiveComponent).toHaveBeenCalledWith({
        componentId: item.component.id,
        expectedRevision: 4,
      }),
    )

    await user.click(screen.getByRole('button', { name: '永久删除' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(deleteComponent).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '永久删除' }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() =>
      expect(deleteComponent).toHaveBeenCalledWith({
        componentId: item.component.id,
        expectedRevision: 4,
      }),
    )
    expect(screen.queryByLabelText('组件详情')).not.toBeInTheDocument()
  })

  it('shows in-place progress and the refreshed machine-evidence state after a static recheck', async () => {
    const descriptor = {
      ...item.component.descriptor,
      runtimeAdapter: null,
      evidence: [],
      compatibility: {
        level: 'unknown' as const,
        validation: 'declared' as const,
        detail: '缺少能力替换边界、契约测试和受信运行证据。',
      },
    }
    const uncheckedItem: ComponentCatalogItem = {
      ...item,
      component: { ...item.component, descriptor },
      assessment: assessComponentCompatibility({
        componentId: item.component.id,
        descriptor,
        checkedAt: '2026-08-22T10:00:00.000Z',
        platform: 'darwin-arm64',
      }),
    }
    const checkedItem: ComponentCatalogItem = {
      ...uncheckedItem,
      assessment: assessComponentCompatibility({
        componentId: item.component.id,
        descriptor,
        checkedAt: '2026-08-22T10:01:00.000Z',
        staticInspection: { completedAt: '2026-08-22T10:01:00.000Z' },
        platform: 'darwin-arm64',
      }),
    }
    let checked = false
    let finishRecheck: (() => void) | undefined
    installComponentApi({
      catalog: vi.fn(() => Promise.resolve([checked ? checkedItem : uncheckedItem])),
      get: vi.fn(() => Promise.resolve(checked ? checkedItem : uncheckedItem)),
    })
    const current = {
      project: { revision: 9 },
    } as Awaited<ReturnType<NonNullable<StudioApi['studioProject']>['current']>>
    const recheckComponent = vi
      .fn<NonNullable<StudioApi['studioProject']>['recheckComponent']>()
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finishRecheck = () => {
              checked = true
              resolve({ project: { revision: 10 } } as never)
            }
          }),
      )
    window.studio.studioProject = {
      current: vi.fn().mockResolvedValue(current),
      recheckComponent,
    } as unknown as NonNullable<StudioApi['studioProject']>
    const user = userEvent.setup()
    render(<ComponentCatalogView />)

    await user.click(await screen.findByRole('button', { name: /本地 Harness X/ }))
    await user.click(screen.getByRole('button', { name: '重新静态检查' }))

    expect(screen.getByRole('button', { name: '正在静态检查…' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('status')).toHaveTextContent('正在重新静态检查')
    expect(recheckComponent).toHaveBeenCalledWith({
      componentId: item.component.id,
      expectedRevision: 9,
    })

    finishRecheck?.()
    expect(await screen.findByText('静态检查已完成，未执行组件代码。')).toBeVisible()
    expect(screen.getByText('静态检查完成，机器证据不足')).toBeVisible()
  })

  it('edits the complete capability contract with schema validation and cancel zero-write', async () => {
    installComponentApi()
    const current = {
      project: { revision: 7 },
    } as Awaited<ReturnType<NonNullable<StudioApi['studioProject']>['current']>>
    const updateDescriptor = vi
      .fn<NonNullable<StudioApi['studioProject']>['updateDescriptor']>()
      .mockResolvedValue(current)
    window.studio.studioProject = {
      current: vi.fn().mockResolvedValue(current),
      updateDescriptor,
    } as unknown as NonNullable<StudioApi['studioProject']>
    const user = userEvent.setup()
    render(<ComponentCatalogView />)

    await user.click(await screen.findByRole('button', { name: /本地 Harness X/ }))
    await user.click(screen.getByRole('button', { name: '更新 Descriptor' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(updateDescriptor).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '更新 Descriptor' }))
    await user.selectOptions(screen.getByLabelText('策略'), 'adapter')
    await user.type(screen.getByLabelText('策略理由'), '需要稳定转换契约。')
    await user.selectOptions(screen.getAllByLabelText('替换性')[0], 'adapter-required')
    await user.selectOptions(screen.getAllByLabelText('激活方式')[0], 'owner-only')
    await user.click(screen.getByRole('button', { name: '添加依赖' }))
    const capabilityInputs = screen.getAllByLabelText('能力')
    await user.clear(capabilityInputs.at(-1)!)
    await user.type(capabilityInputs.at(-1)!, 'state-store')
    await user.click(screen.getByRole('button', { name: '添加权限' }))
    await user.click(screen.getByRole('button', { name: '添加密钥引用' }))
    await user.type(screen.getByLabelText('理由'), '访问本地模型网关。')
    await user.type(screen.getByLabelText('用途'), '模型网关认证。')
    await user.click(screen.getByRole('button', { name: '保存 Descriptor' }))

    await waitFor(() => expect(updateDescriptor).toHaveBeenCalledTimes(1))
    const descriptor = updateDescriptor.mock.calls[0]?.[0].descriptor
    expect(descriptor?.compatibility).toMatchObject({
      level: 'adapter',
      validation: 'runtime-verified',
      strategyRationale: '需要稳定转换契约。',
    })
    expect(descriptor?.provides[0]).toMatchObject({
      replaceability: 'adapter-required',
      activation: 'owner-only',
    })
    expect(descriptor?.requires.at(-1)?.capability).toBe('state-store')
    expect(descriptor?.permissions).toEqual([
      { scope: 'network', required: true, reason: '访问本地模型网关。' },
    ])
    expect(descriptor?.secretReferences).toEqual([
      { name: 'API_KEY', purpose: '模型网关认证。', required: true },
    ])
  }, 15_000)

  it('filters archived components and restores one for immediate Stack selection', async () => {
    const archivedItem: ComponentCatalogItem = {
      ...item,
      component: { ...item.component, archivedAt: '2026-08-22T10:00:00.000Z' },
    }
    let restored = false
    installComponentApi({
      catalog: vi.fn(() => Promise.resolve([restored ? item : archivedItem])),
      get: vi.fn(() => Promise.resolve(restored ? item : archivedItem)),
    })
    const current = {
      project: { revision: 8 },
    } as Awaited<ReturnType<NonNullable<StudioApi['studioProject']>['current']>>
    const restoreComponent = vi
      .fn<NonNullable<StudioApi['studioProject']>['restoreComponent']>()
      .mockImplementation(() => {
        restored = true
        return Promise.resolve(current)
      })
    window.studio.studioProject = {
      current: vi.fn().mockResolvedValue(current),
      restoreComponent,
    } as unknown as NonNullable<StudioApi['studioProject']>
    const user = userEvent.setup()
    render(<ComponentCatalogView />)

    await user.selectOptions(await screen.findByLabelText('范围'), 'archived')
    await user.click(await screen.findByRole('button', { name: /本地 Harness X/ }))
    await user.click(screen.getByRole('button', { name: '恢复组件' }))
    await waitFor(() =>
      expect(restoreComponent).toHaveBeenCalledWith({
        componentId: item.component.id,
        expectedRevision: 8,
      }),
    )
    expect(await screen.findByText('组件已恢复，现在可在 Agent Stack 中选择。')).toBeVisible()
  })
})
