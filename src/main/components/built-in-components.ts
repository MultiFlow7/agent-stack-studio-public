import type { ComponentDescriptor } from '../../shared/component'

export const builtInComponentIds = {
  harnessX: '10000000-0000-4000-8000-000000000001',
  researchY: '10000000-0000-4000-8000-000000000002',
  legacyAdapter: '10000000-0000-4000-8000-000000000003',
} as const

export const builtInComponents: Array<{ id: string; descriptor: ComponentDescriptor }> = [
  {
    id: builtInComponentIds.harnessX,
    descriptor: {
      contractVersion: 1,
      id: 'studio.sample.harness-x',
      name: '本地 Harness X',
      version: '1.0.0',
      kind: 'component',
      source: { kind: 'built-in', location: 'studio://components/harness-x', license: 'MIT' },
      platforms: ['darwin-arm64', 'darwin-x64'],
      provides: [
        ['execution-controller', 'sample.x.loop'],
        ['model-provider', 'sample.x.model'],
        ['prompt-policy', 'sample.x.prompt'],
        ['context-builder', 'sample.x.context'],
      ].map(([capability, implementation]) => ({
        capability,
        implementation,
        replaceability: 'configurable' as const,
        confidence: 'verified' as const,
        activation: 'owner-only' as const,
      })),
      requires: [],
      configSchema: 'studio://schemas/harness-x.json',
      runtimeAdapter: 'studio://runtime/harness-x',
      compatibility: {
        level: 'native',
        validation: 'runtime-verified',
        detail: '已通过内置契约测试和最小运行验证。',
      },
      evidence: [
        { kind: 'contract-test', detail: 'Component Contract v1 契约测试已通过。' },
        { kind: 'runtime-check', detail: 'Cordis Service 启停与清理已验证。' },
      ],
    },
  },
  {
    id: builtInComponentIds.researchY,
    descriptor: {
      contractVersion: 1,
      id: 'studio.sample.research-y',
      name: '研究扩展 Y',
      version: '1.1.0',
      kind: 'component',
      source: {
        kind: 'built-in',
        location: 'studio://components/research-y',
        license: 'Apache-2.0',
      },
      platforms: ['darwin-arm64', 'darwin-x64'],
      provides: [
        ['prompt-policy', 'sample.y.prompt'],
        ['context-builder', 'sample.y.context'],
        ['memory', 'sample.y.memory'],
        ['tool-runtime', 'sample.y.tools'],
        ['trace', 'sample.y.trace'],
      ].map(([capability, implementation]) => ({
        capability,
        implementation,
        replaceability: 'replaceable' as const,
        confidence: 'verified' as const,
        activation: 'owner-only' as const,
      })),
      requires: [{ capability: 'model-provider', version: '>=1' }],
      configSchema: 'studio://schemas/research-y.json',
      runtimeAdapter: 'studio://runtime/research-y',
      compatibility: {
        level: 'native',
        validation: 'runtime-verified',
        detail: '与 Component Contract v1 的配置、数据和生命周期直接兼容。',
      },
      evidence: [
        { kind: 'contract-test', detail: '能力输入输出契约已验证。' },
        { kind: 'runtime-check', detail: '最小运行验证已通过。' },
      ],
    },
  },
  {
    id: builtInComponentIds.legacyAdapter,
    descriptor: {
      contractVersion: 1,
      id: 'studio.sample.legacy-memory-adapter',
      name: '旧版 Memory Adapter',
      version: '0.3.0',
      kind: 'adapter',
      source: {
        kind: 'generated-adapter',
        location: 'studio://generated/legacy-memory-adapter',
        license: 'UNLICENSED',
      },
      platforms: ['darwin-arm64', 'darwin-x64'],
      provides: [
        {
          capability: 'memory',
          implementation: 'legacy.memory.bridge',
          replaceability: 'adapter-required',
          confidence: 'detected',
          activation: 'owner-only',
        },
      ],
      requires: [{ capability: 'context-builder', version: null }],
      configSchema: 'studio://schemas/legacy-memory-adapter.json',
      runtimeAdapter: 'studio://runtime/legacy-memory-adapter',
      compatibility: {
        level: 'adapter',
        validation: 'contract-tested',
        detail: '转换代码已生成并通过契约测试，但尚未通过最小运行验证。',
      },
      evidence: [{ kind: 'contract-test', detail: '生成的 Adapter 已通过静态契约测试。' }],
    },
  },
]
