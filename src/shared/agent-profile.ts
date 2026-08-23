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
    command: z.string().trim().min(1).max(1_000).nullable(),
    args: z.array(z.string().max(1_000)).max(40),
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
