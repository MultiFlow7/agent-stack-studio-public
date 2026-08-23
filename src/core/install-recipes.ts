import path from 'node:path'
import {
  customizationRecognitionSchema,
  customizationTaskSchema,
  installRecipeSchema,
  type CustomizationRecognition,
  type CustomizationTask,
  type CustomizationTaskInput,
  type InstallRecipe,
} from '../shared/customization'

const ANTHROPIC_SKILLS_COMMIT = '3b3fad96af16a10759d930941b4520ba0c40edae'
const APACHE_LICENSE_SHA256 = 'bc6b3af2f331cbc7fb0da1344efb2cbe5877a31498b4d70dbc7000f3405a1362'

interface AnthropicSkillSpec {
  slug: string
  title: string
  artifactSha256: string
  contentCompleteness?: 'complete' | 'instructions-only'
  limitations?: string[]
  licenseSha256?: string
}

const skillSpecs: AnthropicSkillSpec[] = [
  {
    slug: 'algorithmic-art',
    title: 'Anthropic Algorithmic Art Skill',
    artifactSha256: '3bc4092c09804853186524c826bc0621b940bb6122c05b84496dff95388e6eef',
    contentCompleteness: 'instructions-only',
    limitations: ['固定方案不复制仓库内 templates；模板相关步骤会降级。'],
  },
  {
    slug: 'academy-guide',
    title: 'Anthropic Academy Guide Skill',
    artifactSha256: 'f27992510c051355dfe68c92394d509af730da5298094ec86834ee40bbd31376',
    limitations: ['课程目录来自外部公开 URL；离线时只能使用 Skill 内已有说明。'],
  },
  {
    slug: 'brand-guidelines',
    title: 'Anthropic Brand Guidelines Skill',
    artifactSha256: '1120b3769e2985cefb3d25be981b1f914abeba57ae079b83c20c666c164fa9fe',
  },
  {
    slug: 'canvas-design',
    title: 'Anthropic Canvas Design Skill',
    artifactSha256: 'a1f288079624402f30682753c1d43920b6664785698d21d3e7aa197450a6448b',
  },
  {
    slug: 'discernment-nudge',
    title: 'Anthropic Discernment Nudge Skill',
    artifactSha256: '9191177c4a8ef11a20dace786d708506b22d43e748c71287bb823de0dc812dad',
  },
  {
    slug: 'frontend-design',
    title: 'Anthropic Frontend Design Skill',
    artifactSha256: '1608ea77fbb6fc30d13a97d12cfa8ebf31358d40f0dd97beed24829d6b3f45dd',
    licenseSha256: '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594',
  },
  {
    slug: 'internal-comms',
    title: 'Anthropic Internal Communications Skill',
    artifactSha256: '067b7587a344a928fc6534ef66b1bcd591fc7c26d207ea7ca3334aeb678d6475',
  },
  {
    slug: 'mcp-builder',
    title: 'Anthropic MCP Builder Skill',
    artifactSha256: '0f4592dcb53cf2b5d6b7febee6b4152018b565551a1c29e3c612f57b218ab295',
    limitations: ['方案提供设计与实现指导，不安装 SDK、依赖或执行构建。'],
  },
  {
    slug: 'skill-creator',
    title: 'Anthropic Skill Creator Skill',
    artifactSha256: 'dcd4803e61e913e6fc27294184cd3a71f09f5e924ff20c8a9a20173e7b3c2bcf',
    contentCompleteness: 'instructions-only',
    limitations: ['固定方案不复制 references、assets 或评测工具；相关步骤会降级。'],
  },
  {
    slug: 'theme-factory',
    title: 'Anthropic Theme Factory Skill',
    artifactSha256: 'c35893e221e28895c52143cc11bf30e41a44817796b39d4b15727dadc9796552',
  },
  {
    slug: 'web-artifacts-builder',
    title: 'Anthropic Web Artifacts Builder Skill',
    artifactSha256: '81c5002c6643b0de7b8710b00e7a9038daa6fb9b68d59870ee6adb12da8d10f8',
    contentCompleteness: 'instructions-only',
    limitations: ['固定方案不复制或执行 init/bundle 脚本；自动搭建与打包步骤不可用。'],
  },
  {
    slug: 'webapp-testing',
    title: 'Anthropic Web App Testing Skill',
    artifactSha256: '51b7349e77ec63b7744a6f63647e7566a0b4d2e301121cc10e8c2113af6556a2',
    contentCompleteness: 'instructions-only',
    limitations: ['固定方案不复制或执行 Playwright/server helper；只安装测试方法说明。'],
  },
]

