import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { StudioApi } from '../../../shared/ipc'
import { studioProjectStateSchema, type StudioProjectState } from '../../../shared/studio-project'
import { builtInComponents } from '../../../main/components/built-in-components'
import { StudioProjectView } from './StudioProjectView'

function projectState(revision = 4): StudioProjectState {
  const now = '2026-08-20T08:00:00.000Z'
  const projectId = randomUUID()
  const components = builtInComponents.slice(0, 2).map((fixture) => ({
    id: fixture.id,
    descriptor: fixture.descriptor,
    evidenceLevel: 'declared' as const,
    source: {
      path: `/tmp/${fixture.descriptor.id}`,
      manifestPath: `/tmp/${fixture.descriptor.id}/agent-stack.component.json`,
      readmePath: null,
      licensePath: null,
      git: { remote: null, commit: null, status: 'unavailable' as const },
      files: ['agent-stack.component.json'],
      contentHash: 'a'.repeat(64),
      inspectedAt: now,
    },
    archivedAt: null,
    importedAt: now,
    updatedAt: now,
  }))
  return studioProjectStateSchema.parse({
    projectPath: '/tmp/shared/.agent-stack',
    project: {
      $schema: 'https://agentstack.studio/schemas/project-v2.json',
      formatVersion: 2,
      id: projectId,
      name: '共享 Fixture',
      description: '',
      revision,
      components,
      stack: {
        executionMode: 'agent-loop',
        componentIds: components.map(({ id }) => id),
        capabilityOwners: [],
      },
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
          code: 'OWNER_REQUIRED',
          message: 'prompt-policy 需要 Owner。',
          componentId: null,
          capability: 'prompt-policy',
          suggestedActions: ['设置 Owner。'],
        },
      ],
      remediationTasks: [],
      runtimePlanHash: null,
      checkedAt: now,
    },
    changedExternally: false,
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
    cliPath:
      '/Applications/Agent Stack Studio.app/Contents/Resources/app.asar.unpacked/dist/cli/studio.mjs',
  })
}

