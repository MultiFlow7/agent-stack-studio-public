import { z } from 'zod'

const profileIdentifierSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,63}$/)

export const agentSkillSchema = z
  .object({
    id: profileIdentifierSchema,
    name: z.string().trim().min(1).max(100),
    markdown: z.string().max(40_000),
    enabled: z.boolean(),
  })
  .strict()

export const mcpServerSchema = z
  .object({
    id: profileIdentifierSchema,
    name: z.string().trim().min(1).max(100),
    transport: z.enum(['stdio', 'http']),
    command: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .refine((value) => !/[\0\r\n]/.test(value), '可执行文件不能包含换行或 NUL。')
      .nullable(),
    args: z
      .array(
        z
          .string()
          .max(1_000)
          .refine((value) => !value.includes('\0'), 'MCP 参数不能包含 NUL。'),
      )
      .max(40),
    url: z.url().max(2_000).nullable(),
    secretReferences: z
      .array(
        z
          .string()
          .regex(/^[A-Z][A-Z0-9_]{1,79}$/)
          .max(80),
      )
      .max(20),
    enabled: z.boolean(),
    approval: z.enum(['review-required', 'approved']),
  })
  .strict()
  .superRefine((server, context) => {
    if (server.transport === 'stdio' && !server.command) {
      context.addIssue({ code: 'custom', path: ['command'], message: 'stdio MCP 需要 command。' })
    }
    if (server.transport === 'http' && !server.url) {
      context.addIssue({ code: 'custom', path: ['url'], message: 'HTTP MCP 需要 URL。' })
    }
    if (server.transport === 'stdio' && server.url) {
      context.addIssue({ code: 'custom', path: ['url'], message: 'stdio MCP 不使用 URL。' })
    }
    if (server.transport === 'http' && (server.command || server.args.length)) {
      context.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'HTTP MCP 不使用 command/args。',
      })
    }
    if (server.url) {
      const url = new URL(server.url)
      const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
        context.addIssue({
          code: 'custom',
          path: ['url'],
          message: '远程 MCP 必须使用 HTTPS；仅 loopback 地址可使用 HTTP。',
        })
      }
      if (url.username || url.password || url.hash) {
        context.addIssue({
          code: 'custom',
          path: ['url'],
          message: 'MCP URL 不能嵌入凭证或 fragment。',
        })
      }
      if (url.search) {
        context.addIssue({
          code: 'custom',
          path: ['url'],
          message: 'MCP URL 不能包含查询参数；敏感值必须留在 Keychain 边界。',
        })
      }
    }
    if (
      server.args.some((argument) =>
        /(?:authorization|password|secret|token|api[-_]?key)/i.test(argument),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['args'],
        message: 'MCP 参数不能携带疑似凭证；敏感值必须留在 Keychain 边界。',
      })
    }
  })

export const agentProfileSchema = z
  .object({
    instructions: z.string().max(40_000),
    memoryMarkdown: z.string().max(120_000),
    skills: z.array(agentSkillSchema).max(50),
    mcpServers: z.array(mcpServerSchema).max(30),
    toolPolicy: z.enum(['read-only', 'workspace']),
  })
  .strict()
  .superRefine((profile, context) => {
    for (const [field, values] of [
      ['skills', profile.skills],
      ['mcpServers', profile.mcpServers],
    ] as const) {
      const ids = values.map(({ id }) => id)
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: 'custom', path: [field], message: `${field} ID 不能重复。` })
      }
    }
  })

export const defaultAgentProfile: AgentProfile = {
  instructions: '',
  memoryMarkdown: '',
  skills: [],
  mcpServers: [],
  toolPolicy: 'read-only',
}

export type AgentProfile = z.infer<typeof agentProfileSchema>
export type AgentSkill = z.infer<typeof agentSkillSchema>
export type McpServer = z.infer<typeof mcpServerSchema>
