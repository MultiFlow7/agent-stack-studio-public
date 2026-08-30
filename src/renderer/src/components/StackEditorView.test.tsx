import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { builtInComponents } from '../../../main/components/built-in-components'
import { compileRuntimePlan } from '../../../main/domain/runtime-plan-compiler'
import type {
  AddStackComponentInput,
  ComponentRecord,
  SelectCapabilityOwnerInput,
} from '../../../shared/component'
import type { StudioApi } from '../../../shared/ipc'
import type { ProjectComponentInput, ProjectOwnerInput } from '../../../shared/studio-project'
import type { CapabilityOwner, StackState } from '../../../shared/runtime-plan'
import { StackEditorView } from './StackEditorView'

const agentId = '20000000-0000-4000-8000-000000000001'
const timestamp = '2026-08-19T08:00:00.000Z'
const catalog: ComponentRecord[] = builtInComponents.map((component) => ({
  id: component.id,
  descriptor: component.descriptor,
  createdAt: timestamp,
  updatedAt: timestamp,
}))

function createState(
  components: ComponentRecord[],
  owners: CapabilityOwner[],
  revision: number,
): StackState {
  return {
    agentId,
    components,
    owners,
    revision,
    compilation: compileRuntimePlan({
      agentId,
      stackRevision: revision,
      executionMode: 'agent-loop',
      components,
      owners,
    }),
  }
}

interface InstallApiOptions {
  initialCatalog?: ComponentRecord[]
  initialComponents?: ComponentRecord[]
}

function installApi(options: InstallApiOptions = {}) {
  const componentCatalog = options.initialCatalog ?? catalog
  let state = createState(options.initialComponents ?? [], [], 1)
  const selectOwner = vi.fn((input: SelectCapabilityOwnerInput) => {
    state = createState(
      state.components,
      [
        ...state.owners.filter(({ capability }) => capability !== input.capability),
        { capability: input.capability, componentId: input.componentId, selectedAt: timestamp },
      ],
      state.revision + 1,
    )
    return Promise.resolve(state)
  })
  const list = vi.fn(() => Promise.resolve(componentCatalog))
  const addToStack = vi.fn((input: ProjectComponentInput) => {
    const component = componentCatalog.find(({ id }) => id === input.componentId)
    if (!component) throw new Error('Fixture component is missing.')
    state = createState([...state.components, component], state.owners, state.revision + 1)
    return Promise.resolve({} as never)
  })
  const componentsApi: StudioApi['components'] = {
    list,
    catalog: vi.fn(() => Promise.resolve([])),
    get: vi.fn(() => Promise.reject(new Error('unused'))),
    getStack: vi.fn(() => Promise.resolve(state)),
    addToStack: vi.fn((input: AddStackComponentInput) => {
      state = createState(
        [...state.components, componentCatalog.find(({ id }) => id === input.componentId)!],
        state.owners,
        state.revision + 1,
      )
      return Promise.resolve(state)
    }),
    removeFromStack: vi.fn(() => Promise.resolve(state)),
    selectOwner,
  }
  window.studio = {
    agents: {
      create: vi.fn(() => Promise.reject(new Error('unused'))),
      get: vi.fn(() => Promise.reject(new Error('unused'))),
      list: vi.fn(() => Promise.resolve([])),
      statusList: vi.fn(() => Promise.resolve([])),
      status: vi.fn(() => Promise.reject(new Error('unused'))),
      update: vi.fn(() => Promise.reject(new Error('unused'))),
      duplicate: vi.fn(() => Promise.reject(new Error('unused'))),
      archive: vi.fn(() => Promise.reject(new Error('unused'))),
      restore: vi.fn(() => Promise.reject(new Error('unused'))),
      delete: vi.fn(() => Promise.reject(new Error('unused'))),
      createVersion: vi.fn(() => Promise.reject(new Error('unused'))),
    },
    secrets: {} as StudioApi['secrets'],
    imports: {
      selectAndScan: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
      confirm: vi.fn(() => Promise.reject(new Error('unused'))),
    },
    components: componentsApi,
    runs: {
      route: vi.fn(() => Promise.resolve({ kind: 'legacy' as const })),
      start: vi.fn(() => Promise.reject(new Error('unused'))),
      list: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.reject(new Error('unused'))),
      cancel: vi.fn(() => Promise.reject(new Error('unused'))),
    },
    experiments: {
      create: vi.fn(() => Promise.reject(new Error('unused'))),
      list: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.reject(new Error('unused'))),
      refreshDrift: vi.fn(() => Promise.reject(new Error('unused'))),
      start: vi.fn(() => Promise.reject(new Error('unused'))),
      cancel: vi.fn(() => Promise.reject(new Error('unused'))),
      export: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
    },
    publishing: {
      runtimes: vi.fn(() => Promise.resolve([])),
      targets: vi.fn(() => Promise.resolve([])),
      preview: vi.fn(() => Promise.reject(new Error('unused'))),
      publish: vi.fn(() => Promise.reject(new Error('unused'))),
      history: vi.fn(() => Promise.resolve({ mapping: null, receipts: [] })),
      status: vi.fn(() => Promise.reject(new Error('unused'))),
    },
    maintenance: {} as StudioApi['maintenance'],
    preferences: {} as StudioApi['preferences'],
    commandCenter: {} as StudioApi['commandCenter'],
    studioProject: {
      current: vi.fn(() =>
        Promise.resolve({
          localAgentId: agentId,
          project: { revision: state.revision - 1 },
        } as never),
      ),
      addToStack,
      removeFromStack: vi.fn(() => Promise.resolve({} as never)),
      setOwner: vi.fn((input: ProjectOwnerInput) => {
        void selectOwner({ agentId, capability: input.capability, componentId: input.componentId })
        return Promise.resolve({} as never)
      }),
    } as unknown as StudioApi['studioProject'],
    discovery: {} as StudioApi['discovery'],
    menu: {
      onCreateAgent: vi.fn(() => () => undefined),
      onOpenSettings: vi.fn(() => () => undefined),
    },
  }
  return { addToStack, componentsApi, list, selectOwner }
}

