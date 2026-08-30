import { z } from 'zod'
import { agentProfileSchema, defaultAgentProfile } from './agent-profile'
import {
  agentModelReadinessSchema,
  buildAgentModelReadiness,
  harnessModelSelectionSchema,
  modelAuthenticationStatusSchema,
  modelVerificationStatusSchema,
} from './model-auth'
import { harnessIdSchema, harnessProbeSchema } from './native-agent'
import {
  setupCapabilityCatalogSchema,
  setupCapabilityItemSchema,
  setupCapabilitySelectionIdsSchema,
} from './setup-capability'
import { mcpTransportSupport, mcpValidationRecordSchema } from './mcp'

export const agentSetupSteps = ['basics', 'harness', 'model', 'capabilities', 'review'] as const
export const agentSetupStepSchema = z.enum(agentSetupSteps)
export const agentSetupStatusSchema = z.enum(['transient', 'saved'])

export const agentSetupSessionSchema = z
  .object({
    id: z.uuid(),
    status: agentSetupStatusSchema,
    revision: z.number().int().positive(),
    step: agentSetupStepSchema,
    name: z.string().max(80),
    description: z.string().max(500),
    harnessId: harnessIdSchema.nullable(),
    selection: harnessModelSelectionSchema.nullable(),
    profile: agentProfileSchema,
    capabilitySelections: z.array(setupCapabilityItemSchema).max(100).default([]),
    mcpValidations: z.array(mcpValidationRecordSchema).max(30).default([]),
    authentication: modelAuthenticationStatusSchema.nullable(),
    verification: modelVerificationStatusSchema,
    hasKeychainCredential: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((session, context) => {
    if (session.selection && session.selection.harnessId !== session.harnessId) {
      context.addIssue({
        code: 'custom',
        path: ['selection'],
        message: '模型配置必须属于当前选择的 Harness。',
      })
    }
    if (
      session.authentication &&
      (!session.selection ||
        session.authentication.harnessId !== session.selection.harnessId ||
        session.authentication.providerId !== session.selection.providerId ||
        session.authentication.authMethod !== session.selection.credentialRequirement.method)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['authentication'],
        message: '认证事实必须属于当前模型配置。',
      })
    }
    if (
      session.hasKeychainCredential &&
      session.selection?.credentialRequirement.method !== 'api-key'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['hasKeychainCredential'],
        message: '只有 API Key 认证可以关联 setup Keychain 凭证。',
      })
    }
  })

export const agentSetupUpdateInputSchema = z
  .object({
    id: z.uuid(),
    expectedRevision: z.number().int().positive(),
    step: agentSetupStepSchema,
    name: z.string().max(80),
    description: z.string().max(500),
    harnessId: harnessIdSchema.nullable(),
    selection: harnessModelSelectionSchema.nullable(),
    profile: agentProfileSchema,
    capabilitySelectionIds: setupCapabilitySelectionIdsSchema.default([]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.selection && input.selection.harnessId !== input.harnessId) {
      context.addIssue({
        code: 'custom',
        path: ['selection'],
        message: '模型配置必须属于当前 Harness。',
      })
    }
  })

export const agentSetupIdInputSchema = z.object({ id: z.uuid() }).strict()
export const agentSetupSaveInputSchema = z
  .object({ id: z.uuid(), expectedRevision: z.number().int().positive() })
  .strict()
export const agentSetupVerifyInputSchema = z
  .object({
    id: z.uuid(),
    requestId: z.uuid(),
    costAcknowledged: z.literal(true),
    timeoutMs: z.number().int().min(1_000).max(300_000).default(120_000),
  })
  .strict()
export const agentSetupCancelInputSchema = z.object({ requestId: z.uuid() }).strict()

export const agentSetupBlockerSchema = z
  .object({
    id: z.enum(['name', 'harness', 'model', 'authentication', 'verification', 'capability']),
    step: agentSetupStepSchema,
    message: z.string().trim().min(1).max(1_000),
    recoveryAction: z.string().trim().min(1).max(500),
  })
  .strict()

export const agentSetupReadinessSchema = z
  .object({
    ready: z.boolean(),
    model: agentModelReadinessSchema,
    hasCapability: z.boolean(),
    blockers: z.array(agentSetupBlockerSchema).max(12),
  })
  .strict()

export const agentSetupViewSchema = z
  .object({
    session: agentSetupSessionSchema,
    probes: z.array(harnessProbeSchema).length(3),
    capabilityCatalog: setupCapabilityCatalogSchema,
    readiness: agentSetupReadinessSchema,
  })
  .strict()

export const agentSetupListSchema = z.array(agentSetupSessionSchema)
export const agentSetupActionResultSchema = z
  .object({ status: z.enum(['completed', 'cancelled', 'launched']), view: agentSetupViewSchema })
  .strict()
export const agentSetupCompleteResultSchema = z
  .object({ agentId: z.uuid(), setupId: z.uuid() })
  .strict()
export const agentSetupDiscardResultSchema = z
  .object({ id: z.uuid(), discarded: z.literal(true) })
  .strict()
export const agentSetupCancelResultSchema = z.object({ cancelled: z.boolean() }).strict()

