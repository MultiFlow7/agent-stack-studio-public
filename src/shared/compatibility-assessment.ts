import { z } from 'zod'
import type { ComponentDescriptor } from './component'

export const compatibilityAssessmentStatusSchema = z.enum([
  'unchecked',
  'static-passed',
  'configuration-required',
  'adapter-required',
  'runtime-verified',
  'incompatible',
])

export const compatibilityEvidenceSchema = z
  .object({
    kind: z.enum([
      'platform',
      'entrypoint',
      'capability-contract',
      'configuration',
      'permission',
      'secret-reference',
      'adapter-contract',
      'runtime-check',
      'license',
      'human-decision',
    ]),
    status: z.enum(['passed', 'missing', 'blocked', 'human-decision']),
    detail: z.string().trim().min(1).max(500),
  })
  .strict()

export const compatibilityActionSchema = z
  .object({
    id: z.string().regex(/^[0-9a-f-]{36}:[a-z-]+$/),
    action: z.enum([
      'recheck-static',
      'edit-contract',
      'declare-configuration',
      'select-strategy',
      'resolve-owner',
      'run-contract-test',
      'run-trusted-validation',
      'review-incompatible',
    ]),
    presentation: z.enum(['button', 'form', 'external-step']),
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    enabled: z.boolean(),
    externalStep: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()

export const compatibilityAssessmentSchema = z
  .object({
    componentId: z.uuid(),
    status: compatibilityAssessmentStatusSchema,
    explanation: z.string().trim().min(1).max(500),
    evidence: z.array(compatibilityEvidenceSchema),
    blockers: z.array(z.string().trim().min(1).max(500)),
    suggestedActions: z.array(compatibilityActionSchema),
    checkedAt: z.iso.datetime(),
    method: z.enum([
      'static-descriptor-v2',
      'deterministic-contract-test-v1',
      'trusted-runtime-v1',
    ]),
  })
  .strict()

export type CompatibilityAssessment = z.infer<typeof compatibilityAssessmentSchema>
export type CompatibilityAssessmentStatus = z.infer<typeof compatibilityAssessmentStatusSchema>
export type CompatibilityAction = z.infer<typeof compatibilityActionSchema>

function makeAction(
  componentId: string,
  value: Omit<CompatibilityAction, 'id'>,
): CompatibilityAction {
  return compatibilityActionSchema.parse({ ...value, id: `${componentId}:${value.action}` })
}

export function assessComponentCompatibility(input: {
  componentId: string
  descriptor: ComponentDescriptor
  checkedAt: string
  platform?: 'darwin-arm64' | 'darwin-x64'
}): CompatibilityAssessment {
  const platform = input.platform ?? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
  const descriptor = input.descriptor
  const evidence: CompatibilityAssessment['evidence'] = []
  const blockers: string[] = []
  const suggestedActions: CompatibilityAction[] = []

  if (descriptor.platforms.includes(platform)) {
    evidence.push({
      kind: 'platform',
      status: 'passed',
      detail: `Descriptor 声明支持 ${platform}。`,
    })
  } else {
    const message = `当前平台 ${platform} 不在组件声明的平台列表中。`
    evidence.push({ kind: 'platform', status: 'blocked', detail: message })
    blockers.push(message)
  }

  const unknownProviders = descriptor.provides.filter(
    ({ replaceability }) => replaceability === 'unknown',
  )
  const machineContractKnown = descriptor.provides.length > 0 && unknownProviders.length === 0
  evidence.push({
    kind: 'capability-contract',
    status: machineContractKnown ? 'passed' : 'missing',
    detail: machineContractKnown
      ? `已声明 ${descriptor.provides.length} 项提供能力、${descriptor.requires.length} 项依赖及每项激活/替换边界。`
      : unknownProviders.length
        ? `有 ${unknownProviders.length} 项能力的替换边界仍为 unknown。`
        : 'Descriptor 没有可组合的能力契约。',
  })

  const permissions = descriptor.permissions ?? []
  const secretReferences = descriptor.secretReferences ?? []
  evidence.push({
    kind: 'configuration',
    status: descriptor.configSchema ? 'human-decision' : 'passed',
    detail: descriptor.configSchema
      ? `需按 ${descriptor.configSchema} 完成配置映射；Schema 引用不代表已配置。`
      : '未声明额外配置 Schema。',
  })
  evidence.push({
    kind: 'permission',
    status: permissions.some(({ required }) => required) ? 'human-decision' : 'passed',
    detail: permissions.length
      ? `已声明 ${permissions.length} 项最小权限，其中 ${permissions.filter(({ required }) => required).length} 项需用户授权。`
      : '未声明额外权限。',
  })
  evidence.push({
    kind: 'secret-reference',
    status: secretReferences.some(({ required }) => required) ? 'human-decision' : 'passed',
    detail: secretReferences.length
      ? `已声明 ${secretReferences.length} 个 Keychain 引用名，未包含密钥原文。`
      : '未声明密钥引用。',
  })

  if (descriptor.runtimeAdapter) {
    evidence.push({
      kind: 'entrypoint',
      status: 'passed',
      detail: `已声明 Runtime Adapter 引用 ${descriptor.runtimeAdapter}；引用本身不构成执行信任。`,
    })
  } else if (['adapter', 'fork'].includes(descriptor.compatibility.level)) {
    const message = '处置策略需要 Adapter 或 Fork，但未声明可验证的运行入口。'
    evidence.push({ kind: 'entrypoint', status: 'missing', detail: message })
    blockers.push(message)
  } else {
    evidence.push({
      kind: 'entrypoint',
      status: 'missing',
      detail: '未声明 Runtime Adapter；组件仍可静态组合，但不获得执行权限。',
    })
  }

  const legacyConfirmationCount =
    descriptor.provides.filter(({ confidence }) => confidence === 'user-confirmed').length +
    descriptor.evidence.filter(({ kind }) => kind === 'user-confirmation').length
  if (legacyConfirmationCount > 0) {
    evidence.push({
      kind: 'human-decision',
      status: 'human-decision',
      detail:
        '保留了旧 user-confirmed 记录，它只表示人工接受/修正，不作为静态通过、契约测试或运行验证证据。',
    })
  }

  const contractEvidence = descriptor.evidence.find(
    ({ kind, status, supersededAt }) =>
      kind === 'contract-test' && status !== 'failed' && !supersededAt,
  )
  if (contractEvidence || descriptor.compatibility.validation === 'contract-tested') {
    evidence.push({
      kind: 'adapter-contract',
      status: 'passed',
      detail: contractEvidence?.detail ?? '已记录确定性契约测试证据。',
    })
  }

  if (
    descriptor.compatibility.level === 'blocked' ||
    descriptor.compatibility.validation === 'failed'
  ) {
    blockers.push(descriptor.compatibility.detail)
  }

  if (descriptor.compatibility.level === 'unknown') {
    const missing = [
      !descriptor.runtimeAdapter &&
      descriptor.provides.some(({ capability }) => capability === 'execution-controller')
        ? '执行控制的运行入口契约'
        : null,
      unknownProviders.length > 0 ? '能力替换边界' : null,
      descriptor.evidence.every(({ kind }) => kind === 'user-confirmation')
        ? '非人工的 Manifest/测试证据'
        : null,
      !descriptor.compatibility.strategyRationale ? '兼容处置策略及理由' : null,
    ].filter((item): item is string => Boolean(item))
    blockers.push(
      missing.length
        ? `机器证据不足：${missing.join('、')}。`
        : '尚未记录可重现的静态或运行兼容结论。',
    )
  }

  let status: CompatibilityAssessmentStatus
  let method: CompatibilityAssessment['method'] = 'static-descriptor-v2'
  let explanation: string
  if (
    descriptor.compatibility.level === 'blocked' ||
    descriptor.compatibility.validation === 'failed' ||
    !descriptor.platforms.includes(platform)
  ) {
    status = 'incompatible'
    explanation = '已有确定性阻断证据，当前不能进入运行验证。'
    suggestedActions.push(
      makeAction(input.componentId, {
        action: 'review-incompatible',
        presentation: 'external-step',
        label: '查看外部处置步骤',
        description: '在独立分支修复平台、许可或语义阻断，然后重新静态检查。',
        enabled: true,
        externalStep:
          '在隔离工作区修复当前阻断；不要在 Studio 中运行未知上游代码。修复后使用“重新静态检查”导入新证据。',
      }),
    )
  } else if (descriptor.compatibility.validation === 'runtime-verified') {
    status = 'runtime-verified'
    method = 'trusted-runtime-v1'
    explanation = '精确白名单 Adapter 已在受信子进程完成最小运行验证。'
    evidence.push({
      kind: 'runtime-check',
      status: 'passed',
      detail: descriptor.compatibility.detail,
    })
  } else if (descriptor.compatibility.level === 'unknown') {
    status = 'unchecked'
    explanation = `不是等待用户点击确认；当前${blockers.join('、')}`
    suggestedActions.push(
      makeAction(input.componentId, {
        action: 'recheck-static',
        presentation: 'button',
        label: '重新静态检查',
        description: '只重读 Manifest、README、许可、Git 与有限文件树，不执行项目代码。',
        enabled: true,
      }),
      makeAction(input.componentId, {
        action: 'edit-contract',
        presentation: 'form',
        label: '修正能力契约',
        description: '补全 provides/requires、替换性、激活方式、配置、权限和密钥引用。',
        enabled: true,
      }),
      makeAction(input.componentId, {
        action: 'select-strategy',
        presentation: 'form',
        label: '选择处置策略',
        description:
          '选择 Native、Configuration、Adapter、Fork 或 Incompatible；选择本身不提升证据。',
        enabled: true,
      }),
    )
  } else if (['adapter', 'fork'].includes(descriptor.compatibility.level)) {
    status = 'adapter-required'
    explanation =
      descriptor.compatibility.level === 'adapter'
        ? '已选择 Adapter 处置方向，仍需契约测试与受信最小运行验证。'
        : '已选择 Fork 处置方向，仍需可审查补丁、契约测试与受信运行验证。'
  } else if (descriptor.compatibility.level === 'configuration' || descriptor.configSchema) {
    status = 'configuration-required'
    explanation = '静态契约可组合，还需完成配置、权限与 Keychain 引用决策。'
    suggestedActions.push(
      makeAction(input.componentId, {
        action: 'declare-configuration',
        presentation: 'form',
        label: '声明配置与权限',
        description: '在结构化表单中完成 Schema、最小权限和 Keychain 引用名。',
        enabled: true,
      }),
    )
  } else {
    status = 'static-passed'
    explanation = '确定性静态规则已通过；这不等于运行兼容。'
  }

  if (descriptor.compatibility.validation === 'contract-tested') {
    method = 'deterministic-contract-test-v1'
  }

  if (
    status !== 'unchecked' &&
    status !== 'incompatible' &&
    descriptor.compatibility.validation === 'declared'
  ) {
    suggestedActions.push(
      makeAction(input.componentId, {
        action: 'run-contract-test',
        presentation: 'button',
        label: '执行契约测试',
        description: '运行 Studio 确定性 Descriptor/Adapter Contract 测试，不加载第三方代码。',
        enabled: machineContractKnown,
      }),
    )
  }
  if (
    status !== 'runtime-verified' &&
    status !== 'incompatible' &&
    descriptor.compatibility.validation === 'contract-tested'
  ) {
    suggestedActions.push(
      makeAction(input.componentId, {
        action: 'run-trusted-validation',
        presentation: 'button',
        label: '进入受信最小运行验证',
        description: '仅精确白名单 Adapter 可进入全新 Runtime 子进程，覆盖启动、调用、取消与清理。',
        enabled: Boolean(descriptor.runtimeAdapter),
      }),
    )
  }

  return compatibilityAssessmentSchema.parse({
    componentId: input.componentId,
    status,
    explanation,
    evidence,
    blockers: [...new Set(blockers)],
    suggestedActions: [...new Map(suggestedActions.map((item) => [item.id, item])).values()],
    checkedAt: input.checkedAt,
    method,
  })
}