describe('StackEditorView', () => {
  it('adds X and Y, exposes both overlaps, and compiles only after both Owner decisions', async () => {
    const { selectOwner } = installApi()
    const user = userEvent.setup()
    render(<StackEditorView agentId={agentId} onChanged={vi.fn(() => Promise.resolve())} />)

    await user.click(await screen.findByRole('button', { name: '添加第一个组件' }))
    await user.click(screen.getByRole('button', { name: '添加 本地 Harness X' }))
    await user.click(screen.getByRole('button', { name: '添加 研究扩展 Y' }))

    expect(await screen.findByRole('heading', { name: 'Stack/兼容性 已阻断' })).toBeVisible()
    expect(screen.getAllByText('能力重叠，请选择一个负责实现。')).toHaveLength(2)

    const promptGroup = screen.getByRole('group', { name: /Prompt 策略/ })
    const contextGroup = screen.getByRole('group', { name: /上下文组装/ })
    await user.click(within(promptGroup).getByRole('radio', { name: /本地 Harness X/ }))
    await user.click(within(contextGroup).getByRole('radio', { name: /研究扩展 Y/ }))

    expect(await screen.findByRole('heading', { name: 'Stack/兼容性 就绪' })).toBeVisible()
    await waitFor(() => expect(selectOwner).toHaveBeenCalledTimes(2))
  })

  it('replaces the first-component empty state, moves focus, and adds with the keyboard', async () => {
    const { addToStack } = installApi()
    const user = userEvent.setup()
    render(<StackEditorView agentId={agentId} onChanged={vi.fn(() => Promise.resolve())} />)

    const opener = await screen.findByRole('button', { name: '添加第一个组件' })
    await user.click(opener)

    expect(screen.queryByRole('button', { name: '添加第一个组件' })).not.toBeInTheDocument()
    const firstAction = screen.getByRole('button', { name: '添加 本地 Harness X' })
    await waitFor(() => expect(firstAction).toHaveFocus())
    await user.keyboard('{Enter}')

    await waitFor(() => expect(addToStack).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByRole('button', { name: '从 Agent 移除 本地 Harness X' }),
    ).toBeVisible()
  })

  it('distinguishes an empty catalog and opens the component library', async () => {
    installApi({ initialCatalog: [] })
    const user = userEvent.setup()
    const navigate = vi.fn()
    window.addEventListener('studio:navigate-library', navigate)
    render(<StackEditorView agentId={agentId} onChanged={vi.fn(() => Promise.resolve())} />)

    await user.click(await screen.findByRole('button', { name: '添加第一个组件' }))
    expect(screen.getByText('本地组件目录还是空的。先从组件库添加一个来源。')).toBeVisible()
    expect(screen.queryByText('当前目录中的组件都已加入这个 Agent。')).not.toBeInTheDocument()
    const libraryButton = screen.getByRole('button', { name: '前往组件库' })
    await waitFor(() => expect(libraryButton).toHaveFocus())
    await user.click(libraryButton)

    expect(navigate).toHaveBeenCalledTimes(1)
    window.removeEventListener('studio:navigate-library', navigate)
  })

  it('states when every catalog component is already in the Agent', async () => {
    installApi({ initialComponents: catalog })
    const user = userEvent.setup()
    render(<StackEditorView agentId={agentId} onChanged={vi.fn(() => Promise.resolve())} />)

    await user.click(await screen.findByRole('button', { name: '添加组件' }))

    expect(screen.getByText('当前目录中的组件都已加入这个 Agent。')).toBeVisible()
    expect(
      screen.queryByText('本地组件目录还是空的。先从组件库添加一个来源。'),
    ).not.toBeInTheDocument()
  })

  it('keeps a failed catalog load recoverable', async () => {
    const { list } = installApi()
    list.mockRejectedValueOnce(new Error('目录读取失败'))
    const user = userEvent.setup()
    render(<StackEditorView agentId={agentId} onChanged={vi.fn(() => Promise.resolve())} />)

    expect(await screen.findByText('目录读取失败')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByRole('button', { name: '添加第一个组件' })).toBeVisible()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('preserves the picker after an add failure and offers a reload recovery', async () => {
    const { addToStack } = installApi()
    addToStack.mockRejectedValueOnce(new Error('REVISION_CONFLICT：项目已变化'))
    const user = userEvent.setup()
    render(<StackEditorView agentId={agentId} onChanged={vi.fn(() => Promise.resolve())} />)

    await user.click(await screen.findByRole('button', { name: '添加第一个组件' }))
    await user.click(screen.getByRole('button', { name: '添加 本地 Harness X' }))

    expect(await screen.findByText('REVISION_CONFLICT：项目已变化')).toBeVisible()
    expect(screen.getByRole('button', { name: '添加 本地 Harness X' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '重新读取' })).toBeVisible()
  })

  it('single-flights rapid duplicate add attempts', async () => {
    const { addToStack } = installApi()
    let resolveAdd!: (value: never) => void
    addToStack.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve
        }),
    )
    const user = userEvent.setup()
    render(<StackEditorView agentId={agentId} onChanged={vi.fn(() => Promise.resolve())} />)

    await user.click(await screen.findByRole('button', { name: '添加第一个组件' }))
    const addButton = screen.getByRole('button', { name: '添加 本地 Harness X' })
    fireEvent.click(addButton)
    fireEvent.click(addButton)

    await waitFor(() => expect(addToStack).toHaveBeenCalledTimes(1))
    resolveAdd({} as never)
    await waitFor(() => expect(addButton).toBeEnabled())
  })

  it('cancels component selection without changing the empty Stack', async () => {
    const { addToStack } = installApi()
    const user = userEvent.setup()
    render(<StackEditorView agentId={agentId} onChanged={vi.fn(() => Promise.resolve())} />)

    await user.click(await screen.findByRole('button', { name: '添加第一个组件' }))
    await user.click(screen.getByRole('button', { name: '取消选择' }))

    expect(await screen.findByRole('button', { name: '添加第一个组件' })).toBeVisible()
    expect(addToStack).not.toHaveBeenCalled()
  })
})
