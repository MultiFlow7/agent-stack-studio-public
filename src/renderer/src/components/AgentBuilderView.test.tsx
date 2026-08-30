import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  agentSetupSessionSchema,
  buildAgentSetupReadiness,
  emptyAgentSetupProfile,
  type AgentSetupSession,
  type AgentSetupView,
} from '../../../shared/agent-setup'
import type { StudioApi } from '../../../shared/ipc'
import type { HarnessProbe } from '../../../shared/native-agent'
import type { SetupCapabilityItem } from '../../../shared/setup-capability'
import { AgentBuilderView } from './AgentBuilderView'

const timestamp = '2026-08-26T08:00:00.000Z'
const setupId = '4061fbad-2152-47bc-9db3-bd70d133f2be'
const promptCapability: SetupCapabilityItem = {
  id: 'prompt:clear-assistant',
  kind: 'prompt',
  name: '清晰助手',
  summary: '先给结论，再给必要证据。',
  sourceLabel: 'Studio 内置 Prompt 模板',
  sourceDetail: '随应用版本分发的可审查文本。',
  content: '先直接回答问题。',
  support: { harnessId: 'pi', level: 'native', detail: 'Pi 直接接收 Profile Prompt。' },
}

const probes: [HarnessProbe, HarnessProbe, HarnessProbe] = [
  {
    id: 'pi',
    label: 'Pi',
    executable: 'pi',
    status: 'ready',
    version: '0.84.2',
    requiredVersion: '0.84.2',
    capabilities: {
      prompt: 'native',
      skills: 'native',
      memory: 'native',
      mcp: 'native',
      sessions: 'native',
    },
    detail: 'Pi 可用。',
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    executable: 'openclaw',
    status: 'not-installed',
    version: null,
    requiredVersion: '>=2026.1.30',
    capabilities: {
      prompt: 'native',
      skills: 'native',
      memory: 'native',
      mcp: 'native',
      sessions: 'native',
    },
    detail: 'OpenClaw 未安装。',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    executable: 'codex',
    status: 'unsupported-version',
    version: 'old',
    requiredVersion: '0.148.0-alpha.9',
    capabilities: {
      prompt: 'native',
      skills: 'native',
      memory: 'native',
      mcp: 'native',
      sessions: 'native',
    },
    detail: 'Codex 版本不受支持。',
  },
]

function session(input: Partial<AgentSetupSession> = {}): AgentSetupSession {
  return agentSetupSessionSchema.parse({
    id: setupId,
    status: 'saved',
    revision: 8,
    step: 'review',
    name: 'Ready Agent',
    description: '',
    harnessId: 'pi',
    selection: {
      harnessId: 'pi',
      providerId: 'openai',
      modelId: 'gpt-5.1',
      credentialRequirement: { method: 'api-key', credentialKind: 'api-key' },
    },
    profile: { ...emptyAgentSetupProfile, instructions: 'Use local evidence.' },
    authentication: {
      harnessId: 'pi',
      providerId: 'openai',
      authMethod: 'api-key',
      state: 'credential-valid',
      detail: '认证有效。',
      checkedAt: timestamp,
      failure: null,
    },
    verification: {
      state: 'minimal-call-succeeded',
      configurationHash: 'a'.repeat(64),
      checkedAt: timestamp,
      failure: null,
    },
    hasKeychainCredential: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input,
  })
}

function view(value: AgentSetupSession): AgentSetupView {
  return {
    session: value,
    probes,
    capabilityCatalog: {
      items: [promptCapability],
      projectComponents: { state: 'empty', message: '当前项目组件目录为空。' },
    },
    readiness: buildAgentSetupReadiness({ session: value, probe: probes[0] }),
  }
}

function installSetupApi(initial: AgentSetupSession, options: { updateFailure?: Error } = {}) {
  let current = initial
  const get = vi.fn(() => Promise.resolve(view(current)))
  const update = vi.fn<NonNullable<StudioApi['agentSetup']>['update']>((input) => {
    if (options.updateFailure) return Promise.reject(options.updateFailure)
    const { expectedRevision, capabilitySelectionIds = [], ...values } = input
    void expectedRevision
    current = session({
      ...current,
      ...values,
      capabilitySelections: capabilitySelectionIds.includes(promptCapability.id)
        ? [promptCapability]
        : [],
      revision: current.revision + 1,
    })
    return Promise.resolve(view(current))
  })
  const complete = vi.fn(() => Promise.resolve({ agentId: setupId, setupId }))
  const validateMcp = vi.fn<NonNullable<StudioApi['agentSetup']>['validateMcp']>((input) => {
    const server = current.profile.mcpServers.find(({ id }) => id === input.serverId)!
    current = session({
      ...current,
      revision: current.revision + 1,
      mcpValidations: [
        {
          serverId: server.id,
          configurationHash: 'a'.repeat(64),
          server,
          state: 'succeeded',
          transport: server.transport,
          checkedAt: timestamp,
          executable: server.command,
          toolNames: ['fixture_echo'],
          failure: null,
        },
      ],
    })
    return Promise.resolve(view(current))
  })
  window.studio = {
    agentSetup: {
      start: vi.fn(() => Promise.resolve(view(current))),
      list: vi.fn(() => Promise.resolve([])),
      get,
      update,
      save: vi.fn(() => Promise.resolve(view(current))),
      discard: vi.fn(() => Promise.resolve({ id: setupId, discarded: true })),
      configureApiKey: vi.fn(() =>
        Promise.resolve({ status: 'cancelled' as const, view: view(current) }),
      ),
      launchOfficialLogin: vi.fn(() =>
        Promise.resolve({ status: 'cancelled' as const, view: view(current) }),
      ),
      refreshAuthentication: vi.fn(() => Promise.resolve(view(current))),
      verify: vi.fn(() => Promise.resolve({ status: 'cancelled' as const, view: view(current) })),
      cancel: vi.fn(() => Promise.resolve({ cancelled: false })),
      validateMcp,
      complete,
    },
  } as unknown as StudioApi
  return { get, update, validateMcp, complete }
}

