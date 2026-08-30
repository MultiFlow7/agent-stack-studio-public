import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../shared/ipc'
import { buildCompatibilityRemediationTasks } from '../../../shared/remediation'
import { RemediationTaskList } from './RemediationTaskList'

const tasks = buildCompatibilityRemediationTasks({
  componentId: '30000000-0000-4000-8000-000000000001',
  componentName: 'pi-monorepo',
  compatibility: { level: 'adapter', validation: 'declared', detail: '需要 Adapter。' },
})

function installClipboard(copy: StudioApi['discovery']['copy']): void {
  window.studio = { discovery: { copy } } as StudioApi
}

describe('RemediationTaskList', () => {
  it('copies a complete Coding Agent prompt from one keyboard action', async () => {
    const copy = vi.fn<StudioApi['discovery']['copy']>().mockResolvedValue(undefined)
    installClipboard(copy)
    const user = userEvent.setup()
    render(<RemediationTaskList tasks={tasks} />)

    const button = screen.getByRole('button', { name: '复制给 Coding Agent' })
    button.focus()
    await user.keyboard('{Enter}')

    expect(copy).toHaveBeenCalledTimes(1)
    expect(copy.mock.calls[0][0]).toContain('# Coding Agent 任务：完成 pi-monorepo 的兼容处置')
    expect(copy.mock.calls[0][0]).toContain('## 安全与架构边界')
    expect(await screen.findByRole('button', { name: '提示词已复制' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('可直接粘贴到 Coding Agent')
  })

  it('keeps the action retryable when clipboard writing fails', async () => {
    installClipboard(vi.fn<StudioApi['discovery']['copy']>().mockRejectedValue(new Error('denied')))
    const user = userEvent.setup()
    render(<RemediationTaskList tasks={tasks} />)

    await user.click(screen.getByRole('button', { name: '复制给 Coding Agent' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('复制失败，请重试')
    expect(screen.getByRole('button', { name: '复制给 Coding Agent' })).toBeEnabled()
  })
})