function recipe(spec: AnthropicSkillSpec): InstallRecipe {
  const root = `https://raw.githubusercontent.com/anthropics/skills/${ANTHROPIC_SKILLS_COMMIT}/skills/${spec.slug}`
  const complete = spec.contentCompleteness !== 'instructions-only'
  return installRecipeSchema.parse({
    id: `anthropic-${spec.slug}`,
    title: spec.title,
    kind: 'skill-markdown',
    repository: 'anthropics/skills',
    commit: ANTHROPIC_SKILLS_COMMIT,
    artifactPath: `skills/${spec.slug}/SKILL.md`,
    artifactUrl: `${root}/SKILL.md`,
    artifactSha256: spec.artifactSha256,
    license: 'Apache-2.0',
    licensePath: `skills/${spec.slug}/LICENSE.txt`,
    licenseUrl: `${root}/LICENSE.txt`,
    licenseSha256: spec.licenseSha256 ?? APACHE_LICENSE_SHA256,
    platforms: ['darwin-arm64', 'darwin-x64'],
    skillId: spec.slug,
    skillName: spec.title.replace(/^Anthropic | Skill$/g, ''),
    supportedHarnesses: ['pi', 'openclaw', 'codex'],
    harnessSupport: [
      {
        harnessId: 'pi',
        level: complete ? 'native' : 'degraded',
        detail: complete
          ? 'Pi 通过固定 --skill 路径原生加载 Markdown。'
          : 'Pi 原生加载 Markdown，但方案未包含上游辅助文件。',
      },
      {
        harnessId: 'openclaw',
        level: complete ? 'adapted' : 'degraded',
        detail: complete
          ? 'OpenClaw 兼容入口把 Skill 作为显式 Profile 上下文。'
          : 'OpenClaw 通过 Profile 上下文适配，且方案未包含上游辅助文件。',
      },
      {
        harnessId: 'codex',
        level: complete ? 'adapted' : 'degraded',
        detail: complete
          ? 'Codex exec 在隔离 Prompt 上下文中加载 Skill。'
          : 'Codex 通过 Prompt 上下文适配，且方案未包含上游辅助文件。',
      },
    ],
    capabilities: ['skill-provider', 'prompt-policy'],
    executionPolicy: 'content-only',
    contentCompleteness: spec.contentCompleteness ?? 'complete',
    limitations: spec.limitations ?? [],
    verification: {
      status: 'content-verified',
      verifiedAt: '2026-08-23',
      method: 'pinned-sha256-content-smoke-v1',
      detail: '官方 pinned 文件已下载并复算 SHA-256；Studio 安装/复读未执行上游代码。',
    },
  })
}

export const knownInstallRecipes: InstallRecipe[] = skillSpecs.map(recipe)

export function normalizeGithubRepository(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/$/, '')
  const short = normalized.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (short) return `${short[1].toLowerCase()}/${short[2].toLowerCase()}`
  try {
    const url = new URL(normalized)
    if (
      url.protocol !== 'https:' ||
      !['github.com', 'www.github.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null
    }
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 2) return null
    return `${segments[0].toLowerCase()}/${segments[1].toLowerCase()}`
  } catch {
    return null
  }
}

export function recipesForRepository(repository: string): InstallRecipe[] {
  return knownInstallRecipes.filter(
    (entry) => entry.repository.toLowerCase() === repository.toLowerCase(),
  )
}

export function recipeForRepository(repository: string): InstallRecipe | null {
  return recipesForRepository(repository)[0] ?? null
}

