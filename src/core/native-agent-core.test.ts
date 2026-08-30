import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { HarnessHostDriver, HostDriverExecuteInput } from '../adapters/harness/host-driver'
import { HostDriverRegistry } from '../adapters/harness/host-driver-registry'
import { harnessProbeSchema } from '../shared/native-agent'
import { harnessModelCapability, modelAuthenticationStatusSchema } from '../shared/model-auth'
import { defaultAgentProfile } from '../shared/agent-profile'
import { NativeAgentCore } from './native-agent-core'
import { StudioCore } from './studio-core'

const credentials = {
  withExecutionCredential: <T>(
    _input: unknown,
    operation: (credential: { kind: 'harness-login' }) => Promise<T>,
  ) => operation({ kind: 'harness-login' }),
}

async function selectPiModel(studio: StudioCore, root: string, expectedRevision: number) {
  const selected = await studio.selectKnownHarness(root, 'pi', { expectedRevision })
  return studio.updateModelConfiguration(
    root,
    {
      providerId: 'openai',
      modelId: 'gpt-5.1',
      credentialRequirement: {
        method: 'existing-login',
        credentialKind: 'harness-session',
      },
    },
    { expectedRevision: selected.project.revision },
  )
}

function driver(execute: HarnessHostDriver['execute']): HarnessHostDriver {
  return {
    id: 'pi',
    modelCapability: harnessModelCapability('pi'),
    probe: () =>
      Promise.resolve(
        harnessProbeSchema.parse({
          id: 'pi',
          label: 'Pi',
          executable: '/test/pi',
          status: 'ready',
          version: '0.84.2',
          requiredVersion: '0.84.2',
          capabilities: {
            prompt: 'native',
            skills: 'native',
            memory: 'adapted',
            mcp: 'adapted',
            sessions: 'native',
          },
          detail: '测试边界中的受控 Driver。',
        }),
      ),
    authenticationStatus: (input) =>
      Promise.resolve(
        modelAuthenticationStatusSchema.parse({
          harnessId: 'pi',
          providerId: input.selection.providerId,
          authMethod: input.selection.credentialRequirement.method,
          state: 'credential-valid',
          detail: '测试 Driver 已认证。',
          checkedAt: new Date().toISOString(),
          failure: null,
        }),
      ),
    verifyModel: (input) =>
      execute({
        kind: 'run',
        message: 'MODEL_CONNECTION_OK',
        sessionId: crypto.randomUUID(),
        projectRoot: input.cwd,
        stateRoot: input.stateRoot,
        profile: defaultAgentProfile,
        model: input.selection,
        credential: input.credential,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      }),
    execute,
  }
}

