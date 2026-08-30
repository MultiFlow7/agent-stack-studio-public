import type { ComponentDescriptor } from '../shared/component'
import type { HarnessId } from '../shared/native-agent'

export const knownHarnessComponentIds: Record<HarnessId, string> = {
  pi: '20000000-0000-4000-8000-000000000001',
  openclaw: '20000000-0000-4000-8000-000000000002',
  codex: '20000000-0000-4000-8000-000000000003',
}

const commonPermissions: NonNullable<ComponentDescriptor['permissions']> = [
  {
    scope: 'subprocess',
    required: true,
    reason: '通过无 shell 参数数组启动已选择的 Harness CLI。',
  },
  { scope: 'network', required: true, reason: 'Harness 使用用户已配置的模型 Provider。' },
  {
    scope: 'filesystem-read',
    required: true,
    reason: '读取隔离工作区中的 Prompt、Skill 与 Memory。',
  },
]

export const knownHarnesses: Record<HarnessId, { id: string; descriptor: ComponentDescriptor }> = {
  pi: {
    id: knownHarnessComponentIds.pi,
    descriptor: {
      contractVersion: 1,
      id: 'studio.harness.pi',
      name: 'Pi',
      version: '0.84.2',
      kind: 'component',
      source: {
        kind: 'built-in',
        location: 'https://github.com/earendil-works/pi-mono/tree/v0.84.2',
        license: 'MIT',
      },
      platforms: ['darwin-arm64', 'darwin-x64'],
      provides: [
        ['execution-controller', 'pi.json-session'],
        ['model-provider', 'pi.provider-catalog'],
        ['prompt-policy', 'pi.system-prompt'],
        ['context-builder', 'pi.context-files'],
        ['memory', 'studio.markdown-to-pi-context'],
        ['tool-runtime', 'pi.builtin-tools'],
        ['skill-provider', 'pi.skill-loader'],
        ['state-store', 'pi.session-jsonl'],
      ].map(([capability, implementation]) => ({
        capability,
        implementation,
        replaceability: 'configurable' as const,
        confidence: 'verified' as const,
        activation: 'owner-only' as const,
      })),
      requires: [],
      configSchema: null,
      runtimeAdapter: 'studio://host-drivers/pi',
      permissions: commonPermissions,
      compatibility: {
        level: 'native',
        validation: 'contract-tested',
        detail: '固定 Pi 0.84.2 JSON/RPC 契约；运行时仍需检测 CLI 与本机认证。',
      },
      evidence: [
        {
          kind: 'contract-test',
          detail: '官方 JSONL、session-id、skill 与工具白名单参数已纳入 Host Driver 测试。',
          status: 'passed',
          method: 'descriptor-contract-test-v1',
        },
      ],
    },
  },
  openclaw: {
    id: knownHarnessComponentIds.openclaw,
    descriptor: {
      contractVersion: 1,
      id: 'studio.harness.openclaw',
      name: 'OpenClaw',
      version: '2026.1.30',
      kind: 'component',
      source: {
        kind: 'built-in',
        location: 'https://github.com/openclaw/openclaw',
        license: 'MIT',
      },
      platforms: ['darwin-arm64', 'darwin-x64'],
      provides: [
        ['execution-controller', 'openclaw.agent-local'],
        ['model-provider', 'openclaw.provider-config'],
        ['prompt-policy', 'openclaw.agent-instructions'],
        ['context-builder', 'openclaw.workspace'],
        ['memory', 'openclaw.memory-markdown'],
        ['tool-runtime', 'openclaw.tools'],
        ['skill-provider', 'openclaw.workspace-skills'],
        ['mcp-client', 'studio.openclaw-ambient-mcp-reference'],
        ['state-store', 'openclaw.sessions'],
      ].map(([capability, implementation]) => ({
        capability,
        implementation,
        replaceability: 'configurable' as const,
        confidence: 'verified' as const,
        activation: 'owner-only' as const,
      })),
      requires: [],
      configSchema: null,
      runtimeAdapter: 'studio://host-drivers/openclaw',
      permissions: commonPermissions,
      compatibility: {
        level: 'native',
        validation: 'contract-tested',
        detail:
          '兼容 2026.1.30 的 agent --local JSON 契约；Profile/MCP 显式适配，并优先使用新版 agent exec。',
      },
      evidence: [
        {
          kind: 'contract-test',
          detail: '官方 agent JSON、session-id、取消/超时与新版 exec 契约已纳入 Host Driver 测试。',
          status: 'passed',
          method: 'descriptor-contract-test-v1',
        },
      ],
    },
  },
  codex: {
    id: knownHarnessComponentIds.codex,
    descriptor: {
      contractVersion: 1,
      id: 'studio.harness.codex',
      name: 'Codex CLI',
      version: '0.148.0-alpha.9',
      kind: 'component',
      source: {
        kind: 'built-in',
        location: 'https://github.com/openai/codex',
        license: 'Apache-2.0',
      },
      platforms: ['darwin-arm64', 'darwin-x64'],
      provides: [
        ['execution-controller', 'codex.exec-jsonl'],
        ['model-provider', 'codex.chatgpt-auth'],
        ['prompt-policy', 'studio.prompt-to-codex-exec'],
        ['context-builder', 'codex.workspace'],
        ['memory', 'studio.markdown-to-codex-prompt'],
        ['tool-runtime', 'codex.sandbox'],
        ['skill-provider', 'studio.skill-to-codex-prompt'],
        ['state-store', 'codex.thread-resume'],
      ].map(([capability, implementation]) => ({
        capability,
        implementation,
        replaceability: 'configurable' as const,
        confidence: 'verified' as const,
        activation: 'owner-only' as const,
      })),
      requires: [],
      configSchema: null,
      runtimeAdapter: 'studio://host-drivers/codex',
      permissions: commonPermissions,
      compatibility: {
        level: 'native',
        validation: 'contract-tested',
        detail:
          '固定 Codex CLI 0.148.0-alpha.9 exec JSONL/resume 契约；权限映射为 read-only/workspace-write 沙箱。',
      },
      evidence: [
        {
          kind: 'contract-test',
          detail:
            '官方 exec JSONL、resume、取消/超时、沙箱与真实本机最小 Run 已纳入 Host Driver 证据。',
          status: 'passed',
          method: 'descriptor-contract-test-v1',
        },
      ],
    },
  },
}

export function harnessIdFromAdapter(adapterRef: string | null): HarnessId | null {
  if (adapterRef === 'studio://host-drivers/pi') return 'pi'
  if (adapterRef === 'studio://host-drivers/openclaw') return 'openclaw'
  if (adapterRef === 'studio://host-drivers/codex') return 'codex'
  return null
}
