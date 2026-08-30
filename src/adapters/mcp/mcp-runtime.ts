import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { z } from 'zod'
import { minimalChildEnvironment, resolveExecutable } from '../harness/host-driver'
import type { McpServer } from '../../shared/agent-profile'
import {
  mcpToolListSchema,
  mcpValidationFailureSchema,
  type McpTool,
  type McpValidationFailure,
} from '../../shared/mcp'

const PROTOCOL_VERSION = '2024-11-05'
const MAX_MESSAGE_BYTES = 1024 * 1024
const MAX_TOOL_RESULT_BYTES = 64 * 1024

const jsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.number().int(), z.string()]),
    result: z.unknown().optional(),
    error: z
      .object({ code: z.number().int(), message: z.string(), data: z.unknown().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough()

const toolListResultSchema = z.object({ tools: mcpToolListSchema }).passthrough()

export class McpRuntimeError extends Error {
  readonly failure: McpValidationFailure

  constructor(failure: McpValidationFailure) {
    super(failure.message)
    this.name = 'McpRuntimeError'
    this.failure = mcpValidationFailureSchema.parse(failure)
  }
}

function failure(
  code: McpValidationFailure['code'],
  message: string,
  recoveryAction: string,
  retryable = true,
): McpRuntimeError {
  return new McpRuntimeError({ code, message, recoveryAction, retryable })
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function abortFailure(signal: AbortSignal | undefined): McpRuntimeError {
  const reason = signal?.reason as unknown
  const timedOut =
    typeof reason === 'object' &&
    reason !== null &&
    'name' in reason &&
    reason.name === 'TimeoutError'
  return timedOut || !signal?.aborted
    ? failure(
        'operation-timed-out',
        'MCP 连接或调用超时。',
        '确认 server 可用并缩短单次工具处理后重试。',
      )
    : failure('operation-cancelled', 'MCP 连接已取消。', '准备好后重新测试或运行。')
}

function redactMcpOutput(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .slice(0, MAX_TOOL_RESULT_BYTES)
}

interface McpConnection {
  readonly executable: string | null
  initialize(signal: AbortSignal): Promise<McpTool[]>
  callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string>
  close(): Promise<void>
}

abstract class JsonRpcConnection implements McpConnection {
  abstract readonly executable: string | null
  #nextId = 1

  abstract request(method: string, params: unknown, signal: AbortSignal): Promise<unknown>
  abstract notify(method: string, params?: unknown): Promise<void>
  abstract close(): Promise<void>

  protected requestPayload(
    method: string,
    params: unknown,
  ): {
    id: number
    payload: Record<string, unknown>
  } {
    const id = this.#nextId++
    return { id, payload: { jsonrpc: '2.0', id, method, params } }
  }

  async initialize(signal: AbortSignal): Promise<McpTool[]> {
    const initialized = await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'Agent Stack Studio', version: '0.9.0' },
      },
      signal,
    )
    const handshake = z
      .object({ protocolVersion: z.string().min(1), serverInfo: z.unknown().optional() })
      .passthrough()
      .safeParse(initialized)
    if (!handshake.success) {
      throw failure(
        'handshake-failed',
        'MCP server 返回了无效的 initialize 结果。',
        '确认这是兼容 MCP 2024-11-05 的 server，并检查启动参数。',
      )
    }
    await this.notify('notifications/initialized')
    const listed = toolListResultSchema.safeParse(await this.request('tools/list', {}, signal))
    if (!listed.success) {
      throw failure(
        'tool-list-failed',
        'MCP server 未返回可识别的工具目录。',
        '检查 server 的 tools/list 实现后重试。',
      )
    }
    return listed.data.tools
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> {
    let result: unknown
    try {
      result = await this.request('tools/call', { name, arguments: args }, signal)
    } catch (error) {
      if (error instanceof McpRuntimeError) throw error
      throw failure(
        'tool-call-failed',
        `MCP 工具 ${name} 调用失败。`,
        '检查工具参数和 server 状态后重试。',
      )
    }
    return redactMcpOutput(JSON.stringify(result))
  }
}

class StdioMcpConnection extends JsonRpcConnection {
  readonly executable: string
  readonly #child: ChildProcessWithoutNullStreams
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; cleanup: () => void }
  >()
  #buffer = Buffer.alloc(0)
  #closed = false

  private constructor(executable: string, child: ChildProcessWithoutNullStreams) {
    super()
    this.executable = executable
    this.#child = child
    child.stdout.on('data', (chunk: Buffer) => this.#receive(chunk))
    child.stderr.on('data', () => undefined)
    child.once('error', () => this.#rejectPending('MCP server 进程无法启动。'))
    child.once('exit', () => this.#rejectPending('MCP server 在协议完成前退出。'))
  }

  static async start(server: McpServer, cwd: string): Promise<StdioMcpConnection> {
    if (!server.command) {
      throw failure(
        'command-not-found',
        'stdio MCP 没有可执行文件。',
        '重新选择可执行文件。',
        false,
      )
    }
    if (server.command.includes(path.sep) && !path.isAbsolute(server.command)) {
      throw failure(
        'command-not-found',
        '带路径的 MCP 可执行文件必须使用绝对路径。',
        '通过完整绝对路径重新选择 server。',
        false,
      )
    }
    const executable = await resolveExecutable(server.command)
    if (!executable) {
      throw failure(
        'command-not-found',
        `找不到已批准的 MCP 可执行文件 ${path.basename(server.command)}。`,
        '确认文件仍存在且可执行，或重新选择 server。',
      )
    }
    const child = spawn(executable, server.args, {
      cwd,
      env: minimalChildEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
    })
    return new StdioMcpConnection(executable, child)
  }

  request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.#closed)
      return Promise.reject(failure('handshake-failed', 'MCP server 已关闭。', '重新连接。'))
    if (signal.aborted) return Promise.reject(abortFailure(signal))
    const { id, payload } = this.requestPayload(method, params)
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.#pending.delete(id)
        reject(abortFailure(signal))
      }
      signal.addEventListener('abort', abort, { once: true })
      this.#pending.set(id, {
        resolve,
        reject,
        cleanup: () => signal.removeEventListener('abort', abort),
      })
      this.#child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return
        const pending = this.#pending.get(id)
        if (!pending) return
        this.#pending.delete(id)
        pending.cleanup()
        reject(failure('handshake-failed', 'MCP server 标准输入已关闭。', '重启 server 后重试。'))
      })
    })
  }

  notify(method: string, params?: unknown): Promise<void> {
    if (this.#closed) return Promise.resolve()
    this.#child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })}\n`,
    )
    return Promise.resolve()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#rejectPending('MCP server 连接已关闭。')
    this.#child.stdin.end()
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return
    if (this.#child.pid) {
      try {
        process.kill(-this.#child.pid, 'SIGTERM')
      } catch {
        this.#child.kill('SIGTERM')
      }
    }
    await Promise.race([
      new Promise<void>((resolve) => this.#child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
    ])
    if (this.#child.exitCode === null && this.#child.signalCode === null && this.#child.pid) {
      try {
        process.kill(-this.#child.pid, 'SIGKILL')
      } catch {
        this.#child.kill('SIGKILL')
      }
    }
  }

  #receive(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk])
    if (this.#buffer.byteLength > MAX_MESSAGE_BYTES) {
      this.#rejectPending('MCP server 输出超出协议大小上限。')
      void this.close()
      return
    }
    let newline = this.#buffer.indexOf(0x0a)
    while (newline >= 0) {
      const line = this.#buffer.subarray(0, newline).toString('utf8').trim()
      this.#buffer = this.#buffer.subarray(newline + 1)
      if (line) this.#message(line)
      newline = this.#buffer.indexOf(0x0a)
    }
  }

  #message(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.#rejectPending('MCP server 返回了无效 JSON-RPC。')
      return
    }
    const response = jsonRpcResponseSchema.safeParse(parsed)
    if (!response.success || typeof response.data.id !== 'number') return
    const pending = this.#pending.get(response.data.id)
    if (!pending) return
    this.#pending.delete(response.data.id)
    pending.cleanup()
    if (response.data.error) {
      pending.reject(
        failure(
          response.data.id === 1 ? 'handshake-failed' : 'tool-call-failed',
          'MCP server 拒绝了协议请求。',
          '检查 server 配置、协议版本和工具参数后重试。',
        ),
      )
    } else pending.resolve(response.data.result)
  }

  #rejectPending(message: string): void {
    for (const pending of this.#pending.values()) {
      pending.cleanup()
      pending.reject(failure('protocol-invalid', message, '检查 server 协议输出后重试。'))
    }
    this.#pending.clear()
  }
}