export function recognizeGithubSource(
  source: string,
  harnessId: CustomizationRecognition['harnessId'],
): CustomizationRecognition | null {
  const repository = normalizeGithubRepository(source)
  if (!repository) return null
  const availableRecipes = recipesForRepository(repository).filter((entry) =>
    entry.supportedHarnesses.includes(harnessId),
  )
  const selected = availableRecipes[0] ?? null
  return customizationRecognitionSchema.parse({
    status: selected ? 'known' : 'unknown',
    source: { kind: 'github', repository },
    harnessId,
    recipe: selected,
    availableRecipes,
    evidence: [{ kind: 'locator', detail: `GitHub repository: ${repository}` }],
    safetyNotice: selected
      ? `命中 ${availableRecipes.length} 个固定方案；只下载固定提交中的 Markdown/License 并校验 SHA-256，不 clone、不安装依赖、不执行仓库代码。`
      : '未命中固定安装方案；Studio 只生成 Coding Agent 任务，不下载或执行代码。',
  })
}

function taskFileName(source: CustomizationRecognition['source']): string {
  const base =
    source.kind === 'github' ? source.repository.split('/').at(-1)! : path.basename(source.path)
  return `${
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'source'
  }-customization.md`
}

export function buildCustomizationTask(
  input: CustomizationTaskInput,
  recognition: CustomizationRecognition,
  now: () => Date = () => new Date(),
): CustomizationTask {
  const source =
    recognition.source.kind === 'github'
      ? `https://github.com/${recognition.source.repository}`
      : recognition.source.path
  const recipeStatus = recognition.recipe
    ? `已知方案 ${recognition.recipe.id}，但本任务仍要求先审阅再改动。`
    : '未命中任何 Studio 固定方案；不得假设自动兼容。'
  const markdown = `# Agent Stack Studio 定制任务

## 目标

${input.goal ?? `审阅并将该来源以最小、可回滚方式适配到 ${input.harnessId} Harness。`}

## 输入事实

- 来源：${source}
- 目标 Harness：${input.harnessId}
- Studio 项目：${input.projectPath ?? '由执行者显式选择'}
- 识别结果：${recognition.status}
- 方案状态：${recipeStatus}

## 强制安全边界

1. 先只读检查 LICENSE、README、包清单、锁文件、入口与网络/文件系统权限。
2. 未经人工确认，不得执行 install、build、postinstall、Hook、容器、二进制或仓库脚本。
3. 不读取 Keychain、Provider Token、聊天、Run 日志或项目外文件。
4. 不得把 Cordis 类型扩散到 Studio 领域模型，不发明通用 Harness 运行协议。

## 能力映射待办

- [ ] 确定它是 Prompt、Skill、Markdown Memory、MCP Tool 还是 Harness 原生配置。
- [ ] 对 ${input.harnessId} 逐项标记 native / adapted / degraded / unavailable。
- [ ] 列出所有文件、网络、子进程和密钥权限，默认最小权限。
- [ ] 给出固定版本/提交、逐个可安装 Artifact 的 SHA-256 和 SPDX License。

## 实现文件计划

1. 在 Studio Core 增加厂商无关的方案与能力类型。
2. 在 Host 边界增加精确白名单 Adapter；Renderer 不接收 executable、argv 或密钥。
3. 只向 .agent-stack 写入便携配置；本机快照、安装物与日志写入 .agent-stack-local。
4. GUI 和 CLI 调用同一 Core，使用同一 revision 并发保护。

## 测试与 Smoke Test

- [ ] 纯静态识别：GitHub URL 和本地目录给出等价结果，不执行来源代码。
- [ ] 版本、校验和、License、平台与 Harness 能力矩阵都受 schema 验证。
- [ ] 安装前快照；校验失败零写入；写入后 Smoke Test 失败自动恢复。
- [ ] 覆盖空状态、加载、失败、取消、键盘和 revision 冲突。

## 验收条件

- [ ] 不使用 fixture 冒充真实上游，证据指向固定 commit 与校验和。
- [ ] 至少一个真实 Harness 完成最小 Smoke Test；降级不被隐藏。
- [ ] 卸载、更新或失败后能从快照恢复，不改写不可变 Version。
- [ ] 全部 format/lint/typecheck/test/build 和打包门禁通过。
`
  return customizationTaskSchema.parse({
    formatVersion: 1,
    fileName: taskFileName(recognition.source),
    markdown,
    recognition,
    createdAt: now().toISOString(),
  })
}
