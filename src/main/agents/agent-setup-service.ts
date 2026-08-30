import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { StudioCore } from '../../core/studio-core'
import { StudioCoreError } from '../../core/project-errors'
import {
  defaultKeychainService,
  type KeychainAdapter,
} from '../../adapters/keychain/macos-keychain-adapter'
import type { ModelAuthGateway } from '../model-auth/model-auth-service'
import { modelAuthConfigurationHash } from '../model-auth/model-auth-service'
import {
  agentSetupCompleteResultSchema,
  agentSetupDiscardResultSchema,
  agentSetupSaveInputSchema,
  agentSetupUpdateInputSchema,
  agentSetupViewSchema,
  agentSetupSteps,
  buildAgentSetupReadiness,
  type AgentSetupSession,
  type ParsedAgentSetupUpdateInput,
  type AgentSetupUpdateInput,
  type AgentSetupView,
} from '../../shared/agent-setup'
import {
  assertSupportedModelSelection,
  modelAuthenticationStatusSchema,
  type HarnessModelSelection,
} from '../../shared/model-auth'
import type { AgentSetupRepository } from '../persistence/agent-setup-repository'
import type { AgentRepository } from '../persistence/agent-repository'
import type { WorkspaceService } from '../workspace/workspace-service'
import type { StudioProjectService } from '../projects/studio-project-service'
import { knownInstallRecipes } from '../../core/install-recipes'
import { stableHash } from '../../core/project-model'
import {
  builtInSetupCapabilityTemplates,
  setupCapabilityCatalogSchema,
  setupCapabilityItemSchema,
  type SetupCapabilityCatalog,
  type SetupCapabilityItem,
} from '../../shared/setup-capability'
import type { CustomizationInstallResult } from '../../shared/customization'
import { mcpTransportSupport, type McpValidationInput } from '../../shared/mcp'
import { McpRuntime, McpRuntimeError } from '../../adapters/mcp/mcp-runtime'

interface AgentSetupCapabilityInstaller {
  install(input: {
    projectPath: string
    recipeId: string
    harnessId: HarnessModelSelection['harnessId']
    expectedRevision: number
    confirmed: true
  }): Promise<CustomizationInstallResult>
}

const MODEL_TIMEOUT_MS = 30_000

export class AgentSetupService {
  readonly #setups: AgentSetupRepository
  readonly #agents: AgentRepository
  readonly #workspaces: WorkspaceService
  readonly #projects: StudioProjectService
  readonly #core: StudioCore
  readonly #gateway: ModelAuthGateway
  readonly #keychain: KeychainAdapter
  readonly #setupRoot: string
  readonly #capabilityInstaller: AgentSetupCapabilityInstaller | null
  readonly #mcp: McpRuntime
  readonly #operations = new Map<string, Promise<unknown>>()
  readonly #completed = new Map<string, { agentId: string; setupId: string }>()
  readonly #verificationControllers = new Map<string, AbortController>()

  constructor(options: {
    setups: AgentSetupRepository
    agents: AgentRepository
    workspaces: WorkspaceService
    projects: StudioProjectService
    core: StudioCore
    gateway: ModelAuthGateway
    keychain: KeychainAdapter
    setupRoot: string
    capabilityInstaller?: AgentSetupCapabilityInstaller
    mcp?: McpRuntime
  }) {
    this.#setups = options.setups
    this.#agents = options.agents
    this.#workspaces = options.workspaces
    this.#projects = options.projects
    this.#core = options.core
    this.#gateway = options.gateway
    this.#keychain = options.keychain
    this.#setupRoot = options.setupRoot
    this.#capabilityInstaller = options.capabilityInstaller ?? null
    this.#mcp = options.mcp ?? new McpRuntime()
  }

  async cleanupTransient(): Promise<void> {
    for (const session of this.#setups.listTransient()) {
      await this.#discard(session).catch(() => undefined)
    }
  }

  async start(): Promise<AgentSetupView> {
    return this.#view(this.#setups.create())
  }

