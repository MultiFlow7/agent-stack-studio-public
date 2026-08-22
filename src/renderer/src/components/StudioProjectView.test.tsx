import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../shared/ipc'
import { studioProjectStateSchema, type StudioProjectState } from '../../../shared/studio-project'
import { StudioProjectView } from './StudioProjectView'

const projectId = '10000000-0000-4000-8000-000000000001'
const agentId = '20000000-0000-4000-8000-000000000001'
const now = '2026-08-20T08:00:00.000Z'

function state(revision = 4): StudioProjectState {
  return studioProjectStateSchema.parse({
    projectPath: '/tmp/shared/.agent-stack',
    localAgentId: agentId,
    project: {
      $schema: 'https://agentstack.studio/schemas/project-v2.json',
      formatVersion: 2,
      id: projectId,
      name: '共享 Fixture',
      description: '一份可移植 Agent Stack',
      revision,
      components: [],
      stack: { executionMode: 'agent-loop', componentIds: [], capabilityOwners: [] },
      workflows: [],
      versions: [],
      createdAt: now,
      updatedAt: now,
    },
    validation: {
      status: 'blocked',
      revision,
      issues: [
        {
          severity: 'error',
          code: 'EMPTY_STACK',
          message: 'Stack 为空。',
          componentId: null,
          capability: null,
          suggestedActions: ['在 Agent 页添加组件。'],
        },
      ],
      remediationTasks: [],
      runtimePlanHash: null,
      checkedAt: now,
    },
    integrity: {
      status: 'verified',
      algorithm: 'sha256',
      projectId,
      revision,
      versionsChecked: 0,
      versions: [],
      checkedAt: now,
    },
    recovered: false,
    changedExternally: false,
    cliPath: '/Applications/Agent Stack Studio.app/Contents/Resources/studio.mjs',
  })
}

function installApi(
  current = state(),
  overrides: Partial<NonNullable<StudioApi['studioProject']>> = {},
) {
  const listeners: Array<() => void> = []
  window.studio = {
    studioProject: {
      current: vi.fn().mockResolvedValue(current),
      open: vi.fn().mockResolvedValue(current),
      init: vi.fn().mockResolvedValue(current),
      export: vi.fn().mockResolvedValue({ status: 'cancelled' }),
      onExternalChanged: vi.fn((listener: () => void) => {
        listeners.push(listener)
        return () => undefined
      }),
      ...overrides,
    },
  } as unknown as StudioApi
  return listeners
}

describe('StudioProjectView', () => {
  it('keeps project metadata in a secondary settings view without portable editors', async () => {
    installApi()
    render(<StudioProjectView />)

    expect(await screen.findByRole('heading', { name: '项目设置' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '共享 Fixture' })).toBeVisible()
    expect(screen.getByText('/tmp/shared/.agent-stack')).toBeVisible()
    expect(screen.getByText(agentId)).toBeVisible()
    expect(screen.getByText(/SHA-256 已验证 0 个版本/)).toBeVisible()
    expect(screen.queryByText(/Descriptor JSON/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /加入 Stack/ })).not.toBeInTheDocument()
  })

  it('supports keyboard project switching and handles cancellation as a non-destructive result', async () => {
    const open = vi.fn().mockResolvedValue(state(5))
    const init = vi.fn().mockResolvedValue(state(0))
    installApi(state(), { open, init })
    const user = userEvent.setup()
    render(<StudioProjectView />)

    const openButton = await screen.findByRole('button', { name: '打开项目' })
    openButton.focus()
    await user.keyboard('{Enter}')
    expect(open).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('已切换到“共享 Fixture”。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '创建项目' }))
    expect(init).toHaveBeenCalledTimes(1)
  })

  it('exports a portable package, reports cancellation, and exposes failures', async () => {
    const exportProject = vi
      .fn()
      .mockResolvedValueOnce({ status: 'cancelled' })
      .mockRejectedValueOnce(new Error('导出目标不可写'))
    installApi(state(), { export: exportProject })
    const user = userEvent.setup()
    render(<StudioProjectView />)
    const button = await screen.findByRole('button', { name: '导出可移植包' })

    await user.click(button)
    expect(await screen.findByText('已取消导出，项目未发生变化。')).toBeVisible()
    await user.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('导出目标不可写')
  })

  it('refreshes external modifications and makes backup recovery explicit', async () => {
    const external = { ...state(6), recovered: true }
    const listeners = installApi(state(), {
      current: vi.fn().mockResolvedValueOnce(state()).mockResolvedValue(external),
    })
    render(<StudioProjectView />)
    await screen.findByText('revision 4')
    listeners[0]?.()
    await waitFor(() => expect(screen.getAllByText(/revision 6/)).toHaveLength(2))
    expect(screen.getByText(/外部修改/)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('最后有效备份恢复')
  })
})
