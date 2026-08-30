import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentDetail, AgentVersion } from '../../../shared/agent-detail'
import type { AgentStatusProjection } from '../../../shared/agent-status'
import type { StudioApi } from '../../../shared/ipc'
import { harnessModelCapability } from '../../../shared/model-auth'
import { modelAuthViewSchema, type ModelAuthView } from '../../../shared/model-auth-ipc'
import { AgentDetailView } from './AgentDetailView'

vi.mock('./AgentCompositionView', () => ({
  AgentCompositionView: () => <div>模型与认证配置</div>,
}))

const agentId = '92d74aaf-b86c-4e84-978b-b35d227e0c79'
const createdAt = '2026-08-26T04:00:00.000Z'

const detail: AgentDetail = {
  agent: {
    id: agentId,
    name: 'Research Agent',
    description: 'Runs local evaluations.',
    executionMode: 'external-harness',
    archivedAt: null,
    createdAt,
    updatedAt: createdAt,
  },
  draft: { agentId, executionMode: 'external-harness', revision: 3, updatedAt: createdAt },
  versions: [],
  location: {
    workspacePath: '/tmp/research-agent',
    sourceKind: 'local-import',
    sourcePath: '/tmp/research-agent/.agent-stack',
  },
}

const status: AgentStatusProjection = {
  agent: detail.agent,
  draftRevision: 3,
  currentVersion: null,
  stack: { status: 'ready', componentCount: 2, ownerCount: 1, issueCount: 0 },
  latestRun: null,
  latestExperiment: null,
  latestPublish: null,
}

function modelStatus(ready: boolean): ModelAuthView {
  const configuration = {
    providerId: 'openai',
    modelId: 'gpt-5.5',
    credentialRequirement: { method: 'api-key' as const, credentialKind: 'api-key' as const },
  }
  const failure = {
    code: 'credential-invalid' as const,
    message: 'API Key 无效，未执行冻结。',
    recoveryAction: '替换 API Key 后重新验证模型连接。',
    retryable: true,
  }
  return modelAuthViewSchema.parse({
    harness: { id: 'pi', label: 'Pi' },
    capability: harnessModelCapability('pi'),
    probe: null,
    selection: configuration,
    readiness: {
      state: ready ? 'minimal-call-succeeded' : 'credential-invalid',
      ready,
      stackCompatible: true,
      harnessExecutable: true,
      configuration,
      authentication: {
        harnessId: 'pi',
        providerId: 'openai',
        authMethod: 'api-key',
        state: ready ? 'credential-valid' : 'credential-invalid',
        detail: ready ? 'API Key 有效。' : 'API Key 无效。',
        checkedAt: createdAt,
        failure: ready ? null : failure,
      },
      verification: ready
        ? {
            state: 'minimal-call-succeeded',
            configurationHash: '0'.repeat(64),
            checkedAt: createdAt,
            failure: null,
          }
        : {
            state: 'credential-invalid',
            configurationHash: null,
            checkedAt: createdAt,
            failure,
          },
      blockers: ready
        ? []
        : [
            {
              code: failure.code,
              message: failure.message,
              recoveryAction: failure.recoveryAction,
            },
          ],
    },
  })
}

function installDetailApi(readiness: ModelAuthView, version?: AgentVersion) {
  const createVersion = vi.fn<StudioApi['agents']['createVersion']>(() => {
    if (!version) return Promise.reject(new Error('不应执行冻结。'))
    return Promise.resolve(version)
  })
  window.studio = {
    agents: {
      status: vi.fn(() => Promise.resolve(status)),
      get: vi.fn(() => Promise.resolve({ ...detail, versions: version ? [version] : [] })),
      createVersion,
    },
    modelAuth: {
      status: vi.fn(() => Promise.resolve(readiness)),
    },
  } as unknown as StudioApi
  return createVersion
}

describe('AgentDetailView model readiness freeze gate', () => {
  it('focuses the first concrete blocker and offers a direct recovery route', async () => {
    const createVersion = installDetailApi(modelStatus(false))
    const user = userEvent.setup()
    render(
      <AgentDetailView
        initialDetail={detail}
        initialStatus={status}
        onBack={vi.fn()}
        onChanged={vi.fn()}
        onLifecycle={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '冻结 Agent Version' }))

    const blocker = await screen.findByRole('alert')
    await waitFor(() => expect(blocker).toHaveFocus())
    expect(blocker).toHaveTextContent('API Key 无效，未执行冻结。')
    expect(blocker).toHaveTextContent('替换 API Key 后重新验证模型连接。')
    expect(createVersion).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '前往模型与认证' }))
    const stackTab = screen.getByRole('tab', { name: 'Harness 与组件' })
    expect(stackTab).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(stackTab).toHaveFocus())
  })

  it('rechecks aggregate readiness immediately before freezing and focuses success feedback', async () => {
    const version: AgentVersion = {
      id: '3b129300-9e8a-4a70-ae02-e2dc1cba565e',
      agentId,
      versionNumber: 1,
      snapshot: {
        kind: 'project-reference',
        projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        projectVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        projectRevision: 3,
      },
      contentHash: '0'.repeat(64),
      createdAt,
    }
    const createVersion = installDetailApi(modelStatus(true), version)
    const user = userEvent.setup()
    render(
      <AgentDetailView
        initialDetail={detail}
        initialStatus={status}
        onBack={vi.fn()}
        onChanged={vi.fn(() => Promise.resolve())}
        onLifecycle={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '冻结 Agent Version' }))

    await waitFor(() => expect(createVersion).toHaveBeenCalledWith(agentId))
    const feedback = await screen.findByRole('status')
    expect(feedback).toHaveTextContent('已冻结不可变 Agent Version 1。')
    await waitFor(() => expect(feedback).toHaveFocus())
  })
})