  list(): AgentSetupSession[] {
    return this.#setups.listSaved()
  }

  async get(id: string): Promise<AgentSetupView> {
    return this.#view(this.#setups.get(id))
  }

  async update(rawInput: AgentSetupUpdateInput): Promise<AgentSetupView> {
    const input = agentSetupUpdateInputSchema.parse(rawInput)
    return this.#singleFlight(`update:${input.id}`, async () => {
      const previous = this.#setups.get(input.id)
      await this.#assertStepTransition(previous, input)
      const previousLocator = this.#setups.keychainLocator(input.id)
      const authIdentityChanged =
        previous.selection?.harnessId !== input.selection?.harnessId ||
        previous.selection?.providerId !== input.selection?.providerId ||
        previous.selection?.credentialRequirement.method !==
          input.selection?.credentialRequirement.method
      const capabilitySelections = await this.#resolveCapabilitySelections(previous, input)
      const session = this.#setups.update({ ...input, capabilitySelections })
      if (authIdentityChanged && previousLocator) {
        await this.#keychain.delete(previousLocator).catch(() => undefined)
      }
      return this.#view(session)
    })
  }

  async #assertStepTransition(
    previous: AgentSetupSession,
    input: AgentSetupUpdateInput,
  ): Promise<void> {
    const currentIndex = agentSetupSteps.indexOf(previous.step)
    const targetIndex = agentSetupSteps.indexOf(input.step)
    if (targetIndex <= currentIndex) return
    if (targetIndex !== currentIndex + 1) {
      throw new StudioCoreError('USAGE_ERROR', '请按顺序完成 Agent 设置步骤。')
    }
    if (previous.step === 'basics' && !input.name.trim()) {
      throw new StudioCoreError('STACK_INVALID', '请先填写有效的 Agent 名称。')
    }
    if (previous.step === 'harness') {
      if (!input.harnessId) {
        throw new StudioCoreError('STACK_INVALID', '请先选择 Harness。')
      }
      const probe = await this.#gateway.probe(input.harnessId)
      if (probe.status === 'not-installed' || probe.status === 'unsupported-version') {
        throw new StudioCoreError('STACK_INVALID', '请选择本机可识别且版本受支持的 Harness。')
      }
    }
    if (previous.step === 'model') {
      const selectionUnchanged =
        JSON.stringify(previous.selection) === JSON.stringify(input.selection)
      if (
        !input.selection ||
        !selectionUnchanged ||
        previous.authentication?.state !== 'credential-valid' ||
        previous.verification.state !== 'minimal-call-succeeded'
      ) {
        throw new StudioCoreError(
          'STACK_INVALID',
          '请先保存模型配置，并完成当前认证与最小模型调用验证。',
        )
      }
    }
  }

  async save(id: string, expectedRevision: number): Promise<AgentSetupView> {
    const input = agentSetupSaveInputSchema.parse({ id, expectedRevision })
    return this.#singleFlight(`save:${id}`, async () =>
      this.#view(this.#setups.save(input.id, input.expectedRevision)),
    )
  }

  async configureApiKey(id: string, secret: string): Promise<AgentSetupView> {
    return this.#singleFlight(`auth:${id}`, async () => {
      const session = this.#setups.get(id)
      const selection = this.#selection(session)
      if (selection.credentialRequirement.method !== 'api-key') {
        throw new StudioCoreError('USAGE_ERROR', '当前模型配置没有选择 API Key 认证。')
      }
      const locator = {
        service: defaultKeychainService,
        account: `setup:${session.id}:${selection.harnessId}:${selection.providerId}`,
      }
      await this.#keychain.set(
        locator,
        secret,
        `${selection.harnessId} / ${selection.providerId} Agent 设置凭证`,
      )
      this.#setups.setAuthentication({
        id,
        authentication: null,
        locator,
        verification: {
          state: 'not-run',
          configurationHash: null,
          checkedAt: null,
          failure: null,
        },
      })
      let authentication: AgentSetupSession['authentication']
      try {
        authentication = await this.#gateway.authenticationStatus(
          await this.#gatewayRequest(session, selection, { kind: 'api-key', value: secret }),
        )
      } catch {
        authentication = modelAuthenticationStatusSchema.parse({
          harnessId: selection.harnessId,
          providerId: selection.providerId,
          authMethod: selection.credentialRequirement.method,
          state: 'unavailable',
          detail: '无法检查本机模型认证状态，API Key 仍安全保存在 Keychain。',
          checkedAt: new Date().toISOString(),
          failure: {
            code: 'harness-failed',
            message: 'Harness 认证检查失败。',
            recoveryAction: '确认 Harness 可用后重新检查认证。',
            retryable: true,
          },
        })
      }
      return this.#view(
        this.#setups.setAuthentication({
          id,
          authentication,
          verification: {
            state: 'not-run',
            configurationHash: null,
            checkedAt: null,
            failure: null,
          },
        }),
      )
    })
  }

  async launchOfficialLogin(id: string): Promise<AgentSetupView> {
    return this.#singleFlight(`auth:${id}`, async () => {
      const session = this.#setups.get(id)
      const selection = this.#selection(session)
      if (selection.credentialRequirement.method !== 'official-login') {
        throw new StudioCoreError('USAGE_ERROR', '当前模型配置没有选择官方登录。')
      }
      const authentication = await this.#gateway.configureAuthentication(
        await this.#gatewayRequest(session, selection, { kind: 'harness-login' }),
      )
      return this.#view(this.#setups.setAuthentication({ id, authentication, locator: null }))
    })
  }

  async refreshAuthentication(id: string, signal?: AbortSignal): Promise<AgentSetupView> {
    return this.#singleFlight(`auth:${id}`, async () => {
      const session = this.#setups.get(id)
      const selection = this.#selection(session)
      const credential = await this.#credential(session)
      if (!credential) {
        const authentication = modelAuthenticationStatusSchema.parse({
          harnessId: selection.harnessId,
          providerId: selection.providerId,
          authMethod: selection.credentialRequirement.method,
          state: 'not-configured',
          detail: '当前 Mac 上还没有该 Provider 的本机凭证。',
          checkedAt: new Date().toISOString(),
          failure: null,
        })
        return this.#view(this.#setups.setAuthentication({ id, authentication, locator: null }))
      }
      const authentication = await this.#gateway.authenticationStatus(
        await this.#gatewayRequest(session, selection, credential, signal),
      )
      return this.#view(this.#setups.setAuthentication({ id, authentication }))
    })
  }

  async verify(input: {
    id: string
    requestId: string
    costAcknowledged: true
    timeoutMs: number
  }): Promise<AgentSetupView> {
    if (this.#verificationControllers.has(input.requestId)) {
      throw new StudioCoreError('REVISION_CONFLICT', '该模型验证请求已在执行。')
    }
    const controller = new AbortController()
    this.#verificationControllers.set(input.requestId, controller)
    try {
      const refreshed = await this.refreshAuthentication(input.id, controller.signal)
      if (refreshed.session.authentication?.state !== 'credential-valid') return refreshed
      const session = refreshed.session
      const selection = this.#selection(session)
      const credential = await this.#credential(session)
      if (!credential) return refreshed
      const verification = await this.#gateway.verify(
        await this.#gatewayRequest(
          session,
          selection,
          credential,
          controller.signal,
          input.timeoutMs,
        ),
      )
      return this.#view(this.#setups.setVerification(input.id, verification))
    } finally {
      this.#verificationControllers.delete(input.requestId)
    }
  }

  cancel(requestId: string): boolean {
    const controller = this.#verificationControllers.get(requestId)
    if (!controller || controller.signal.aborted) return false
    controller.abort()
    return true
  }

  async validateMcp(input: McpValidationInput): Promise<AgentSetupView> {
    if (this.#verificationControllers.has(input.requestId)) {
      throw new StudioCoreError('REVISION_CONFLICT', '该 MCP 验证请求已在执行。')
    }
    const session = this.#setups.get(input.id)
    const server = this.#materializeProfile(session).mcpServers.find(
      ({ id }) => id === input.serverId,
    )
    if (!server) throw new StudioCoreError('COMPONENT_NOT_FOUND', '找不到该 MCP server 配置。')
    const controller = new AbortController()
    this.#verificationControllers.set(input.requestId, controller)
    const checkedAt = new Date().toISOString()
    try {
      if (!session.harnessId) {
        throw new McpRuntimeError({
          code: 'transport-unsupported',
          message: '请先选择 Harness，再验证 MCP。',
          recoveryAction: '返回 Harness 步骤完成选择。',
          retryable: false,
        })
      }
      const support = mcpTransportSupport(session.harnessId, server.transport)
      if (support.level === 'unavailable') {
        throw new McpRuntimeError({
          code: 'transport-unsupported',
          message: support.detail,
          recoveryAction: support.recoveryAction,
          retryable: false,
        })
      }
      const validationRoot = path.join(this.#setupRoot, session.id)
      await mkdir(validationRoot, { recursive: true, mode: 0o700 })
      const result = await this.#mcp.validate(server, {
        cwd: validationRoot,
        timeoutMs: input.timeoutMs,
        signal: controller.signal,
      })
      return this.#view(
        this.#setups.setMcpValidation(session.id, {
          serverId: server.id,
          configurationHash: stableHash(server),
          server,
          state: 'succeeded',
          transport: server.transport,
          checkedAt,
          executable: result.executable,
          toolNames: result.tools.map(({ name }) => name),
          failure: null,
        }),
      )
    } catch (error) {
      const runtimeError =
        error instanceof McpRuntimeError
          ? error
          : new McpRuntimeError({
              code: controller.signal.aborted ? 'operation-cancelled' : 'handshake-failed',
              message: controller.signal.aborted ? 'MCP 验证已取消。' : 'MCP 验证失败。',
              recoveryAction: controller.signal.aborted
                ? '准备好后重试。'
                : '检查 server 配置后重试。',
              retryable: true,
            })
      return this.#view(
        this.#setups.setMcpValidation(session.id, {
          serverId: server.id,
          configurationHash: stableHash(server),
          server,
          state: 'failed',
          transport: server.transport,
          checkedAt,
          executable: null,
          toolNames: [],
          failure: runtimeError.failure,
        }),
      )
    } finally {
      this.#verificationControllers.delete(input.requestId)
    }
  }

  async discard(id: string): Promise<{ id: string; discarded: true }> {
    const session = this.#setups.get(id)
    await this.#discard(session)
    return agentSetupDiscardResultSchema.parse({ id, discarded: true })
  }

  async complete(id: string): Promise<{ agentId: string; setupId: string }> {
    const completed = this.#completed.get(id)
    if (completed) return completed
    return this.#singleFlight(`complete:${id}`, async () => {
      const refreshed = await this.refreshAuthentication(id)
      const view = await this.#view(refreshed.session)
      if (!view.readiness.ready) {
        const blocker = view.readiness.blockers[0]
        throw new StudioCoreError('STACK_INVALID', blocker?.message ?? 'Agent 设置尚未完成。', {
          suggestedActions: blocker ? [{ description: blocker.recoveryAction }] : [],
        })
      }
      const session = view.session
      const selection = this.#selection(session)
      const agentId = randomUUID()
      const workspacePath = await this.#workspaces.create(agentId)
      let linked = false
      let bindingId: string | undefined
      let secretReferenceId: string | undefined
      let projectId: string | undefined
      try {
        let result = await this.#core.initProject(workspacePath, {
          name: session.name.trim(),
          description: session.description.trim(),
          executionMode: 'external-harness',
        })
        result = await this.#core.selectKnownHarness(workspacePath, selection.harnessId, {
          expectedRevision: result.project.revision,
        })
        result = await this.#core.updateModelConfiguration(
          workspacePath,
          {
            providerId: selection.providerId,
            modelId: selection.modelId,
            credentialRequirement: selection.credentialRequirement,
          },
          { expectedRevision: result.project.revision },
        )
        result = await this.#core.updateAgentProfile(
          workspacePath,
          this.#materializeProfile(session),
          {
            expectedRevision: result.project.revision,
          },
        )
        for (const server of result.project.profile.mcpServers.filter(({ enabled }) => enabled)) {
          const support = mcpTransportSupport(selection.harnessId, server.transport)
          if (support.level === 'unavailable') {
            throw new StudioCoreError('STACK_INVALID', support.detail, {
              suggestedActions: [{ description: support.recoveryAction }],
            })
          }
          await this.#mcp.validate(server, { cwd: workspacePath, timeoutMs: 15_000 })
        }
        for (const selected of session.capabilitySelections) {
          if (selected.kind !== 'skill') continue
          if (!this.#capabilityInstaller) {
            throw new StudioCoreError(
              'CUSTOMIZATION_INSTALL_FAILED',
              '固定 Skill 安装边界不可用，请重启 Studio 后重试。',
            )
          }
          const installed = await this.#capabilityInstaller.install({
            projectPath: workspacePath,
            recipeId: selected.recipeId,
            harnessId: selection.harnessId,
            expectedRevision: result.project.revision,
            confirmed: true,
          })
          result = await this.#core.inspectProject(workspacePath)
          if (installed.revision !== result.project.revision) {
            throw new StudioCoreError('REVISION_CONFLICT', 'Skill 安装后项目修订不一致。')
          }
        }
        const selectedComponents = session.capabilitySelections.filter(
          (selected) => selected.kind === 'component',
        )
        if (selectedComponents.length) {
          result = await this.#core.installDeclaredComponents(
            workspacePath,
            selectedComponents.map(({ componentId, descriptor }) => ({
              id: componentId,
              descriptor,
            })),
            { expectedRevision: result.project.revision },
          )
          for (const selected of selectedComponents) {
            result = await this.#core.addStackComponent(workspacePath, selected.componentId, {
              expectedRevision: result.project.revision,
            })
            for (const { capability } of selected.descriptor.provides) {
              result = await this.#core.setOwner(workspacePath, capability, selected.componentId, {
                expectedRevision: result.project.revision,
              })
            }
          }
        }
        const validation = this.#core.validate(result.project)
        if (validation.status !== 'ready') {
          throw new StudioCoreError('STACK_INVALID', '最终 Stack/兼容性检查未通过。', {
            details: { issues: validation.issues },
          })
        }
        projectId = result.project.id
        this.#agents.ensureProjectAgent(result.project, result.path, agentId)
        linked = true
        const locator = this.#setups.keychainLocator(id)
        if (selection.credentialRequirement.method === 'api-key') {
          if (!locator || !(await this.#keychain.has(locator))) {
            throw new StudioCoreError('KEYCHAIN_FAILED', '完成创建前，本机 API Key 已不可用。')
          }
          const reference = this.#agents.saveSecretReference({
            agentId,
            label: `${selection.harnessId} / ${selection.providerId} 模型凭证`,
            keychainService: locator.service,
            keychainAccount: locator.account,
          })
          secretReferenceId = reference.id
        }
        const binding = this.#agents.saveProviderCredentialBinding({
          agentId,
          projectId: result.project.id,
          harnessId: selection.harnessId,
          providerId: selection.providerId,
          authMethod: selection.credentialRequirement.method,
          secretReferenceId: secretReferenceId ?? null,
        })
        bindingId = binding.id
        this.#agents.saveModelVerification({
          bindingId: binding.id,
          configurationHash: modelAuthConfigurationHash(selection),
          status: 'minimal-call-succeeded',
          checkedAt: session.verification.checkedAt ?? new Date().toISOString(),
        })
        await this.#projects.open(workspacePath)
        this.#setups.delete(id)
        await rm(path.join(this.#setupRoot, id), { recursive: true, force: true })
        const completion = agentSetupCompleteResultSchema.parse({ agentId, setupId: id })
        this.#completed.set(id, completion)
        return completion
      } catch (error) {
        if (bindingId) this.#agents.deleteProviderCredentialBinding(bindingId)
        if (secretReferenceId) this.#agents.deleteSecretReference(secretReferenceId)
        if (linked) {
          this.#agents.archive(agentId)
          this.#agents.delete(agentId)
        }
        if (projectId) this.#projects.deactivateIfProject(projectId, workspacePath)
        await this.#workspaces.remove(agentId).catch(() => undefined)
        throw error
      }
    })
  }

  close(): void {
    for (const controller of this.#verificationControllers.values()) controller.abort()
    this.#verificationControllers.clear()
    void this.#mcp.close()
  }

  async #view(session: AgentSetupSession): Promise<AgentSetupView> {
    const probes = await Promise.all(
      (['pi', 'openclaw', 'codex'] as const).map((harnessId) => this.#gateway.probe(harnessId)),
    )
    const probe = session.harnessId
      ? (probes.find(({ id }) => id === session.harnessId) ?? null)
      : null
    return agentSetupViewSchema.parse({
      session,
      probes,
      capabilityCatalog: await this.#capabilityCatalog(session.harnessId),
      readiness: buildAgentSetupReadiness({ session, probe }),
    })
  }

  async #resolveCapabilitySelections(
    previous: AgentSetupSession,
    input: ParsedAgentSetupUpdateInput,
  ): Promise<SetupCapabilityItem[]> {
    if (!input.harnessId && input.capabilitySelectionIds.length) {
      throw new StudioCoreError('STACK_INVALID', '请先选择 Harness，再添加能力。')
    }
    const catalog = await this.#capabilityCatalog(input.harnessId)
    const available = new Map(catalog.items.map((item) => [item.id, item]))
    for (const item of previous.capabilitySelections) {
      if (!available.has(item.id))
        available.set(item.id, this.#withHarnessSupport(item, input.harnessId))
    }
    return input.capabilitySelectionIds.map((id) => {
      const item = available.get(id)
      if (!item) {
        throw new StudioCoreError(
          'COMPONENT_NOT_FOUND',
          `能力目录中已找不到 ${id}，请移除后重新选择。`,
        )
      }
      return setupCapabilityItemSchema.parse(item)
    })
  }

  async #capabilityCatalog(
    harnessId: AgentSetupSession['harnessId'],
  ): Promise<SetupCapabilityCatalog> {
    if (!harnessId) {
      return setupCapabilityCatalogSchema.parse({
        items: [],
        projectComponents: { state: 'empty', message: '选择 Harness 后显示可用能力。' },
      })
    }
    const templateItems: SetupCapabilityItem[] = builtInSetupCapabilityTemplates.map((item) => ({
      ...item,
      support: {
        harnessId,
        level: item.kind === 'prompt' ? 'native' : harnessId === 'pi' ? 'adapted' : 'adapted',
        detail:
          item.kind === 'prompt'
            ? `${harnessId} 直接接收 Profile Prompt。`
            : `${harnessId} 将 Markdown Memory 编译为显式上下文。`,
      },
    }))
    const skillItems: SetupCapabilityItem[] = knownInstallRecipes.map((recipe) => {
      const support = recipe.harnessSupport.find((entry) => entry.harnessId === harnessId)!
      return {
        id: `skill:${recipe.id}`,
        kind: 'skill',
        name: recipe.skillName,
        summary:
          recipe.contentCompleteness === 'complete'
            ? '固定内容完整的 Markdown Skill。'
            : '只安装指导文本，上游辅助文件不会被复制。',
        sourceLabel: `${recipe.repository} @ ${recipe.commit.slice(0, 10)}`,
        sourceDetail: `${recipe.license} · SHA-256 ${recipe.artifactSha256.slice(0, 12)}… · 不执行上游代码`,
        recipeId: recipe.id,
        support,
      }
    })
    let projectItems: SetupCapabilityItem[] = []
    let projectComponents: SetupCapabilityCatalog['projectComponents']
    try {
      const state = await this.#projects.current()
      projectItems =
        state.project?.components
          .filter(
            ({ archivedAt, descriptor }) =>
              !archivedAt &&
              !descriptor.provides.some(({ capability }) => capability === 'execution-controller'),
          )
          .map((component) =>
            this.#projectComponentItem(component, state.project!.name, harnessId),
          ) ?? []
      const componentCount = projectItems.length
      const mcpItems: SetupCapabilityItem[] =
        state.project?.profile.mcpServers.map((server) => {
          const support = mcpTransportSupport(harnessId, server.transport)
          return setupCapabilityItemSchema.parse({
            id: `mcp:${server.id}`,
            kind: 'mcp',
            name: server.name,
            summary:
              server.transport === 'stdio'
                ? '复用当前项目中已配置的本地 stdio MCP。'
                : '复用当前项目中已配置的远程 HTTP MCP。',
            sourceLabel: `当前项目 · ${state.project!.name}`,
            sourceDetail:
              server.transport === 'stdio'
                ? `${server.command} ${server.args.join(' ')}`.trim()
                : server.url!,
            server,
            support: {
              harnessId,
              level: support.level,
              detail: support.detail,
            },
          })
        }) ?? []
      projectItems.push(...mcpItems)
      projectComponents = componentCount
        ? {
            state: 'ready',
            message: `${componentCount} 个当前项目组件可供审查。`,
          }
        : { state: 'empty', message: '当前项目组件目录为空。' }
    } catch (error) {
      projectComponents = {
        state: 'error',
        message: error instanceof Error ? error.message : '无法读取当前项目组件。',
      }
    }
    return setupCapabilityCatalogSchema.parse({
      items: [...templateItems, ...skillItems, ...projectItems],
      projectComponents,
    })
  }

  #projectComponentItem(
    component: NonNullable<
      Awaited<ReturnType<StudioProjectService['current']>>['project']
    >['components'][number],
    projectName: string,
    harnessId: HarnessModelSelection['harnessId'],
  ): SetupCapabilityItem {
    const validation = component.descriptor.compatibility.validation
    const level = component.descriptor.compatibility.level
    const supported =
      (level === 'native' || level === 'configuration') && validation === 'runtime-verified'
    return setupCapabilityItemSchema.parse({
      id: `component:${component.id}`,
      kind: 'component',
      name: component.descriptor.name,
      summary: component.descriptor.compatibility.detail,
      sourceLabel: `当前项目 · ${projectName}`,
      sourceDetail: `${component.descriptor.source.kind} · ${component.descriptor.source.license ?? '许可信息缺失'} · ${validation}`,
      componentId: component.id,
      descriptor: component.descriptor,
      support: {
        harnessId,
        level: supported ? (level === 'native' ? 'native' : 'adapted') : 'unavailable',
        detail: supported
          ? '已有受信最小运行证据；完成创建时复制 Descriptor 并加入 Stack。'
          : '当前证据不足以在新 Agent 中自动关联；请先完成受信运行验证。',
      },
    })
  }

  #withHarnessSupport(
    item: SetupCapabilityItem,
    harnessId: AgentSetupSession['harnessId'],
  ): SetupCapabilityItem {
    if (!harnessId || item.support.harnessId === harnessId) return item
    if (item.kind === 'component') {
      const { compatibility } = item.descriptor
      const supported =
        (compatibility.level === 'native' || compatibility.level === 'configuration') &&
        compatibility.validation === 'runtime-verified'
      return setupCapabilityItemSchema.parse({
        ...item,
        support: {
          harnessId,
          level: supported
            ? compatibility.level === 'native'
              ? 'native'
              : 'adapted'
            : 'unavailable',
          detail: supported
            ? '已有受信最小运行证据；完成创建时复制 Descriptor 并加入 Stack。'
            : '当前证据不足以在新 Agent 中自动关联；请先完成受信运行验证。',
        },
      })
    }
    if (item.kind === 'mcp') {
      const support = mcpTransportSupport(harnessId, item.server.transport)
      return setupCapabilityItemSchema.parse({
        ...item,
        support: { harnessId, level: support.level, detail: support.detail },
      })
    }
    const current = knownInstallRecipes.find(
      (recipe) => item.kind === 'skill' && recipe.id === item.recipeId,
    )
    const support = current?.harnessSupport.find((entry) => entry.harnessId === harnessId)
    return setupCapabilityItemSchema.parse({
      ...item,
      support: support ?? {
        harnessId,
        level: 'adapted',
        detail: `${harnessId} 将该文本编译为显式 Profile 上下文。`,
      },
    })
  }

  #materializeProfile(session: AgentSetupSession): AgentSetupSession['profile'] {
    const promptTemplates = session.capabilitySelections
      .filter((item) => item.kind === 'prompt')
      .map(({ content }) => content)
    const memoryTemplates = session.capabilitySelections
      .filter((item) => item.kind === 'memory')
      .map(({ content }) => content)
    const selectedMcpServers = session.capabilitySelections.flatMap((item) =>
      item.kind === 'mcp' ? [item.server] : [],
    )
    const mcpServers = [...selectedMcpServers, ...session.profile.mcpServers].filter(
      (server, index, servers) => servers.findIndex(({ id }) => id === server.id) === index,
    )
    return {
      ...session.profile,
      instructions: [...promptTemplates, session.profile.instructions.trim()]
        .filter(Boolean)
        .join('\n\n'),
      memoryMarkdown: [...memoryTemplates, session.profile.memoryMarkdown.trim()]
        .filter(Boolean)
        .join('\n\n'),
      mcpServers,
    }
  }

  #selection(session: AgentSetupSession): HarnessModelSelection {
    if (!session.selection) {
      throw new StudioCoreError(
        'HARNESS_AUTHENTICATION_REQUIRED',
        '请先选择 Provider、模型与认证方式。',
      )
    }
    return assertSupportedModelSelection(session.selection)
  }

  async #credential(session: AgentSetupSession) {
    const selection = this.#selection(session)
    if (selection.credentialRequirement.method !== 'api-key') {
      return { kind: 'harness-login' as const }
    }
    const locator = this.#setups.keychainLocator(session.id)
    if (!locator) return null
    const secret = await this.#keychain.get(locator)
    return secret ? ({ kind: 'api-key' as const, value: secret } as const) : null
  }

  async #gatewayRequest(
    session: AgentSetupSession,
    selection: HarnessModelSelection,
    credential: { kind: 'api-key'; value: string } | { kind: 'harness-login' },
    signal?: AbortSignal,
    timeoutMs = MODEL_TIMEOUT_MS,
  ) {
    const cwd = path.join(this.#setupRoot, session.id)
    await mkdir(cwd, { recursive: true, mode: 0o700 })
    return { selection, credential, cwd, timeoutMs, ...(signal ? { signal } : {}) }
  }

  async #discard(session: AgentSetupSession): Promise<void> {
    const locator = this.#setups.keychainLocator(session.id)
    if (locator) await this.#keychain.delete(locator).catch(() => undefined)
    this.#setups.delete(session.id)
    await rm(path.join(this.#setupRoot, session.id), { recursive: true, force: true })
  }

  async #singleFlight<T>(key: string, action: () => Promise<T>): Promise<T> {
    const existing = this.#operations.get(key)
    if (existing) return existing as Promise<T>
    const task = action().finally(() => {
      if (this.#operations.get(key) === task) this.#operations.delete(key)
    })
    this.#operations.set(key, task)
    return task
  }
}