describe('StudioProjectView', () => {
  it('reads shared project state, sends revision-aware Owner changes, and freezes only after validation', async () => {
    const state = projectState()
    const ready = structuredClone(state)
    ready.project!.revision += 1
    ready.validation = {
      status: 'ready',
      revision: ready.project!.revision,
      issues: [],
      remediationTasks: [],
      runtimePlanHash: 'b'.repeat(64),
      checkedAt: '2026-08-20T08:01:00.000Z',
    }
    const setOwner = vi.fn().mockResolvedValue(ready)
    window.studio = {
      studioProject: {
        current: vi.fn().mockResolvedValue(state),
        setOwner,
        freeze: vi.fn().mockResolvedValue(ready),
        onExternalChanged: vi.fn().mockReturnValue(() => undefined),
      },
    } as unknown as StudioApi
    const user = userEvent.setup()
    render(<StudioProjectView />)

    expect(await screen.findByRole('heading', { name: '共享 Fixture' })).toBeInTheDocument()
    expect(screen.getByText('SHA-256 已验证 0 个版本')).toBeVisible()
    expect(screen.getByRole('button', { name: '冻结版本' })).toBeDisabled()
    const owner = within(screen.getByRole('group', { name: /Prompt 策略/ })).getByRole('radio', {
      name: '本地 Harness X',
    })
    await user.click(owner)
    await waitFor(() =>
      expect(setOwner).toHaveBeenCalledWith(
        expect.objectContaining({ capability: 'prompt-policy', expectedRevision: 4 }),
      ),
    )
    expect(screen.getByRole('button', { name: '冻结版本' })).toBeEnabled()
  })

  it('creates and edits a structured Workflow through revision-aware GUI IPC', async () => {
    const initial = projectState(4)
    const workflowId = randomUUID()
    const created = structuredClone(initial)
    created.project!.revision = 5
    created.project!.workflows = [
      {
        id: workflowId,
        name: 'GUI DAG',
        description: '结构化定义',
        revision: 0,
        nodes: [],
        edges: [],
        versions: [],
        createdAt: '2026-08-20T08:00:00.000Z',
        updatedAt: '2026-08-20T08:00:00.000Z',
      },
    ]
    const withNode = structuredClone(created)
    withNode.project!.revision = 6
    withNode.project!.workflows[0].revision = 1
    withNode.project!.workflows[0].nodes = [
      { id: randomUUID(), name: '准备输入', kind: 'operation', operation: 'prepare-input' },
    ]
    const createWorkflow = vi.fn().mockResolvedValue(created)
    const addWorkflowNode = vi.fn().mockResolvedValue(withNode)
    window.studio = {
      studioProject: {
        current: vi.fn().mockResolvedValue(initial),
        createWorkflow,
        addWorkflowNode,
        onExternalChanged: vi.fn().mockReturnValue(() => undefined),
      },
    } as unknown as StudioApi
    const user = userEvent.setup()
    render(<StudioProjectView />)

    await user.click(await screen.findByRole('button', { name: '新建 Workflow' }))
    await user.type(screen.getByRole('textbox', { name: '名称' }), 'GUI DAG')
    await user.type(screen.getByRole('textbox', { name: '说明' }), '结构化定义')
    await user.click(screen.getByRole('button', { name: '创建草稿' }))
    await waitFor(() =>
      expect(createWorkflow).toHaveBeenCalledWith({
        name: 'GUI DAG',
        description: '结构化定义',
        expectedRevision: 4,
      }),
    )

    await user.click(screen.getByRole('button', { name: '添加节点' }))
    await user.type(screen.getByRole('textbox', { name: '节点名称' }), '准备输入')
    await user.type(screen.getByRole('textbox', { name: '操作标识' }), 'prepare-input')
    await user.click(screen.getByRole('button', { name: '保存节点' }))
    await waitFor(() =>
      expect(addWorkflowNode).toHaveBeenCalledWith({
        workflowId,
        node: { kind: 'operation', name: '准备输入', operation: 'prepare-input' },
        expectedRevision: 5,
      }),
    )
    expect(await screen.findByRole('list', { name: 'GUI DAG 只读 DAG 图示' })).toHaveTextContent(
      '准备输入',
    )
  })

  it('shows direct-cycle failure, keeps the DAG, and supports cancelling inline edits', async () => {
    const state = projectState(8)
    const workflowId = randomUUID()
    const first = randomUUID()
    const second = randomUUID()
    state.project!.workflows = [
      {
        id: workflowId,
        name: '循环保护',
        description: '',
        revision: 3,
        nodes: [
          { id: first, name: '开始', kind: 'operation', operation: 'start' },
          { id: second, name: '结束', kind: 'operation', operation: 'finish' },
        ],
        edges: [{ id: randomUUID(), from: first, to: second }],
        versions: [],
        createdAt: '2026-08-20T08:00:00.000Z',
        updatedAt: '2026-08-20T08:03:00.000Z',
      },
    ]
    const addWorkflowEdge = vi
      .fn()
      .mockRejectedValue(new Error('保存被拒绝：Workflow DAG 检测到直接循环。'))
    window.studio = {
      studioProject: {
        current: vi.fn().mockResolvedValue(state),
        addWorkflowEdge,
        onExternalChanged: vi.fn().mockReturnValue(() => undefined),
      },
    } as unknown as StudioApi
    const user = userEvent.setup()
    render(<StudioProjectView />)

    await user.click(await screen.findByRole('button', { name: '添加节点' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('textbox', { name: '节点名称' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '添加连线' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '起点' }), second)
    await user.selectOptions(screen.getByRole('combobox', { name: '终点' }), first)
    await user.click(screen.getByRole('button', { name: '保存连线' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Workflow DAG 检测到直接循环')
    expect(screen.getByRole('list', { name: '循环保护 只读 DAG 图示' })).toHaveTextContent('开始')
  })

  it('refreshes when the CLI changes the project file and explains the external revision', async () => {
    const initial = projectState(4)
    const afterGui = structuredClone(initial)
    afterGui.project!.revision = 5
    afterGui.project!.stack.componentIds = afterGui.project!.stack.componentIds.slice(1)
    const external = projectState(6)
    const current = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(external)
    let notify: () => void = () => undefined
    window.studio = {
      studioProject: {
        current,
        removeFromStack: vi.fn().mockResolvedValue(afterGui),
        onExternalChanged: vi.fn((callback: () => void) => {
          notify = callback
          return () => undefined
        }),
      },
    } as unknown as StudioApi
    const user = userEvent.setup()
    render(<StudioProjectView />)
    await screen.findByText('revision 4')
    await user.click(screen.getAllByRole('button', { name: '从 Stack 移除' })[0])
    expect(await screen.findByText('组件已从 Stack 移除。')).toBeVisible()
    notify()
    expect(await screen.findByText(/界面已刷新到 revision 6/)).toBeInTheDocument()
    expect(screen.queryByText('组件已从 Stack 移除。')).not.toBeInTheDocument()
  })

  it('cancels Component deletion without a write and then confirms a revision-aware deletion', async () => {
    const initial = projectState(4)
    initial.project!.stack.componentIds = []
    const component = initial.project!.components[0]
    const deleted = structuredClone(initial)
    deleted.project!.revision = 5
    deleted.project!.components = deleted.project!.components.filter(
      ({ id }) => id !== component.id,
    )
    const deleteComponent = vi.fn().mockResolvedValue(deleted)
    window.studio = {
      studioProject: {
        current: vi.fn().mockResolvedValue(initial),
        deleteComponent,
        onExternalChanged: vi.fn().mockReturnValue(() => undefined),
      },
    } as unknown as StudioApi
    const user = userEvent.setup()
    render(<StudioProjectView />)

    const open = await screen.findByRole('button', { name: `删除 ${component.descriptor.name}` })
    await user.click(open)
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(deleteComponent).not.toHaveBeenCalled()
    expect(screen.getByText(component.descriptor.name)).toBeVisible()

    await user.click(screen.getByRole('button', { name: `删除 ${component.descriptor.name}` }))
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() =>
      expect(deleteComponent).toHaveBeenCalledWith({
        componentId: component.id,
        expectedRevision: 4,
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('未引用组件已删除')
    expect(screen.queryByText(component.descriptor.name)).not.toBeInTheDocument()
  })

  it('keeps a Component visible when immutable history rejects permanent deletion', async () => {
    const initial = projectState(9)
    initial.project!.stack.componentIds = []
    const component = initial.project!.components[0]
    const deleteComponent = vi
      .fn()
      .mockRejectedValue(new Error('组件仍被不可变版本 1 引用，不能永久删除。'))
    window.studio = {
      studioProject: {
        current: vi.fn().mockResolvedValue(initial),
        deleteComponent,
        onExternalChanged: vi.fn().mockReturnValue(() => undefined),
      },
    } as unknown as StudioApi
    const user = userEvent.setup()
    render(<StudioProjectView />)

    await user.click(
      await screen.findByRole('button', { name: `删除 ${component.descriptor.name}` }),
    )
    await user.click(screen.getByRole('button', { name: '确认删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('不可变版本 1 引用')
    expect(screen.getByText(component.descriptor.name)).toBeVisible()
  })

  it('makes backup recovery visible before the user continues editing', async () => {
    const recovered = projectState(6)
    recovered.recovered = true
    window.studio = {
      studioProject: {
        current: vi.fn().mockResolvedValue(recovered),
        onExternalChanged: vi.fn().mockReturnValue(() => undefined),
      },
    } as unknown as StudioApi

    render(<StudioProjectView />)
    expect(await screen.findByRole('alert')).toHaveTextContent('项目已从最后有效备份恢复')
    expect(screen.getByText(/.agent-stack.invalid-/)).toBeVisible()
  })

  it('exports a portable package through Main and reports its integrity hash', async () => {
    const exportProject = vi.fn().mockResolvedValue({
      status: 'exported',
      path: '/Users/tester/Exports/shared.agent-stack-package.json',
      packageHash: 'a'.repeat(64),
      projectRevision: 4,
      componentCount: 2,
      workflowCount: 0,
      versionCount: 0,
      excludedContent: [
        'keychain-secrets',
        'sqlite-local-index',
        'runs-and-experiments',
        'receipts-and-remote-mappings',
        'artifacts-and-logs',
        'absolute-local-paths',
      ],
    })
    window.studio = {
      studioProject: {
        current: vi.fn().mockResolvedValue(projectState()),
        export: exportProject,
        onExternalChanged: vi.fn().mockReturnValue(() => undefined),
      },
    } as unknown as StudioApi
    const user = userEvent.setup()
    render(<StudioProjectView />)

    await user.click(await screen.findByRole('button', { name: '导出项目包' }))
    expect(exportProject).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('status')).toHaveTextContent(
      'shared.agent-stack-package.json（0 个 Workflow，SHA-256 aaaaaaaaaaaa…）',
    )
    expect(screen.getByText(/Keychain 密钥/)).toBeVisible()
  })

  it('keeps cancellation non-destructive and exposes export failures', async () => {
    const exportProject = vi
      .fn()
      .mockResolvedValueOnce({ status: 'cancelled' })
      .mockRejectedValueOnce(new Error('项目包含不可移植的本机路径。'))
    window.studio = {
      studioProject: {
        current: vi.fn().mockResolvedValue(projectState()),
        export: exportProject,
        onExternalChanged: vi.fn().mockReturnValue(() => undefined),
      },
    } as unknown as StudioApi
    const user = userEvent.setup()
    render(<StudioProjectView />)

    const button = await screen.findByRole('button', { name: '导出项目包' })
    await user.click(button)
    expect(await screen.findByText('已取消导出，项目未发生变化。')).toBeVisible()
    await user.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('项目包含不可移植的本机路径')
  })
})
