import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PROJECT_SCHEMA_ID, studioProjectSchema } from '../../../core/project-model'
import { defaultAgentProfile } from '../../../shared/agent-profile'
import { WorkflowSection } from './WorkflowSection'

const project = studioProjectSchema.parse({
  $schema: PROJECT_SCHEMA_ID,
  formatVersion: 2,
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Native project',
  description: '',
  revision: 0,
  profile: defaultAgentProfile,
  components: [],
  stack: { executionMode: 'external-harness', componentIds: [], capabilityOwners: [] },
  workflows: [],
  versions: [],
  createdAt: '2026-08-23T05:00:00.000Z',
  updatedAt: '2026-08-23T05:00:00.000Z',
})

const projectWithHistory = studioProjectSchema.parse({
  ...project,
  workflows: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      name: 'Historical DAG',
      description: '',
      revision: 1,
      nodes: [],
      edges: [],
      versions: [],
      createdAt: '2026-08-23T05:00:00.000Z',
      updatedAt: '2026-08-23T05:00:00.000Z',
    },
  ],
})

describe('WorkflowSection legacy boundary', () => {
  it('is read-only by default and exposes creation only after explicit migration entry', async () => {
    const user = userEvent.setup()
    render(<WorkflowSection project={projectWithHistory} run={vi.fn()} />)

    expect(screen.getByText('历史事实只读')).toBeVisible()
    expect(screen.getByText('Historical DAG')).toBeVisible()
    expect(screen.queryByRole('button', { name: '新建 Workflow' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '添加节点' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '进入旧版 Workflow 迁移工具' }))
    expect(screen.getByText('旧版迁移工具已开启')).toBeVisible()
    expect(screen.getByRole('button', { name: '新建 Workflow' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '添加节点' })).toBeEnabled()
  })
})
