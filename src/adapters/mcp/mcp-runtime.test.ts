import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { McpServer } from '../../shared/agent-profile'
import { McpRuntime } from './mcp-runtime'

const fixturePath = path.resolve('src/test/fixtures/mcp/stdio-server.mjs')

function server(input: Partial<McpServer> = {}): McpServer {
  return {
    id: 'fixture-mcp',
    name: 'Fixture MCP',
    transport: 'stdio',
    command: process.execPath,
    args: [fixturePath],
    url: null,
    secretReferences: [],
    enabled: true,
    approval: 'approved',
    ...input,
  }
}

describe('McpRuntime', () => {
  it('initializes a controlled stdio server, lists tools, calls once, and cleans up', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'studio-mcp-runtime-'))
    const runtime = new McpRuntime()
    const lease = await runtime.connect(server(), { cwd, timeoutMs: 5_000 })

    expect(lease.executable).toBe(process.execPath)
    expect(lease.tools.map(({ name }) => name)).toEqual(['fixture_echo'])
    await expect(lease.callTool('fixture_echo', { value: 'hello' })).resolves.toContain(
      'fixture:hello',
    )
    await lease.close()
    await runtime.close()
  })

  it('requires explicit approval and returns a recoverable missing-command failure', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'studio-mcp-runtime-'))
    const runtime = new McpRuntime()

    await expect(
      runtime.validate(server({ approval: 'review-required' }), { cwd, timeoutMs: 5_000 }),
    ).rejects.toMatchObject({
      failure: { code: 'approval-required', retryable: false },
    })
    await expect(
      runtime.validate(server({ command: '/missing/studio-mcp-fixture' }), {
        cwd,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({
      failure: { code: 'command-not-found', retryable: true },
    })
  })

  it('separates handshake, protocol, timeout, cancellation, and tool-call failures', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'studio-mcp-failures-'))
    const runtime = new McpRuntime()

    await expect(
      runtime.validate(server({ args: [fixturePath, '--handshake-error'] }), {
        cwd,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ failure: { code: 'handshake-failed' } })
    await expect(
      runtime.validate(server({ args: [fixturePath, '--invalid-json'] }), {
        cwd,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ failure: { code: 'protocol-invalid' } })
    await expect(
      runtime.validate(server({ args: [fixturePath, '--hang'] }), { cwd, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ failure: { code: 'operation-timed-out' } })

    const controller = new AbortController()
    const cancelled = runtime.validate(server({ args: [fixturePath, '--hang'] }), {
      cwd,
      timeoutMs: 5_000,
      signal: controller.signal,
    })
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({
      failure: { code: 'operation-cancelled' },
    })

    const lease = await runtime.connect(server({ args: [fixturePath, '--tool-error'] }), {
      cwd,
      timeoutMs: 5_000,
    })
    await expect(lease.callTool('fixture_echo', { value: 'fail' })).rejects.toMatchObject({
      failure: { code: 'tool-call-failed' },
    })
    await lease.close()
    await runtime.close()
  }, 15_000)

  it('bounds concurrent access to one server and times out a waiter', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'studio-mcp-single-flight-'))
    const runtime = new McpRuntime()
    const first = await runtime.connect(server(), { cwd, timeoutMs: 5_000 })

    await expect(runtime.connect(server(), { cwd, timeoutMs: 1_000 })).rejects.toMatchObject({
      failure: { code: 'operation-timed-out' },
    })
    await first.close()
    await expect(runtime.validate(server(), { cwd, timeoutMs: 5_000 })).resolves.toMatchObject({
      tools: [expect.objectContaining({ name: 'fixture_echo' })],
    })
    await runtime.close()
  })

  it('speaks Streamable HTTP JSON-RPC without following redirects', async () => {
    const requests: Array<{ method: string; headers: Headers }> = []
    const fetchImplementation: typeof fetch = (_input, init) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const payload = JSON.parse(body) as { id?: number; method: string }
      requests.push({ method: payload.method, headers: new Headers(init?.headers) })
      const result =
        payload.method === 'initialize'
          ? {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'http-fixture', version: '1' },
            }
          : payload.method === 'tools/list'
            ? { tools: [{ name: 'http_echo', inputSchema: { type: 'object' } }] }
            : null
      return Promise.resolve(
        new Response(
          payload.id ? JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }) : null,
          {
            status: payload.id ? 200 : 202,
            headers: {
              'content-type': 'application/json',
              ...(payload.method === 'initialize' ? { 'mcp-session-id': 'session-1' } : {}),
            },
          },
        ),
      )
    }
    const runtime = new McpRuntime({ fetch: fetchImplementation })
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'studio-mcp-http-'))
    const result = await runtime.validate(
      server({
        transport: 'http',
        command: null,
        args: [],
        url: 'https://mcp.example.test/rpc',
      }),
      { cwd, timeoutMs: 5_000 },
    )

    expect(result.tools.map(({ name }) => name)).toEqual(['http_echo'])
    expect(requests.map(({ method }) => method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ])
    expect(requests.at(-1)?.headers.get('mcp-session-id')).toBe('session-1')
  })
})
