import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { builtInComponents } from '../../../main/components/built-in-components'
import { compileRuntimePlan } from '../../../main/domain/runtime-plan-compiler'
import type { StudioApi } from '../../../shared/ipc'
import type { StackState } from '../../../shared/runtime-plan'
import { CapabilityView } from './CapabilityView'

const agentId = '20000000-0000-4000-8000-000000000001'
const timestamp = '2026-08-19T08:00:00.000Z'

function stackState(): StackState {
  const components = builtInComponents.slice(0, 2).map((component) => ({
    id: component.id,
    descriptor: structuredClone(component.descriptor),
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
  const owners = [
    { capability: 'prompt-policy' as const, componentId: components[0].id, selectedAt: timestamp },
    {
      capability: 'context-builder' as const,
      componentId: components[1].id,
      selectedAt: timestamp,
    },
  ]
  return {
    agentId,
    revision: 5,
    components,
    owners,
    compilation: compileRuntimePlan({
      agentId,
      stackRevision: 5,
      executionMode: 'agent-loop',
      components,
      owners,
    }),
  }
}

function installGetStack(getStack: StudioApi['components']['getStack']): void {
  window.studio = {
    components: { getStack },
  } as StudioApi
}

describe('CapabilityView', () => {
  it('shows an empty state and opens Stack from the keyboard', async () => {
    const onOpenStack = vi.fn()
    installGetStack(
      vi.fn(() =>
        Promise.resolve({
          agentId,
          revision: 1,
          components: [],
          owners: [],
          compilation: compileRuntimePlan({
            agentId,
            stackRevision: 1,
            executionMode: 'agent-loop',
            components: [],
            owners: [],
          }),
        }),
      ),
    )
    const user = userEvent.setup()
    render(<CapabilityView agentId={agentId} onOpenStack={onOpenStack} />)

    const open = await screen.findByRole('button', { name: '打开 Stack' })
    open.focus()
    await user.keyboard('{Enter}')
    expect(onOpenStack).toHaveBeenCalledTimes(1)
  })

  it('shows capability owners, providers, and validation evidence', async () => {
    installGetStack(vi.fn(() => Promise.resolve(stackState())))
    const user = userEvent.setup()
    render(<CapabilityView agentId={agentId} onOpenStack={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: '能力与实现来源' })).toBeVisible()
    expect(screen.getByText('Runtime Plan 已就绪')).toBeVisible()
    expect(screen.getByText('执行控制')).toBeVisible()
    expect(screen.getAllByText('本地 Harness X').length).toBeGreaterThan(0)
    await user.click(screen.getAllByText(/个 Provider/)[0])
    expect(screen.getAllByText('已验证兼容').length).toBeGreaterThan(0)
  })

  it('shows explicit Adapter evidence and remaining verification tasks', async () => {
    const state = stackState()
    const adapter = {
      id: builtInComponents[2].id,
      descriptor: structuredClone(builtInComponents[2].descriptor),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    state.components.push(adapter)
    state.compilation = compileRuntimePlan({
      agentId,
      stackRevision: state.revision,
      executionMode: 'agent-loop',
      components: state.components,
      owners: state.owners,
    })
    installGetStack(vi.fn(() => Promise.resolve(state)))
    const user = userEvent.setup()
    render(<CapabilityView agentId={agentId} onOpenStack={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Adapter / Fork 处置任务' })).toBeVisible()
    const tasks = screen.getByRole('region', { name: '兼容性处置任务' })
    expect(tasks).toHaveTextContent('1 项待完成')
    expect(tasks).toHaveTextContent('Adapter 已有契约测试证据')
    expect(tasks).toHaveTextContent('最小运行验证')
    const summaries = screen.getAllByText('验收条件')
    summaries.at(-1)?.focus()
    await user.keyboard('{Enter}')
    expect(tasks).toHaveTextContent('使用精确白名单 Runtime Adapter')
  })

  it('keeps load failures actionable and retries', async () => {
    const getStack = vi
      .fn<StudioApi['components']['getStack']>()
      .mockRejectedValueOnce(new Error('数据库暂时不可用。'))
      .mockResolvedValueOnce(stackState())
    installGetStack(getStack)
    const user = userEvent.setup()
    render(<CapabilityView agentId={agentId} onOpenStack={vi.fn()} />)

    expect(await screen.findByText('数据库暂时不可用。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('heading', { name: '能力与实现来源' })).toBeVisible()
    expect(getStack).toHaveBeenCalledTimes(2)
  })
})
