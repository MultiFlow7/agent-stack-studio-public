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
      'adapter-contract',
      'runtime-check',
      'license',
    ]),
    status: z.enum(['passed', 'missing', 'blocked', 'human-decision']),
    detail: z.string().trim().min(1).max(500),
  })
  .strict()

export const compatibilityAssessmentSchema = z
  .object({
    componentId: z.uuid(),
    status: compatibilityAssessmentStatusSchema,
    evidence: z.array(compatibilityEvidenceSchema),
    blockers: z.array(z.string().trim().min(1).max(500)),
    suggestedActions: z.array(z.string().trim().min(1).max(500)),
    checkedAt: z.iso.datetime(),
    method: z.enum(['static-descriptor-v1', 'trusted-runtime-v1']),
  })
  .strict()

export type CompatibilityAssessment = z.infer<typeof compatibilityAssessmentSchema>
export type CompatibilityAssessmentStatus = z.infer<typeof compatibilityAssessmentStatusSchema>

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
  const suggestedActions: string[] = []

  if (descriptor.platforms.includes(platform)) {
    evidence.push({ kind: 'platform', status: 'passed', detail: `声明支持 ${platform}。` })
  } else {
    const message = `当前平台 ${platform} 不在组件声明的平台列表中。`
    evidence.push({ kind: 'platform', status: 'blocked', detail: message })
    blockers.push(message)
    suggestedActions.push('选择支持当前 Mac 架构的组件版本，或在独立分支完成移植与验证。')
  }

  evidence.push({
    kind: 'capability-contract',
    status: descriptor.provides.length > 0 ? 'passed' : 'missing',
    detail: descriptor.provides.length
      ? `Descriptor 声明 ${descriptor.provides.length} 项提供能力和 ${descriptor.requires.length} 项依赖。`
      : 'Descriptor 没有声明可组合的能力契约。',
  })

  if (descriptor.configSchema) {
    evidence.push({
      kind: 'configuration',
      status: 'human-decision',
      detail: `需要根据 ${descriptor.configSchema} 完成配置和敏感字段引用。`,
    })
  } else {
    evidence.push({ kind: 'configuration', status: 'passed', detail: '未声明额外配置 Schema。' })
  }

  if (descriptor.runtimeAdapter) {
    evidence.push({
      kind: 'entrypoint',
      status: 'passed',
      detail: `已声明 Runtime Adapter 引用 ${descriptor.runtimeAdapter}，引用本身不构成执行信任。`,
    })
  } else if (['adapter', 'fork'].includes(descriptor.compatibility.level)) {
    const message = '兼容策略需要 Adapter 或 Fork，但未声明可验证的运行入口。'
    evidence.push({ kind: 'entrypoint', status: 'missing', detail: message })
    blockers.push(message)
  } else {
    evidence.push({
      kind: 'entrypoint',
      status: 'missing',
      detail: '未声明 Runtime Adapter；组件仍保持静态可见，不获得执行权限。',
    })
  }

  if (
    descriptor.compatibility.level === 'blocked' ||
    descriptor.compatibility.validation === 'failed'
  ) {
    blockers.push(descriptor.compatibility.detail)
    suggestedActions.push('保留当前证据并更换组件；若要继续，先在独立分支修复阻断条件。')
  }

  if (descriptor.compatibility.level === 'unknown') {
    const missing = [
      !descriptor.runtimeAdapter ? '运行入口契约' : null,
      descriptor.evidence.length === 0 ? '可审查的 Manifest/测试证据' : null,
      descriptor.provides.some(({ replaceability }) => replaceability === 'unknown')
        ? '能力替换边界'
        : null,
    ].filter((item): item is string => Boolean(item))
    blockers.push(
      missing.length ? `静态证据不足：${missing.join('、')}。` : '尚未记录可重现的兼容性验证结论。',
    )
    suggestedActions.push(
      '先执行静态检查并补全 platform、entrypoint、能力依赖、配置/权限/密钥声明。',
      '若接口不同，选择“建立 Adapter 契约”；若上游无可适配边界，选择“维护 Fork”，不要猜测兼容。',
      '只有在受信 Runtime Profile 中通过超时、取消和日志脱敏的最小运行验证，才能标记为“运行验证通过”。',
    )
  }

  let status: CompatibilityAssessmentStatus
  let method: CompatibilityAssessment['method'] = 'static-descriptor-v1'
  if (
    blockers.some((blocker) => blocker === descriptor.compatibility.detail) ||
    !descriptor.platforms.includes(platform)
  ) {
    status = 'incompatible'
  } else if (descriptor.compatibility.validation === 'runtime-verified') {
    status = 'runtime-verified'
    method = 'trusted-runtime-v1'
    evidence.push({
      kind: 'runtime-check',
      status: 'passed',
      detail: descriptor.compatibility.detail,
    })
  } else if (descriptor.compatibility.level === 'unknown') {
    status = 'unchecked'
  } else if (['adapter', 'fork'].includes(descriptor.compatibility.level)) {
    status = 'adapter-required'
    suggestedActions.push(
      descriptor.compatibility.level === 'adapter'
        ? '实现稳定 Adapter Contract，先跑契约测试，再进入受信最小运行验证。'
        : '在独立 Fork 中记录补丁和许可证影响，通过契约测试后再做最小运行验证。',
    )
  } else if (descriptor.compatibility.level === 'configuration' || descriptor.configSchema) {
    status = 'configuration-required'
    suggestedActions.push('完成配置映射，将密钥仅保存为 Keychain 引用，然后重新执行静态检查。')
  } else {
    status = 'static-passed'
    suggestedActions.push('静态检查已通过；在首次运行前仍需使用受信 Profile 完成最小运行验证。')
  }

  return compatibilityAssessmentSchema.parse({
    componentId: input.componentId,
    status,
    evidence,
    blockers,
    suggestedActions: [...new Set(suggestedActions)],
    checkedAt: input.checkedAt,
    method,
  })
}
