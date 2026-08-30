import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { studioProjectSchema, stableHash } from '../../../core/project-model'
import { knownHarnesses } from '../../../core/known-harnesses'
import type { ProjectComponent } from '../../../core/project-model'
import type { StudioApi } from '../../../shared/ipc'
import type { StudioProjectState } from '../../../shared/studio-project'
import type { ProjectProfileInput } from '../../../shared/studio-project'
import type { NativeAgentResult, NativeAgentUiExecuteInput } from '../../../shared/native-agent'
import { harnessModelCapability } from '../../../shared/model-auth'
import { modelAuthViewSchema, type ModelAuthView } from '../../../shared/model-auth-ipc'
import { NativeAgentPanel } from './NativeAgentPanel'

const createdAt = '2026-08-23T01:00:00.000Z'

function state(revision: number, withPi: boolean): StudioProjectState {
  const component: ProjectComponent = {
    id: knownHarnesses.pi.id,
    descriptor: knownHarnesses.pi.descriptor,
    evidenceLevel: 'contract-tested',
    source: {
      path: `studio-builtin:${knownHarnesses.pi.id}`,
      manifestPath: null,
      readmePath: null,
      licensePath: null,
      git: { remote: null, commit: null, status: 'unavailable' },
      files: [],
      contentHash: stableHash(knownHarnesses.pi.descriptor),
      inspectedAt: createdAt,
    },
    archivedAt: null,
    importedAt: createdAt,
    updatedAt: createdAt,
  }
  const project = studioProjectSchema.parse({
    $schema: 'https://agentstack.studio/schemas/project-v2.json',
    formatVersion: 2,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Native UI Agent',
    description: '',
    revision,
    profile: {
      instructions: '',
      memoryMarkdown: '',
      skills: [],
      mcpServers: [],
      toolPolicy: 'read-only',
    },
    components: withPi ? [component] : [],
    stack: {
      executionMode: withPi ? 'external-harness' : 'agent-loop',
      componentIds: withPi ? [component.id] : [],
      capabilityOwners: withPi
        ? component.descriptor.provides.map(({ capability }) => ({
            capability,
            componentId: component.id,
          }))
        : [],
    },
    workflows: [],
    versions: [],
    createdAt,
    updatedAt: createdAt,
  })
  return {
    projectPath: '/test/.agent-stack',
    localAgentId: null,
    project,
    validation: null,
    integrity: null,
    recovered: false,
    changedExternally: false,
    cliPath: '/test/studio',
  }
}

function modelAuthView(ready: boolean): ModelAuthView {
  const configuration = {
    providerId: 'openai',
    modelId: 'gpt-5.5',
    credentialRequirement: { method: 'api-key' as const, credentialKind: 'api-key' as const },
  }
  return modelAuthViewSchema.parse({
    harness: { id: 'pi', label: 'Pi' },
    capability: harnessModelCapability('pi'),
    probe: {
      id: 'pi',
      label: 'Pi',
      executable: 'pi',
      status: 'ready',
      version: '0.84.2',
      requiredVersion: '0.84.2',
      capabilities: {
        prompt: 'native',
        skills: 'native',
        memory: 'adapted',
        mcp: 'adapted',
        sessions: 'native',
      },
      detail: 'Pi 可执行。',
    },
    selection: configuration,
    readiness: {
      state: ready ? 'minimal-call-succeeded' : 'unauthenticated',
      ready,
      stackCompatible: true,
      harnessExecutable: true,
      configuration,
      authentication: ready
        ? {
            harnessId: 'pi',
            providerId: 'openai',
            authMethod: 'api-key',
            state: 'credential-valid',
            detail: 'API Key 有效。',
            checkedAt: createdAt,
            failure: null,
          }
        : null,
      verification: ready
        ? {
            state: 'minimal-call-succeeded',
            configurationHash: '0'.repeat(64),
            checkedAt: createdAt,
            failure: null,
          }
        : { state: 'not-run', configurationHash: null, checkedAt: null, failure: null },
      blockers: ready
        ? []
        : [
            {
              code: 'authentication-required',
              message: '当前 Mac 尚未完成 Pi 模型认证。',
              recoveryAction: '在 Agent 构建中配置 API Key。',
            },
          ],
    },
  })
}

