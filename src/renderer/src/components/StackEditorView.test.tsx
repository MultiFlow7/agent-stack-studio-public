import { render, screen, waitFor, within } from '@testing-library/react'
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

function installApi() {
  let state = createState([], [], 1)
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
  const componentsApi: StudioApi['components'] = {
    list: vi.fn(() => Promise.resolve(catalog)),
    catalog: vi.fn(() => Promise.resolve([])),
    get: vi.fn(() => Promise.reject(new Error('unused'))),
    getStack: vi.fn(() => Promise.resolve(state)),
    addToStack: vi.fn((input: AddStackComponentInput) => {
      state = createState(
        [...state.components, catalog.find(({ id }) => id === input.componentId)!],
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
      targets: vi.fn(() => Promise.resolve([])),
      preview: vi.fn(() => Promise.reject(new Error('unused'))),
      publish: vi.fn(() => Promise.reject(new Error('unused'))),
      history: vi.fn(() => Promise.resolve({ mapping: null, receipts: [] })),
    },
    maintenance: {} as StudioApi['maintenance'],
    preferences: {} as StudioApi['preferences'],
    discovery: {} as StudioApi['discovery'],
    menu: {
      onCreateAgent: vi.fn(() => () => undefined),
      onOpenSettings: vi.fn(() => () => undefined),
    },
  }
  return { selectOwner }
}

describe('StackEditorView', () => {
  it('adds X and Y, exposes both overlaps, and compiles only after both Owner decisions', async () => {
    const { selectOwner } = installApi()
    const user = userEvent.setup()
    render(<StackEditorView agentId={agentId} onChanged={vi.fn(() => Promise.resolve())} />)

    await user.click(await screen.findByRole('button', { name: '添加第一个组件' }))
    await user.click(screen.getByRole('button', { name: '添加 本地 Harness X' }))
    await user.click(screen.getByRole('button', { name: '添加 研究扩展 Y' }))

    expect(await screen.findByRole('heading', { name: 'Runtime Plan 已阻断' })).toBeVisible()
    expect(screen.getAllByText('能力重叠，请选择一个 Owner。')).toHaveLength(2)

    const promptGroup = screen.getByRole('group', { name: /Prompt 策略/ })
    const contextGroup = screen.getByRole('group', { name: /上下文组装/ })
    await user.click(within(promptGroup).getByRole('radio', { name: /本地 Harness X/ }))
    await user.click(within(contextGroup).getByRole('radio', { name: /研究扩展 Y/ }))

    expect(await screen.findByRole('heading', { name: 'Runtime Plan 已就绪' })).toBeVisible()
    await waitFor(() => expect(selectOwner).toHaveBeenCalledTimes(2))
  })
})
