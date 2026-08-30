import { z } from 'zod'
import { mcpServerSchema, type McpServer } from './agent-profile'
import { harnessIdSchema, type HarnessId } from './native-agent'

export const mcpSupportLevelSchema = z.enum(['adapted', 'unavailable'])

export const mcpTransportSupportSchema = z
  .object({
    harnessId: harnessIdSchema,
    transport: z.enum(['stdio', 'http']),
    level: mcpSupportLevelSchema,
    detail: z.string().trim().min(1).max(500),
    recoveryAction: z.string().trim().min(1).max(300),
  })
  .strict()

export function mcpTransportSupport(
  harnessId: HarnessId,
  transport: McpServer['transport'],
): z.infer<typeof mcpTransportSupportSchema> {
  if (harnessId === 'pi') {
    return mcpTransportSupportSchema.parse({
      harnessId,
      transport,
      level: 'adapted',
      detail:
        transport === 'stdio'
          ? 'Studio Native Runtime 为 Pi 受控启动本地进程，完成 MCP 握手、工具发现和调用。'
          : 'Studio Native Runtime 为 Pi 连接用户明确配置的 Streamable HTTP MCP。',
      recoveryAction: '保持 Pi，并完成该 MCP 的明确批准与连接验证。',
    })
  }
  return mcpTransportSupportSchema.parse({
    harnessId,
    transport,
    level: 'unavailable',
    detail: `${harnessId === 'openclaw' ? 'OpenClaw' : 'Codex CLI'} 当前 Host Driver 没有消费 Agent Profile 中的 ${transport === 'stdio' ? 'stdio' : 'HTTP'} MCP 配置。`,
    recoveryAction: '移除该 MCP，或切换到 Pi Native Harness。',
  })
}

export const mcpToolSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2_000).optional(),
    inputSchema: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough()

export const mcpToolListSchema = z.array(mcpToolSchema).max(200)

export const mcpValidationFailureSchema = z
  .object({
    code: z.enum([
      'approval-required',
      'command-not-found',
      'transport-unsupported',
      'handshake-failed',
      'protocol-invalid',
      'operation-timed-out',
      'operation-cancelled',
      'tool-list-failed',
      'tool-call-failed',
      'network-failed',
    ]),
    message: z.string().trim().min(1).max(1_000),
    recoveryAction: z.string().trim().min(1).max(500),
    retryable: z.boolean(),
  })
  .strict()

export const mcpValidationRecordSchema = z
  .object({
    serverId: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{1,63}$/),
    configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
    server: mcpServerSchema,
    state: z.enum(['succeeded', 'failed']),
    transport: z.enum(['stdio', 'http']),
    checkedAt: z.iso.datetime(),
    executable: z.string().max(2_000).nullable(),
    toolNames: z.array(z.string().trim().min(1).max(200)).max(200),
    failure: mcpValidationFailureSchema.nullable(),
  })
  .strict()

export const mcpValidationInputSchema = z
  .object({
    id: z.uuid(),
    serverId: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{1,63}$/),
    requestId: z.uuid(),
    timeoutMs: z.number().int().min(1_000).max(60_000).default(15_000),
  })
  .strict()

export const mcpValidationActionResultSchema = z
  .object({
    status: z.enum(['completed', 'cancelled']),
  })
  .strict()

export type McpTransportSupport = z.infer<typeof mcpTransportSupportSchema>
export type McpTool = z.infer<typeof mcpToolSchema>
export type McpValidationFailure = z.infer<typeof mcpValidationFailureSchema>
export type McpValidationRecord = z.infer<typeof mcpValidationRecordSchema>
export type McpValidationInput = z.infer<typeof mcpValidationInputSchema>