describe('NativeAgentPanel', () => {
  it('selects a Harness, saves Profile facts, and chats from the keyboard', async () => {
    let current = state(0, false)
    const selectHarness = vi.fn(() => {
      current = state(1, true)
      return Promise.resolve(current)
    })
    const updateProfile = vi.fn((input: ProjectProfileInput) => {
      current = {
        ...current,
        project: { ...current.project!, revision: 2, profile: input.profile },
      }
      return Promise.resolve(current)
    })
    const execute = vi.fn(
      (input: NativeAgentUiExecuteInput): Promise<NativeAgentResult> =>
        Promise.resolve({
          id: input.requestId!,
          kind: input.kind,
          projectId: current.project!.id,
          projectRevision: current.project!.revision,
          projectHash: stableHash(current.project),
          harness: 'pi',
          harnessVersion: '0.84.2',
          sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          status: 'succeeded',
          responseMarkdown: 'Harness 模拟模型层回复',
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          modelLayer: {
            kind: 'codex-simulation',
            provider: 'studio-codex-simulation',
            model: 'codex-simulation',
          },
          degradedFeatures: [],
          failure: null,
          startedAt: createdAt,
          finishedAt: createdAt,
        }),
    )
    window.studio = {
      studioProject: {
        current: vi.fn(() => Promise.resolve(current)),
        selectHarness,
        updateProfile,
      },
      nativeAgent: {
        probes: vi.fn(() =>
          Promise.resolve([
            {
              id: 'pi' as const,
              label: 'Pi',
              executable: 'pi',
              status: 'ready' as const,
              version: '0.84.2',
              requiredVersion: '0.84.2',
              capabilities: {
                prompt: 'native' as const,
                skills: 'native' as const,
                memory: 'adapted' as const,
                mcp: 'adapted' as const,
                sessions: 'native' as const,
              },
              detail: 'Pi 可运行。',
            },
          ]),
        ),
        execute,
        list: vi.fn(() => Promise.resolve([])),
        cancel: vi.fn(() => Promise.resolve({ cancelled: true })),
      },
      modelAuth: {
        status: vi.fn(() => Promise.resolve(modelAuthView(true))),
      },
    } as unknown as StudioApi

    const user = userEvent.setup()
    render(<NativeAgentPanel firstChat />)
    expect(await screen.findByText('Agent 已创建 · 开始首次聊天')).toBeVisible()
    expect(screen.getByLabelText('消息')).toHaveFocus()
    const pi = await screen.findByRole('button', { name: /Pi.*0.84.2.*可运行/s })
    pi.focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(selectHarness).toHaveBeenCalledWith({ harnessId: 'pi', expectedRevision: 0 }),
    )

    await user.type(screen.getByLabelText('Agent Prompt'), '只回答事实。')
    await user.type(screen.getByLabelText('Markdown Memory'), '# Memory')
    await user.type(screen.getByLabelText('主要 Skill（Markdown）'), '# Review')
    const save = screen.getByRole('button', { name: '保存 Agent 配置' })
    save.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1))
    const savedProfile = updateProfile.mock.calls[0]?.[0]
    expect(savedProfile?.expectedRevision).toBe(1)
    expect(savedProfile?.profile.instructions).toBe('只回答事实。')

    const send = screen.getByRole('button', { name: '发送' })
    send.focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ kind: 'chat' })),
    )
    expect(await screen.findByText('Harness 模拟模型层回复')).toBeVisible()
    expect(
      screen.getByText('Codex simulation 测试模型层 · 不代表 Harness 原生 Provider 认证'),
    ).toBeVisible()
    expect(screen.getByText('Agent 就绪')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'MCP servers' })).toBeVisible()
    expect(screen.queryByText(/schema 校验的 JSON/)).not.toBeInTheDocument()
  })

  it('keeps Chat and Run disabled when only the Harness executable probe is ready', async () => {
    const current = state(1, true)
    window.studio = {
      studioProject: {
        current: vi.fn(() => Promise.resolve(current)),
      },
      nativeAgent: {
        probes: vi.fn(() => Promise.resolve([modelAuthView(false).probe!])),
        execute: vi.fn(),
        list: vi.fn(() => Promise.resolve([])),
        cancel: vi.fn(() => Promise.resolve({ cancelled: true })),
      },
      modelAuth: {
        status: vi.fn(() => Promise.resolve(modelAuthView(false))),
      },
    } as unknown as StudioApi

    render(<NativeAgentPanel />)

    expect(await screen.findByText('Harness 可执行 · 模型未就绪')).toBeVisible()
    expect(screen.getByText('当前 Mac 尚未完成 Pi 模型认证。')).toBeVisible()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  })

  it('labels post-create readiness projection as loading before enabling first chat', async () => {
    const current = state(1, true)
    let resolveStatus: ((view: ModelAuthView) => void) | undefined
    window.studio = {
      studioProject: {
        current: vi.fn(() => Promise.resolve(current)),
      },
      nativeAgent: {
        probes: vi.fn(() => Promise.resolve([modelAuthView(true).probe!])),
        execute: vi.fn(),
        list: vi.fn(() => Promise.resolve([])),
        cancel: vi.fn(() => Promise.resolve({ cancelled: true })),
      },
      modelAuth: {
        status: vi.fn(
          () =>
            new Promise<ModelAuthView>((resolve) => {
              resolveStatus = resolve
            }),
        ),
      },
    } as unknown as StudioApi

    render(<NativeAgentPanel firstChat />)

    expect(await screen.findByText('正在核对创建结果与本机模型就绪状态…')).toBeVisible()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    resolveStatus?.(modelAuthView(true))

    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled())
    expect(screen.queryByText('正在核对创建结果与本机模型就绪状态…')).not.toBeInTheDocument()
    expect(screen.getByLabelText('消息')).toHaveFocus()
  })
})