class HttpMcpConnection extends JsonRpcConnection {
  readonly executable = null
  readonly #url: string
  readonly #fetch: typeof fetch
  #sessionId: string | null = null

  constructor(url: string, fetchImplementation: typeof fetch) {
    super()
    this.#url = url
    this.#fetch = fetchImplementation
  }

  async request(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    const { payload } = this.requestPayload(method, params)
    return this.#post(payload, signal)
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.#post(
      { jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) },
      AbortSignal.timeout(10_000),
      true,
    )
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  async #post(
    payload: Record<string, unknown>,
    signal: AbortSignal,
    notification = false,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await this.#fetch(this.#url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(this.#sessionId ? { 'mcp-session-id': this.#sessionId } : {}),
        },
        body: JSON.stringify(payload),
        signal,
      })
    } catch {
      if (signal.aborted) throw abortFailure(signal)
      throw failure('network-failed', '无法连接远程 MCP server。', '检查 URL 和网络后重试。')
    }
    if (response.status >= 300 && response.status < 400) {
      throw failure(
        'network-failed',
        '远程 MCP 返回了未批准的重定向。',
        '直接配置最终 HTTPS URL。',
        false,
      )
    }
    if (!response.ok) {
      throw failure(
        'handshake-failed',
        `远程 MCP 返回 HTTP ${response.status}。`,
        '检查 server 状态与 URL 后重试。',
      )
    }
    this.#sessionId = response.headers.get('mcp-session-id') ?? this.#sessionId
    if (notification || response.status === 202 || response.status === 204) return null
    const text = (await response.text()).slice(0, MAX_MESSAGE_BYTES)
    const contentType = response.headers.get('content-type') ?? ''
    const body = contentType.includes('text/event-stream')
      ? text
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .find((line) => line && line !== '[DONE]')
      : text
    let parsed: unknown
    try {
      parsed = JSON.parse(body || '')
    } catch {
      throw failure(
        'protocol-invalid',
        '远程 MCP 未返回有效 JSON-RPC。',
        '检查 Streamable HTTP 实现。',
      )
    }
    const responsePayload = jsonRpcResponseSchema.safeParse(parsed)
    if (!responsePayload.success) {
      throw failure('protocol-invalid', '远程 MCP 响应结构无效。', '检查 Streamable HTTP 实现。')
    }
    if (responsePayload.data.error) {
      const method = typeof payload.method === 'string' ? payload.method : ''
      const code =
        method === 'tools/call'
          ? 'tool-call-failed'
          : method === 'tools/list'
            ? 'tool-list-failed'
            : 'handshake-failed'
      throw failure(code, '远程 MCP 拒绝了协议请求。', '检查 server 配置、协议版本和工具参数。')
    }
    return responsePayload.data.result
  }
}