export function hasAgentSetupCapability(
  profile: z.infer<typeof agentProfileSchema>,
  selections: z.infer<typeof setupCapabilityItemSchema>[] = [],
): boolean {
  return Boolean(
    selections.length ||
      profile.instructions.trim() ||
      profile.memoryMarkdown.trim() ||
      profile.skills.some(({ enabled, markdown }) => enabled && markdown.trim()) ||
      profile.mcpServers.some(({ enabled }) => enabled),
  )
}

export function buildAgentSetupReadiness(input: {
  session: z.infer<typeof agentSetupSessionSchema>
  probe: z.infer<typeof harnessProbeSchema> | null
}): z.infer<typeof agentSetupReadinessSchema> {
  const { session, probe } = input
  const model = buildAgentModelReadiness({
    stackCompatible: true,
    harnessStatus: !session.harnessId
      ? 'not-selected'
      : probe?.status === 'not-installed'
        ? 'not-installed'
        : probe?.status === 'unsupported-version'
          ? 'unsupported-version'
          : 'ready',
    configurationState: session.selection ? 'configured' : 'provider-not-selected',
    configuration: session.selection
      ? {
          providerId: session.selection.providerId,
          modelId: session.selection.modelId,
          credentialRequirement: session.selection.credentialRequirement,
        }
      : null,
    authentication: session.authentication,
    verification: session.verification,
  })
  const blockers: Array<z.infer<typeof agentSetupBlockerSchema>> = []
  if (!session.name.trim()) {
    blockers.push({
      id: 'name',
      step: 'basics',
      message: 'Agent 还没有有效名称。',
      recoveryAction: '返回基本信息并填写名称。',
    })
  }
  if (!session.harnessId || !model.harnessExecutable) {
    blockers.push({
      id: 'harness',
      step: 'harness',
      message: model.blockers[0]?.message ?? '尚未选择可用 Harness。',
      recoveryAction: model.blockers[0]?.recoveryAction ?? '选择本机可识别的 Harness。',
    })
  } else if (!session.selection) {
    blockers.push({
      id: 'model',
      step: 'model',
      message: '尚未保存 Provider、模型与认证方式。',
      recoveryAction: '选择模型配置。',
    })
  } else if (session.authentication?.state !== 'credential-valid') {
    blockers.push({
      id: 'authentication',
      step: 'model',
      message: model.blockers[0]?.message ?? '当前 Provider 尚未认证。',
      recoveryAction: model.blockers[0]?.recoveryAction ?? '完成当前认证方式。',
    })
  } else if (session.verification.state !== 'minimal-call-succeeded') {
    blockers.push({
      id: 'verification',
      step: 'model',
      message: model.blockers[0]?.message ?? '尚未完成最小模型调用验证。',
      recoveryAction: model.blockers[0]?.recoveryAction ?? '验证模型连接。',
    })
  }
  const hasCapability = hasAgentSetupCapability(session.profile, session.capabilitySelections)
  const unsupportedSelections = session.capabilitySelections.filter(
    ({ support }) => support.level === 'unavailable',
  )
  if (unsupportedSelections.length) {
    blockers.push({
      id: 'capability',
      step: 'capabilities',
      message: `${unsupportedSelections.map(({ name }) => name).join('、')} 不支持当前 Harness。`,
      recoveryAction: '移除不兼容能力，或更换 Harness。',
    })
  }
  const selectedMcpServers = session.capabilitySelections.flatMap((item) =>
    item.kind === 'mcp' ? [item.server] : [],
  )
  const enabledMcpServers = [...selectedMcpServers, ...session.profile.mcpServers].filter(
    ({ enabled }, index, servers) =>
      enabled && servers.findIndex(({ id }) => id === servers[index].id) === index,
  )
  const invalidMcpServers = enabledMcpServers.filter((server) => {
    if (!session.harnessId) return false
    if (mcpTransportSupport(session.harnessId, server.transport).level === 'unavailable')
      return true
    if (server.approval !== 'approved') return true
    return !session.mcpValidations.some(
      (validation) =>
        validation.serverId === server.id &&
        validation.state === 'succeeded' &&
        JSON.stringify(validation.server) === JSON.stringify(server),
    )
  })
  if (!unsupportedSelections.length && invalidMcpServers.length) {
    blockers.push({
      id: 'capability',
      step: 'capabilities',
      message: `${invalidMcpServers.map(({ name }) => name).join('、')} 尚未完成当前 Harness 的批准与连接验证。`,
      recoveryAction: '审查 MCP 来源与参数，明确批准后测试连接；或移除该 MCP。',
    })
  }
  return agentSetupReadinessSchema.parse({
    ready: blockers.length === 0 && model.ready,
    model,
    hasCapability,
    blockers,
  })
}

export const emptyAgentSetupProfile = agentProfileSchema.parse(defaultAgentProfile)

export type AgentSetupSession = z.infer<typeof agentSetupSessionSchema>
export type AgentSetupStep = z.infer<typeof agentSetupStepSchema>
export type AgentSetupUpdateInput = z.input<typeof agentSetupUpdateInputSchema>
export type ParsedAgentSetupUpdateInput = z.output<typeof agentSetupUpdateInputSchema>
export type AgentSetupView = z.infer<typeof agentSetupViewSchema>
export type AgentSetupReadiness = z.infer<typeof agentSetupReadinessSchema>
export type AgentSetupCompleteResult = z.infer<typeof agentSetupCompleteResultSchema>
export type AgentSetupActionResult = z.infer<typeof agentSetupActionResultSchema>
