import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultAgentProfile } from '../../shared/agent-profile'
import type { HostDriverExecuteInput } from './host-driver'
import { CodexHostDriver } from './codex-host-driver'
import { OpenClawHostDriver } from './openclaw-host-driver'
import { PiHostDriver } from './pi-host-driver'

const simulation = {
  endpoint: 'http://127.0.0.1:43123/v1',
  providerId: 'studio-codex-simulation' as const,
  modelId: 'codex-simulation' as const,
  apiKey: 'studio-local-simulation' as const,
}

async function executable(name: string, source: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-host-driver-'))
  const target = path.join(root, name)
  await writeFile(target, `#!/usr/bin/env node\n${source}\n`, 'utf8')
  await chmod(target, 0o700)
  return target
}

async function input(kind: 'chat' | 'run'): Promise<HostDriverExecuteInput> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'studio-driver-project-'))
  const stateRoot = path.join(projectRoot, '.agent-stack-local')
  await mkdir(stateRoot, { recursive: true })
  return {
    kind,
    message: 'M33 contract',
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    projectRoot,
    stateRoot,
    profile: {
      ...defaultAgentProfile,
      instructions: 'Be concise.',
      memoryMarkdown: '# Memory',
      skills: [{ id: 'review', name: 'Review', markdown: '# Review', enabled: true }],
    },
    timeoutMs: 5_000,
  }
}

describe('real Harness CLI contracts', () => {
  it('pins Pi and parses its JSONL message/session/skill surface', async () => {
    const pi = await executable(
      'pi',
      `if (process.argv[2] === '--version') console.log('0.84.2')
else {
  const args = process.argv.slice(2)
  console.log(JSON.stringify({type:'message_end', message:{content:[{type:'text', text:args.join(' ')}]}}))
  console.log(JSON.stringify({type:'turn_end', usage:{input:2, output:3, total:5}}))
}`,
    )
    const driver = new PiHostDriver({ executable: pi })
    expect(await driver.probe()).toMatchObject({ status: 'ready', version: '0.84.2' })
    const result = await driver.execute(await input('chat'))

    expect(result.responseMarkdown).toContain('--mode json --print --session-id')
    expect(result.responseMarkdown).toContain('--skill')
    expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 })
  })

  it('keeps OpenClaw chat on native sessions and run on the isolated exec envelope', async () => {
    const openclaw = await executable(
      'openclaw',
      `if (process.argv[2] === '--version') console.log('2026.7.1')
else console.log(JSON.stringify({ok:true, final:process.argv.slice(2).join(' '), usage:{input:4, output:6, total:10}}))`,
    )
    const driver = new OpenClawHostDriver({ executable: openclaw })
    expect(await driver.probe()).toMatchObject({ status: 'ready', version: '2026.7.1' })

    const chat = await driver.execute(await input('chat'))
    const run = await driver.execute(await input('run'))
    expect(chat.responseMarkdown).toContain('agent --local --session-id')
    expect(run.responseMarkdown).toContain('agent exec')
    expect(run.usage).toEqual({ inputTokens: 4, outputTokens: 6, totalTokens: 10 })
  })

  it('pins Codex exec JSONL and resumes chat through its native thread id', async () => {
    const codex = await executable(
      'codex',
      `if (process.argv[2] === '--version') console.log('codex-cli 0.148.0-alpha.9')
else {
  const args = process.argv.slice(2)
  console.log(JSON.stringify({type:'thread.started', thread_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}))
  console.log(JSON.stringify({type:'item.completed', item:{type:'agent_message', text:args.join(' ')}}))
  console.log(JSON.stringify({type:'turn.completed', usage:{input_tokens:7, output_tokens:8}}))
}`,
    )
    const driver = new CodexHostDriver({ executable: codex })
    expect(await driver.probe()).toMatchObject({
      status: 'ready',
      version: '0.148.0-alpha.9',
    })

    const chatInput = await input('chat')
    const first = await driver.execute(chatInput)
    const resumed = await driver.execute(chatInput)
    const run = await driver.execute(await input('run'))
    expect(first.responseMarkdown).toContain('exec --json --skip-git-repo-check')
    expect(first.responseMarkdown).toContain('--sandbox read-only')
    expect(resumed.responseMarkdown).toContain(
      'exec resume --json --skip-git-repo-check --ignore-user-config --ignore-rules bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    )
    expect(run.responseMarkdown).toContain('--ephemeral')
    expect(run.usage).toEqual({ inputTokens: 7, outputTokens: 8, totalTokens: 15 })
    expect(run.degradedFeatures).toContain(
      'Studio Profile 以显式 Prompt 上下文适配；不读取用户或项目规则文件。',
    )
  })

  it('fails closed on unsupported Pi versions', async () => {
    const pi = await executable('pi', `console.log('0.84.1')`)
    const driver = new PiHostDriver({ executable: pi })
    expect(await driver.probe()).toMatchObject({
      status: 'unsupported-version',
      requiredVersion: '0.84.2',
    })
    await expect(driver.execute(await input('run'))).rejects.toThrow('需要固定版本')
  })

  it('isolates Pi Codex simulation config and labels the model boundary', async () => {
    const pi = await executable(
      'pi',
      `if (process.argv[2] === '--version') console.log('0.84.2')
else console.log(JSON.stringify({type:'message_end', message:{content:[{type:'text', text:process.argv.slice(2).join(' ')}]}}))`,
    )
    const executionInput = await input('run')
    const result = await new PiHostDriver({ executable: pi, simulation }).execute(executionInput)
    const config = JSON.parse(
      await readFile(
        path.join(executionInput.stateRoot, 'codex-simulation', 'pi-agent', 'models.json'),
        'utf8',
      ),
    ) as {
      providers: Record<string, { baseUrl: string; api: string }>
    }

    expect(result.responseMarkdown).toContain(
      '--provider studio-codex-simulation --model codex-simulation',
    )
    expect(result.responseMarkdown).toContain('--no-tools')
    expect(result.modelLayer).toEqual({
      kind: 'codex-simulation',
      provider: 'studio-codex-simulation',
      model: 'codex-simulation',
    })
    expect(config.providers['studio-codex-simulation']).toMatchObject({
      baseUrl: simulation.endpoint,
      api: 'openai-completions',
    })
  })

  it('isolates OpenClaw Codex simulation config and denies Harness tools', async () => {
    const openclaw = await executable(
      'openclaw',
      `if (process.argv[2] === '--version') console.log('2026.1.30')
else console.log(JSON.stringify({ok:true, final:'OPENCLAW_SIMULATION_CONFIGURED'}))`,
    )
    const executionInput = await input('chat')
    const result = await new OpenClawHostDriver({ executable: openclaw, simulation }).execute(
      executionInput,
    )
    const config = JSON.parse(
      await readFile(
        path.join(executionInput.stateRoot, 'codex-simulation', 'openclaw-state', 'openclaw.json'),
        'utf8',
      ),
    ) as {
      agents: { defaults: { model: { primary: string } } }
      models: { providers: Record<string, { baseUrl: string }> }
      tools: { allow: string[]; deny: string[] }
    }

    expect(result.responseMarkdown).toBe('OPENCLAW_SIMULATION_CONFIGURED')
    expect(result.modelLayer.kind).toBe('codex-simulation')
    expect(config.agents.defaults.model.primary).toBe('studio-codex-simulation/codex-simulation')
    expect(config.models.providers['studio-codex-simulation'].baseUrl).toBe(simulation.endpoint)
    expect(config.tools).toEqual({ allow: [], deny: ['*'] })
    expect(result.degradedFeatures).toHaveLength(1)
  })
})