export interface McpLease {
  readonly server: McpServer
  readonly executable: string | null
  readonly tools: McpTool[]
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>
  close(): Promise<void>
}

export class McpRuntime {
  readonly #fetch: typeof fetch
  readonly #locks = new Map<string, { done: Promise<void>; release: () => void }>()
  readonly #connections = new Set<McpConnection>()

  constructor(options: { fetch?: typeof fetch } = {}) {
    this.#fetch = options.fetch ?? fetch
  }

  async connect(
    server: McpServer,
    options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
  ): Promise<McpLease> {
    if (!server.enabled) {
      throw failure('approval-required', 'MCP server 尚未启用。', '启用后重新测试。', false)
    }
    if (server.approval !== 'approved') {
      throw failure(
        'approval-required',
        `MCP server“${server.name}”尚未获得明确批准。`,
        '审查来源、可执行文件或 URL 与参数，勾选批准后再测试。',
        false,
      )
    }
    if (server.secretReferences.length) {
      throw failure(
        'approval-required',
        '当前 MCP 引用了未解析的 Secret。',
        '在 Keychain 解析边界完成对应 Secret 引用后重试。',
        false,
      )
    }
    const signal = withTimeout(options.signal, options.timeoutMs)
    const key = `${path.resolve(options.cwd)}\0${server.id}`
    while (this.#locks.has(key)) {
      const waiting = this.#locks.get(key)!.done
      await Promise.race([waiting, this.#abortPromise(signal)])
    }
    let releaseLock!: () => void
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const lockEntry = { done: lock, release: releaseLock }
    this.#locks.set(key, lockEntry)
    let connection: McpConnection | null = null
    try {
      connection =
        server.transport === 'stdio'
          ? await StdioMcpConnection.start(server, options.cwd)
          : new HttpMcpConnection(server.url!, this.#fetch)
      this.#connections.add(connection)
      const tools = await connection.initialize(signal)
      let closed = false
      const close = async () => {
        if (closed) return
        closed = true
        this.#connections.delete(connection!)
        await connection!.close()
        if (this.#locks.get(key) === lockEntry) this.#locks.delete(key)
        releaseLock()
      }
      return {
        server,
        executable: connection.executable,
        tools,
        callTool: (name, args, callSignal) => {
          if (!tools.some((tool) => tool.name === name)) {
            return Promise.reject(
              failure(
                'tool-call-failed',
                `MCP 工具 ${name} 不在已验证目录中。`,
                '重新发现工具后再调用。',
                false,
              ),
            )
          }
          return connection!.callTool(
            name,
            args,
            withTimeout(callSignal ?? options.signal, options.timeoutMs),
          )
        },
        close,
      }
    } catch (error) {
      if (connection) {
        this.#connections.delete(connection)
        await connection.close().catch(() => undefined)
      }
      if (this.#locks.get(key) === lockEntry) this.#locks.delete(key)
      releaseLock()
      if (error instanceof McpRuntimeError) throw error
      if (signal.aborted) throw abortFailure(options.signal)
      throw failure('handshake-failed', 'MCP 初始化失败。', '检查 server 配置后重试。')
    }
  }

  async validate(
    server: McpServer,
    options: { cwd: string; timeoutMs: number; signal?: AbortSignal },
  ): Promise<{ executable: string | null; tools: McpTool[] }> {
    const lease = await this.connect(server, options)
    try {
      return { executable: lease.executable, tools: lease.tools }
    } finally {
      await lease.close()
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.#connections].map((connection) => connection.close()))
    this.#connections.clear()
    for (const { release } of this.#locks.values()) release()
    this.#locks.clear()
  }

  #abortPromise(signal: AbortSignal): Promise<never> {
    return new Promise((_, reject) => {
      if (signal.aborted) reject(abortFailure(signal))
      else signal.addEventListener('abort', () => reject(abortFailure(signal)), { once: true })
    })
  }
}