describe('AgentBuilderView', () => {
  beforeEach(() => {
    window.location.hash = ''
  })

  it('keeps optional capabilities empty without blocking a verified completion', async () => {
    const readyWithoutCapabilities = session({
      profile: emptyAgentSetupProfile,
      capabilitySelections: [],
    })
    installSetupApi(readyWithoutCapabilities)
    render(
      <AgentBuilderView
        onCompleted={vi.fn()}
        onExit={vi.fn()}
        sessionId={readyWithoutCapabilities.id}
      />,
    )

    expect(await screen.findByText('可选能力')).toBeVisible()
    expect(screen.getByText('未添加（可稍后添加）')).toBeVisible()
    expect(screen.getByRole('button', { name: '完成创建' })).toBeEnabled()
  })

  it('single-flights a ready completion and delegates the created Agent id', async () => {
    const ready = session()
    installSetupApi(ready)
    let release: ((value: { agentId: string; setupId: string }) => void) | undefined
    const complete = vi.fn(
      () =>
        new Promise<{ agentId: string; setupId: string }>((resolve) => {
          release = resolve
        }),
    )
    window.studio.agentSetup!.complete = complete
    const onCompleted = vi.fn(() => Promise.resolve())
    const user = userEvent.setup()
    render(<AgentBuilderView onCompleted={onCompleted} onExit={vi.fn()} sessionId={ready.id} />)

    const button = await screen.findByRole('button', { name: '完成创建' })
    expect(button).toBeEnabled()
    await user.dblClick(button)

    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    release?.({ agentId: setupId, setupId })
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith(setupId))
  })

  it('searches, selects, persists, and removes a catalog capability with keyboard-reachable controls', async () => {
    const capabilities = session({
      step: 'capabilities',
      profile: emptyAgentSetupProfile,
      capabilitySelections: [],
    })
    const { update } = installSetupApi(capabilities)
    const user = userEvent.setup()
    render(<AgentBuilderView onCompleted={vi.fn()} onExit={vi.fn()} sessionId={capabilities.id} />)

    expect(await screen.findByText('尚未添加能力')).toBeVisible()
    const search = screen.getByRole('searchbox', { name: '搜索能力目录' })
    await user.type(search, '清晰')
    const add = screen.getByRole('button', { name: '加入' })
    for (let index = 0; index < 12 && document.activeElement !== add; index += 1) {
      await user.tab()
    }
    expect(add).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.getByText('当前筛选结果已全部加入。可从上方已选清单移除。')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '保存并退出' }))
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ capabilitySelectionIds: [promptCapability.id] }),
      ),
    )

    await user.click(screen.getByRole('button', { name: '移除 清晰助手' }))
    expect(screen.getByText('尚未添加能力')).toBeVisible()
  })

  it('preserves local input and focuses a recoverable error when saving a step fails', async () => {
    const basics = session({
      status: 'transient',
      revision: 1,
      step: 'basics',
      name: '',
      harnessId: null,
      selection: null,
      authentication: null,
      verification: {
        state: 'not-run',
        configurationHash: null,
        checkedAt: null,
        failure: null,
      },
      hasKeychainCredential: false,
      profile: emptyAgentSetupProfile,
    })
    installSetupApi(basics, { updateFailure: new Error('草稿 revision 已变化，请重新载入。') })
    const user = userEvent.setup()
    render(<AgentBuilderView onCompleted={vi.fn()} onExit={vi.fn()} sessionId={basics.id} />)

    const name = await screen.findByLabelText('名称')
    await user.type(name, 'Unsaved local name')
    await user.click(screen.getByRole('button', { name: '下一步' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveFocus()
    expect(alert).toHaveTextContent('草稿 revision 已变化')
    expect(name).toHaveValue('Unsaved local name')
  })

  it('configures, explicitly approves, and validates a local stdio MCP without raw JSON', async () => {
    const capabilities = session({
      step: 'capabilities',
      profile: emptyAgentSetupProfile,
      capabilitySelections: [],
    })
    const { update, validateMcp } = installSetupApi(capabilities)
    const user = userEvent.setup()
    render(<AgentBuilderView onCompleted={vi.fn()} onExit={vi.fn()} sessionId={capabilities.id} />)

    await user.click(await screen.findByRole('button', { name: '添加 MCP server' }))
    await user.click(screen.getByRole('radio', { name: /本地 stdio/ }))
    await user.type(screen.getByLabelText(/^可执行文件/), '/usr/bin/env')
    await user.type(screen.getByLabelText('参数（每行一个 argv）'), 'node')
    await user.click(
      screen.getByRole('checkbox', {
        name: /我已审查并明确批准这个 server/,
      }),
    )
    await user.click(screen.getByRole('button', { name: '测试连接与工具发现' }))

    await waitFor(() => expect(validateMcp).toHaveBeenCalledTimes(1))
    const lastUpdate = update.mock.calls.at(-1)?.[0]
    expect(lastUpdate?.profile.mcpServers).toHaveLength(1)
    expect(lastUpdate?.profile.mcpServers[0]).toMatchObject({
      transport: 'stdio',
      command: '/usr/bin/env',
      args: ['node'],
      approval: 'approved',
    })
    expect(await screen.findByText(/fixture_echo/)).toBeVisible()
    expect(screen.queryByText(/schema 校验的 JSON/)).not.toBeInTheDocument()
  })
})