describe('NativeAgentCore', () => {
  it('uses the selected real-driver contract, preserves project facts, and retries idempotently', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio-native-core-'))
    const studio = new StudioCore()
    const initialized = await studio.initProject(root, { name: 'Native Agent' })
    await selectPiModel(studio, root, initialized.project.revision)
    const execute = vi.fn((input: HostDriverExecuteInput) =>
      Promise.resolve({
        harnessVersion: '0.84.2',
        responseMarkdown: `真实 Driver 契约收到：${input.message}`,
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
        modelLayer: { kind: 'harness-provider' as const, provider: 'fake-provider', model: null },
        degradedFeatures: ['MCP 未执行。'],
      }),
    )
    const native = new NativeAgentCore(
      new HostDriverRegistry([driver(execute)]),
      undefined,
      credentials,
    )
    const input = {
      projectPath: root,
      kind: 'run' as const,
      message: '检查项目',
      timeoutMs: 5_000,
      idempotencyKey: 'run-1',
    }
    const first = await native.execute(input)
    const retried = await native.execute(input)

    expect(first).toMatchObject({
      status: 'succeeded',
      harness: 'pi',
      harnessVersion: '0.84.2',
      projectRevision: 2,
      responseMarkdown: '真实 Driver 契约收到：检查项目',
    })
    expect(retried).toEqual(first)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(await native.list(root, 'run')).toEqual([first])
    expect((await studio.inspectProject(root)).project.revision).toBe(2)
  })

  it('forwards cancellation and persists a cancelled result without chat/log data in project facts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio-native-cancel-'))
    const studio = new StudioCore()
    const initialized = await studio.initProject(root, { name: 'Cancel Agent' })
    await selectPiModel(studio, root, initialized.project.revision)
    const execute = (input: HostDriverExecuteInput) =>
      new Promise<never>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(new Error('Harness 运行已取消。')), {
          once: true,
        })
      })
    const native = new NativeAgentCore(
      new HostDriverRegistry([driver(execute)]),
      undefined,
      credentials,
    )
    const requestId = crypto.randomUUID()
    const pending = native.execute({
      projectPath: root,
      kind: 'chat',
      message: '不会进入项目事实的消息',
      requestId,
      timeoutMs: 5_000,
    })
    await vi.waitFor(() => expect(native.cancelProject(initialized.project.id)).toBe(1))
    expect(native.cancel(requestId)).toBe(false)
    const result = await pending

    expect(result.status).toBe('cancelled')
    const inspected = await studio.inspectProject(root)
    expect(JSON.stringify(inspected.project)).not.toContain('不会进入项目事实的消息')
  })

  it('never persists an opaque Driver error in native history or the returned failure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio-native-redaction-'))
    const studio = new StudioCore()
    const initialized = await studio.initProject(root, { name: 'Redaction Agent' })
    await selectPiModel(studio, root, initialized.project.revision)
    const canary = 'opaque-driver-canary-837e0d'
    const native = new NativeAgentCore(
      new HostDriverRegistry([
        driver(() => Promise.reject(new Error(`provider failed: ${canary}`))),
      ]),
      undefined,
      credentials,
    )

    const result = await native.execute({
      projectPath: root,
      kind: 'run',
      message: '检查脱敏',
      timeoutMs: 5_000,
    })
    const history = await readFile(
      path.join(root, '.agent-stack-local', 'native-history.jsonl'),
      'utf8',
    )
    expect(JSON.stringify(result)).not.toContain(canary)
    expect(history).not.toContain(canary)
    expect(result.failure).toMatchObject({ code: 'HARNESS_FAILED' })
  })

  it('lets one Pi Native run discover and call an approved local stdio MCP tool', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio-native-mcp-'))
    const studio = new StudioCore()
    const initialized = await studio.initProject(root, { name: 'MCP Agent' })
    const selected = await selectPiModel(studio, root, initialized.project.revision)
    await studio.updateAgentProfile(
      root,
      {
        ...defaultAgentProfile,
        mcpServers: [
          {
            id: 'fixture-mcp',
            name: 'Fixture MCP',
            transport: 'stdio',
            command: process.execPath,
            args: [path.resolve('src/test/fixtures/mcp/stdio-server.mjs')],
            url: null,
            secretReferences: [],
            enabled: true,
            approval: 'approved',
          },
        ],
      },
      { expectedRevision: selected.project.revision },
    )
    const execute = vi
      .fn<HarnessHostDriver['execute']>()
      .mockResolvedValueOnce({
        harnessVersion: '0.84.2',
        responseMarkdown:
          '<studio-mcp-call>{"serverId":"fixture-mcp","name":"fixture_echo","arguments":{"value":"native-run"}}</studio-mcp-call>',
        usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        modelLayer: { kind: 'harness-provider', provider: 'fake-provider', model: 'fake-model' },
        degradedFeatures: [],
      })
      .mockImplementationOnce((input) => {
        expect(input.message).toContain('fixture:native-run')
        return Promise.resolve({
          harnessVersion: '0.84.2',
          responseMarkdown: 'Pi 已使用 fixture_echo 完成回答。',
          usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
          modelLayer: { kind: 'harness-provider', provider: 'fake-provider', model: 'fake-model' },
          degradedFeatures: [],
        })
      })
    const native = new NativeAgentCore(
      new HostDriverRegistry([driver(execute)]),
      undefined,
      credentials,
    )

    const result = await native.execute({
      projectPath: root,
      kind: 'run',
      message: '请通过 fixture 回显 native-run。',
      timeoutMs: 5_000,
    })

    expect(result).toMatchObject({
      status: 'succeeded',
      responseMarkdown: 'Pi 已使用 fixture_echo 完成回答。',
      usage: { inputTokens: 6, outputTokens: 8, totalTokens: 14 },
    })
    expect(result.degradedFeatures).toContain(
      'Studio 受控 MCP 适配已通过 Fixture MCP 调用 fixture_echo。',
    )
    expect(execute).toHaveBeenCalledTimes(2)
    await native.close()
  })

  it('returns a semantic timed-out Native result when an approved MCP never handshakes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'studio-native-mcp-timeout-'))
    const studio = new StudioCore()
    const initialized = await studio.initProject(root, { name: 'MCP Timeout Agent' })
    const selected = await selectPiModel(studio, root, initialized.project.revision)
    await studio.updateAgentProfile(
      root,
      {
        ...defaultAgentProfile,
        mcpServers: [
          {
            id: 'fixture-mcp',
            name: 'Fixture MCP',
            transport: 'stdio',
            command: process.execPath,
            args: [path.resolve('src/test/fixtures/mcp/stdio-server.mjs'), '--hang'],
            url: null,
            secretReferences: [],
            enabled: true,
            approval: 'approved',
          },
        ],
      },
      { expectedRevision: selected.project.revision },
    )
    const execute = vi.fn<HarnessHostDriver['execute']>()
    const native = new NativeAgentCore(
      new HostDriverRegistry([driver(execute)]),
      undefined,
      credentials,
    )

    const result = await native.execute({
      projectPath: root,
      kind: 'run',
      message: 'This must time out.',
      timeoutMs: 1_000,
    })

    expect(result.status).toBe('timed-out')
    expect(result.failure?.code).toBe('TIMEOUT')
    expect(result.failure?.message).toContain('MCP')
    expect(result.failure?.recoveryAction).toContain('重试')
    expect(execute).not.toHaveBeenCalled()
    await native.close()
  })
})
