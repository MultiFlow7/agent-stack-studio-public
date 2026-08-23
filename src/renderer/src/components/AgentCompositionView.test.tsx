import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../shared/ipc'
import type { StudioProjectState } from '../../../shared/studio-project'
import { AgentCompositionView } from './AgentCompositionView'

vi.mock('./StackEditorView', () => ({
  StackEditorView: () => <div>Stack editor</div>,
}))
vi.mock('./WorkflowSection', () => ({
  WorkflowSection: () => <div>Workflow</div>,
}))
vi.mock('./RemediationTaskList', () => ({
  RemediationTaskList: () => null,
}))

describe('AgentCompositionView compatibility actions', () => {
  it('runs static inspection and makes a cancelled source relink visible', async () => {
    const agentId = '0e165209-5ae2-43da-a3af-e54fb5929056'
    const componentId = '6076f96c-8d5f-418f-aefd-b3f0cb5d831b'
    const state = {
      projectPath: '/trusted/project/.agent-stack',
      localAgentId: agentId,
      project: { revision: 11 },
      validation: {
        status: 'blocked',
        issues: [
          {
            severity: 'error',
            code: 'COMPATIBILITY_UNKNOWN',
            message: '重复的兼容问题投影不应再次显示。',
            componentId,
            capability: null,
            suggestedActions: ['前往组件处置。'],
          },
        ],
        remediationTasks: [],
        assessments: [
          {
            componentId,
            status: 'evidence-required',
            explanation: '静态检查完成，仍缺能力替换边界。',
            blockers: [],
            evidence: [],
            checkedAt: '2026-08-22T12:00:00.000Z',
            method: 'static-descriptor-v2',
            suggestedActions: [
              {
                id: 'recheck-static',
                action: 'recheck-static',
                label: '重新静态检查',
                description: '重新读取本地来源。',
                presentation: 'button',
                enabled: true,
              },
            ],
          },
        ],
      },
    } as unknown as StudioProjectState
    const recheckComponent = vi.fn().mockResolvedValue(state)
    window.studio = {
      studioProject: {
        current: vi.fn().mockResolvedValue(state),
        recheckComponent,
        onExternalChanged: vi.fn().mockReturnValue(() => undefined),
      },
    } as unknown as StudioApi
    const user = userEvent.setup()
    render(<AgentCompositionView agentId={agentId} onChanged={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: '兼容处置尚未完成' })).toBeVisible()
    const assessmentLabel = screen.getByText('静态检查完成，待补充证据')
    expect(assessmentLabel.closest('li')).toHaveClass('project-validation__item--warning')
    expect(screen.getByText(/安全静态检查/)).toBeVisible()
    expect(screen.queryByText('重复的兼容问题投影不应再次显示。')).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: '重新静态检查' }))
    expect(recheckComponent).toHaveBeenCalledWith({ componentId, expectedRevision: 11 })
    const feedback = await screen.findByRole('status')
    expect(feedback).toHaveTextContent('已取消重新关联，项目与兼容证据均未改动。')
    await waitFor(() => expect(feedback).toHaveFocus())
  })
})
