import { z } from 'zod'
import { componentDescriptorSchema } from './component'
import { mcpServerSchema } from './agent-profile'
import { harnessIdSchema } from './native-agent'

const setupCapabilityIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9-]{1,79}$/)

export const setupCapabilitySupportSchema = z
  .object({
    harnessId: harnessIdSchema,
    level: z.enum(['native', 'adapted', 'degraded', 'unavailable']),
    detail: z.string().trim().min(1).max(500),
  })
  .strict()

const setupCapabilityBaseSchema = z.object({
  id: setupCapabilityIdSchema,
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500),
  sourceLabel: z.string().trim().min(1).max(160),
  sourceDetail: z.string().trim().min(1).max(1_000),
  support: setupCapabilitySupportSchema,
})

export const setupCapabilityItemSchema = z.discriminatedUnion('kind', [
  setupCapabilityBaseSchema
    .extend({
      kind: z.literal('prompt'),
      content: z.string().trim().min(1).max(120_000),
    })
    .strict(),
  setupCapabilityBaseSchema
    .extend({
      kind: z.literal('mcp'),
      server: mcpServerSchema,
    })
    .strict(),
  setupCapabilityBaseSchema
    .extend({
      kind: z.literal('memory'),
      content: z.string().trim().min(1).max(120_000),
    })
    .strict(),
  setupCapabilityBaseSchema
    .extend({
      kind: z.literal('skill'),
      recipeId: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
    })
    .strict(),
  setupCapabilityBaseSchema
    .extend({
      kind: z.literal('component'),
      componentId: z.uuid(),
      descriptor: componentDescriptorSchema,
    })
    .strict(),
])

export const setupCapabilityCatalogSchema = z
  .object({
    items: z.array(setupCapabilityItemSchema).max(200),
    projectComponents: z
      .object({
        state: z.enum(['ready', 'empty', 'error']),
        message: z.string().trim().min(1).max(1_000),
      })
      .strict(),
  })
  .strict()

export const setupCapabilitySelectionIdsSchema = z
  .array(setupCapabilityIdSchema)
  .max(100)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: '能力选择不能重复。' })
    }
  })

export const builtInSetupCapabilityTemplates = [
  {
    id: 'prompt:clear-assistant',
    kind: 'prompt',
    name: '清晰助手',
    summary: '使回答先给结论，再给出必要证据与下一步。',
    sourceLabel: 'Studio 内置 Prompt 模板',
    sourceDetail: '随应用版本分发的可审查文本，选择后写入 Agent Profile。',
    content:
      '你是一位清晰、可靠的助手。先直接回答问题，再补充必要的证据、限制和可执行的下一步。不确定时明确说明，不编造事实。',
  },
  {
    id: 'prompt:research-reviewer',
    kind: 'prompt',
    name: '调研审阅者',
    summary: '分开事实、推断和未验证主张，适合本地调研与证据复核。',
    sourceLabel: 'Studio 内置 Prompt 模板',
    sourceDetail: '随应用版本分发的可审查文本，不会自动访问网络。',
    content:
      '审阅输入时分开已验证事实、合理推断和未验证主张。指出证据缺口、可能的反例和下一个最小验证动作。不将静态证据表述为真实运行结论。',
  },
  {
    id: 'memory:project-brief',
    kind: 'memory',
    name: '项目简报记忆',
    summary: '为目标、边界、术语和待决问题预留稳定结构。',
    sourceLabel: 'Studio 内置 Memory 模板',
    sourceDetail: '非敏感 Markdown 模板，仅随 Agent Profile 保存。',
    content:
      '# 项目简报\n\n## 目标\n\n待补充。\n\n## 约束与边界\n\n待补充。\n\n## 关键术语\n\n待补充。\n\n## 待决问题\n\n待补充。',
  },
  {
    id: 'memory:decision-log',
    kind: 'memory',
    name: '决策记录记忆',
    summary: '记录日期、决策、理由、证据和复审条件。',
    sourceLabel: 'Studio 内置 Memory 模板',
    sourceDetail: '非敏感 Markdown 模板，仅随 Agent Profile 保存。',
    content: '# 决策记录\n\n## YYYY-MM-DD\n\n- 决策：\n- 理由：\n- 证据：\n- 复审条件：',
  },
] as const

export type SetupCapabilityItem = z.infer<typeof setupCapabilityItemSchema>
export type SetupCapabilityCatalog = z.infer<typeof setupCapabilityCatalogSchema>
