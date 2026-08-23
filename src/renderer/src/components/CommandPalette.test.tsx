import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../shared/ipc'
import { CommandPalette } from './CommandPalette'

describe('CommandPalette', () => {
  it('searches local metadata and executes the selected result from the keyboard', async () => {
    const search = vi.fn<StudioApi['commandCenter']['search']>(({ query }) =>
      Promise.resolve(
        query
          ? [
              {
                id: 'agent:92d74aaf-b86c-4e84-978b-b35d227e0c79',
                category: 'agent',
                label: 'Research Agent',
                detail: 'Agent · 草稿修订 4',
                destination: {
                  kind: 'agent',
                  agentId: '92d74aaf-b86c-4e84-978b-b35d227e0c79',
                },
              },
            ]
          : [],
      ),
    )
    window.studio = { commandCenter: { search } } as unknown as StudioApi
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<CommandPalette onClose={vi.fn()} onSelect={onSelect} />)

    const input = screen.getByRole('combobox', { name: '搜索本地工作空间' })
    expect(input).toHaveFocus()
    await user.type(input, 'Research')
    expect(await screen.findByRole('option', { name: /Research Agent/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'agent',
      agentId: '92d74aaf-b86c-4e84-978b-b35d227e0c79',
    })
    expect(search).toHaveBeenLastCalledWith({ query: 'Research' })
  })

  it('covers empty, failure and Escape cancellation states', async () => {
    const search = vi
      .fn<StudioApi['commandCenter']['search']>()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('本地索引暂时不可用。'))
    window.studio = { commandCenter: { search } } as unknown as StudioApi
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<CommandPalette onClose={onClose} onSelect={vi.fn()} />)

    expect(await screen.findByText('没有匹配的本地内容或操作。')).toBeVisible()
    rerender(<CommandPalette key="retry" onClose={onClose} onSelect={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('本地索引暂时不可用。')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
