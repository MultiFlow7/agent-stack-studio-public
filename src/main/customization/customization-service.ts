import { createHash, randomUUID } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { harnessIdFromAdapter } from '../../core/known-harnesses'
import {
  buildCustomizationTask,
  knownInstallRecipes,
  recognizeGithubSource,
} from '../../core/install-recipes'
import { StudioCoreError } from '../../core/project-errors'
import type { StudioCore } from '../../core/studio-core'
import {
  customizationInstallResultSchema,
  customizationRecipeStatusListSchema,
  customizationRecognitionSchema,
  customizationRestoreResultSchema,
  customizationSmokeResultSchema,
  customizationTaskSchema,
  customizationUninstallResultSchema,
  type CustomizationCheckInput,
  type CustomizationInstallInput,
  type CustomizationInstallResult,
  type CustomizationRecipeStatus,
  type CustomizationRecognition,
  type CustomizationRecognitionInput,
  type CustomizationRestoreInput,
  type CustomizationRestoreResult,
  type CustomizationSmokeInput,
  type CustomizationSmokeResult,
  type CustomizationTask,
  type CustomizationTaskInput,
  type CustomizationUninstallInput,
  type CustomizationUninstallResult,
  type InstallRecipe,
} from '../../shared/customization'

const MAX_ARTIFACT_BYTES = 100_000

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function githubCandidate(value: string): boolean {
  return value.startsWith('https://') || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(value)
}

function ensurePinnedContent(
  value: string,
  expectedHash: string,
  field: 'artifact' | 'license',
): void {
  if (Buffer.byteLength(value, 'utf8') > MAX_ARTIFACT_BYTES) {
    throw new StudioCoreError(
      'CUSTOMIZATION_INTEGRITY_FAILED',
      `${field === 'artifact' ? 'Skill' : 'License'} 文件超出固定方案大小上限。`,
    )
  }
  const actualHash = sha256(value)
  if (actualHash !== expectedHash) {
    throw new StudioCoreError(
      'CUSTOMIZATION_INTEGRITY_FAILED',
      `${field === 'artifact' ? 'Skill' : 'License'} SHA-256 与固定方案不一致，未写入项目。`,
      { details: { field, expectedHash, actualHash } },
    )
  }
}

async function readOptionalSmallText(filePath: string): Promise<string | null> {
  try {
    const metadata = await lstat(filePath)
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_ARTIFACT_BYTES) {
      return null
    }
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function relativeFile(root: string, relativePath: string): string {
  const candidate = path.resolve(root, relativePath)
  if (!candidate.startsWith(`${root}${path.sep}`)) {
    throw new StudioCoreError('UNSAFE_SOURCE', '安装方案文件越出了已选来源目录。')
  }
  return candidate
}

function controllerHarness(project: Awaited<ReturnType<StudioCore['inspectProject']>>['project']) {
  const componentMap = new Map(project.components.map((component) => [component.id, component]))
  const owner = project.stack.capabilityOwners.find(
    ({ capability }) => capability === 'execution-controller',
  )
  return harnessIdFromAdapter(
    owner ? (componentMap.get(owner.componentId)?.descriptor.runtimeAdapter ?? null) : null,
  )
}

export class CustomizationService {
  readonly #core: StudioCore
  readonly #fetch: typeof fetch
  readonly #now: () => Date
  readonly #recipes: InstallRecipe[]
  readonly #verifyInstalled?: (input: {
    recipe: InstallRecipe
    markdown: string
    projectPath: string
  }) => Promise<void>
  #activeInstall: {
    controller: AbortController
    promise: Promise<CustomizationInstallResult>
  } | null = null

  constructor(options: {
    core: StudioCore
    fetch?: typeof fetch
    now?: () => Date
    recipes?: InstallRecipe[]
    verifyInstalled?: (input: {
      recipe: InstallRecipe
      markdown: string
      projectPath: string
    }) => Promise<void>
  }) {
    this.#core = options.core
    this.#fetch = options.fetch ?? fetch
    this.#now = options.now ?? (() => new Date())
    this.#recipes = options.recipes ?? knownInstallRecipes
    this.#verifyInstalled = options.verifyInstalled
  }

  async recognize(input: CustomizationRecognitionInput): Promise<CustomizationRecognition> {
    if (githubCandidate(input.source)) {
      const github = recognizeGithubSource(input.source, input.harnessId)
      if (!github) {
        throw new StudioCoreError(
          'UNSAFE_SOURCE',
          '只接受无凭证、无查询参数的 GitHub HTTPS URL 或 owner/repo。',
        )
      }
      return github
    }

    const metadata = await lstat(input.source).catch((error: unknown) => {
      throw new StudioCoreError('SOURCE_NOT_FOUND', '本地来源目录不存在或无法读取。', {
        cause: error,
      })
    })
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new StudioCoreError('UNSAFE_SOURCE', '本地来源必须是非符号链接目录。')
    }
    const root = await realpath(input.source)
    const evidence: CustomizationRecognition['evidence'] = []
    const gitConfig = await readOptionalSmallText(path.join(root, '.git', 'config'))
    if (gitConfig) {
      const remote = gitConfig.match(
        /url\s*=\s*(https:\/\/github\.com\/[^\s]+|git@github\.com:[^\s]+)/,
      )?.[1]
      if (remote)
        evidence.push({ kind: 'git-remote', detail: remote.replace(/^git@github\.com:/, '') })
    }
    for (const recipe of this.#recipes) {
      if (!recipe.supportedHarnesses.includes(input.harnessId)) continue
      const artifact = await readOptionalSmallText(relativeFile(root, recipe.artifactPath))
      const license = await readOptionalSmallText(relativeFile(root, recipe.licensePath))
      if (artifact && license) {
        const artifactHash = sha256(artifact)
        const licenseHash = sha256(license)
        evidence.push({ kind: 'artifact-hash', detail: `${recipe.artifactPath}: ${artifactHash}` })
        if (artifactHash === recipe.artifactSha256 && licenseHash === recipe.licenseSha256) {
          return customizationRecognitionSchema.parse({
            status: 'known',
            source: { kind: 'local', path: root },
            harnessId: input.harnessId,
            recipe,
            availableRecipes: [recipe],
            evidence,
            safetyNotice:
              '本地文件与固定方案的 Skill/License SHA-256 完全一致；安装只复制 Markdown，不执行仓库代码。',
          })
        }
      }
    }
    return customizationRecognitionSchema.parse({
      status: 'unknown',
      source: { kind: 'local', path: root },
      harnessId: input.harnessId,
      recipe: null,
      availableRecipes: [],
      evidence,
      safetyNotice:
        '本地目录未命中固定校验和；Studio 未执行其中任何代码，只可生成 Coding Agent 任务。',
    })
  }

  async task(input: CustomizationTaskInput): Promise<CustomizationTask> {
    const recognition = await this.recognize(input)
    return customizationTaskSchema.parse(buildCustomizationTask(input, recognition, this.#now))
  }

  install(input: CustomizationInstallInput): Promise<CustomizationInstallResult> {
    if (this.#activeInstall) return this.#activeInstall.promise
    const controller = new AbortController()
    const promise = this.#install(input, controller.signal).finally(() => {
      if (this.#activeInstall?.controller === controller) this.#activeInstall = null
    })
    this.#activeInstall = { controller, promise }
    return promise
  }

  cancel(): boolean {
    if (!this.#activeInstall) return false
    this.#activeInstall.controller.abort()
    return true
  }

  async check(input: CustomizationCheckInput): Promise<CustomizationRecipeStatus[]> {
    const state = await this.#core.inspectProject(input.projectPath)
    if (controllerHarness(state.project) !== input.harnessId) {
      throw new StudioCoreError(
        'HARNESS_NOT_AVAILABLE',
        '当前项目未选择该 Harness，无法检查组件状态。',
      )
    }
    return customizationRecipeStatusListSchema.parse(
      this.#recipes
        .filter(({ supportedHarnesses }) => supportedHarnesses.includes(input.harnessId))
        .map((recipe) => {
          const installed = state.project.profile.skills.find(({ id }) => id === recipe.skillId)
          const installedSha256 = installed ? sha256(installed.markdown) : null
          const support = recipe.harnessSupport.find(
            ({ harnessId }) => harnessId === input.harnessId,
          )!
          return {
            recipe,
            state: !installed
              ? 'not-installed'
              : !installed.enabled
                ? 'disabled'
                : installedSha256 === recipe.artifactSha256
                  ? 'current'
                  : 'drifted',
            installedSha256,
            support,
          }
        }),
    )
  }

  async smoke(input: CustomizationSmokeInput): Promise<CustomizationSmokeResult> {
    const status = (await this.check(input)).find(({ recipe }) => recipe.id === input.recipeId)
    if (!status) {
      throw new StudioCoreError(
        'CUSTOMIZATION_RECIPE_NOT_FOUND',
        '没有匹配该 Harness 的固定安装方案。',
      )
    }
    if (status.state !== 'current' || status.support.level === 'unavailable') {
      throw new StudioCoreError(
        'CUSTOMIZATION_SMOKE_FAILED',
        status.state === 'not-installed'
          ? 'Skill 尚未安装，无法执行内容接线 Smoke Test。'
          : 'Skill 内容、启用状态或 Harness 支持不符合固定方案。',
        { details: { state: status.state, support: status.support.level } },
      )
    }
    return customizationSmokeResultSchema.parse({
      status: 'passed',
      recipeId: status.recipe.id,
      harnessId: input.harnessId,
      level: status.support.level,
      artifactSha256: status.recipe.artifactSha256,
      detail: `${status.recipe.skillName} Markdown/frontmatter/hash 与 ${input.harnessId} Profile 接线已验证；${status.support.detail}`,
      executedThirdPartyCode: false,
    })
  }

  async #install(
    input: CustomizationInstallInput,
    signal: AbortSignal,
  ): Promise<CustomizationInstallResult> {
    const recipe = this.#recipes.find(({ id }) => id === input.recipeId)
    if (!recipe || !recipe.supportedHarnesses.includes(input.harnessId)) {
      throw new StudioCoreError(
        'CUSTOMIZATION_RECIPE_NOT_FOUND',
        '没有匹配该 Harness 的固定安装方案。',
      )
    }
    const operation = input.operation ?? 'install'
    const before = await this.#core.inspectProject(input.projectPath)
    if (before.project.revision !== input.expectedRevision) {
      throw new StudioCoreError('REVISION_CONFLICT', '项目修订已变化，请重新读取后安装。', {
        details: {
          expectedRevision: input.expectedRevision,
          actualRevision: before.project.revision,
        },
      })
    }
    if (controllerHarness(before.project) !== input.harnessId) {
      throw new StudioCoreError('HARNESS_NOT_AVAILABLE', '当前项目未选择该 Harness，未写入 Skill。')
    }

    const [markdown, license] = input.localSourcePath
      ? await this.#readLocalRecipe(input.localSourcePath, recipe)
      : await Promise.all([
          this.#download(recipe.artifactUrl, signal),
          this.#download(recipe.licenseUrl, signal),
        ])
    if (signal.aborted) throw new StudioCoreError('OPERATION_CANCELLED', '安装已取消，项目未写入。')
    ensurePinnedContent(markdown, recipe.artifactSha256, 'artifact')
    ensurePinnedContent(license, recipe.licenseSha256, 'license')
    if (!markdown.startsWith('---\n') || !markdown.includes(`\nname: ${recipe.skillId}\n`)) {
      throw new StudioCoreError(
        'CUSTOMIZATION_INTEGRITY_FAILED',
        'Skill Markdown 缺少固定 frontmatter，未写入项目。',
      )
    }

    const existing = before.project.profile.skills.find(({ id }) => id === recipe.skillId)
    if (operation === 'update' && !existing) {
      throw new StudioCoreError(
        'CUSTOMIZATION_NOT_INSTALLED',
        'Skill 尚未安装；请先使用 install，而不是 update。',
      )
    }
    const { snapshotId, snapshotPath } = await this.#createSnapshot(before.path)
    if (existing?.markdown === markdown && existing.enabled) {
      return customizationInstallResultSchema.parse({
        status: 'reused',
        operation,
        recipeId: recipe.id,
        projectId: before.project.id,
        previousRevision: before.project.revision,
        revision: before.project.revision,
        snapshotPath,
        snapshotId,
        artifactSha256: recipe.artifactSha256,
        smokeTest: { status: 'passed', detail: 'Skill 已存在且内容哈希一致。' },
        executedThirdPartyCode: false,
      })
    }

    let appliedRevision: number | null = null
    try {
      const nextSkills = [
        ...before.project.profile.skills.filter(({ id }) => id !== recipe.skillId),
        { id: recipe.skillId, name: recipe.skillName, markdown, enabled: true },
      ]
      const written = await this.#core.updateAgentProfile(
        input.projectPath,
        { ...before.project.profile, skills: nextSkills },
        { expectedRevision: before.project.revision },
      )
      appliedRevision = written.project.revision
      await this.#verifyInstalled?.({ recipe, markdown, projectPath: input.projectPath })
      const verified = await this.#core.inspectProject(input.projectPath)
      const installed = verified.project.profile.skills.find(({ id }) => id === recipe.skillId)
      if (!installed || installed.markdown !== markdown || !installed.enabled) {
        throw new Error('Skill 写入后内容验证失败。')
      }
      return customizationInstallResultSchema.parse({
        status: 'installed',
        operation,
        recipeId: recipe.id,
        projectId: verified.project.id,
        previousRevision: before.project.revision,
        revision: verified.project.revision,
        snapshotPath,
        snapshotId,
        artifactSha256: recipe.artifactSha256,
        smokeTest: {
          status: 'passed',
          detail: `${recipe.skillName} Markdown/frontmatter/hash 已验证，未执行上游代码。`,
        },
        executedThirdPartyCode: false,
      })
    } catch (error) {
      if (appliedRevision !== null) {
        await this.#core.restoreProjectSnapshot(input.projectPath, snapshotPath, appliedRevision)
      }
      throw new StudioCoreError(
        'CUSTOMIZATION_INSTALL_FAILED',
        appliedRevision === null
          ? '安装失败，项目未写入。'
          : '安装后 Smoke Test 失败，已自动恢复安装前快照。',
        { cause: error, details: { recovered: appliedRevision !== null, snapshotPath } },
      )
    }
  }

  async uninstall(input: CustomizationUninstallInput): Promise<CustomizationUninstallResult> {
    const recipe = this.#recipe(input.recipeId, input.harnessId)
    const before = await this.#core.inspectProject(input.projectPath)
    this.#assertRevisionAndHarness(before, input.expectedRevision, input.harnessId)
    const existing = before.project.profile.skills.find(({ id }) => id === recipe.skillId)
    if (!existing) {
      return customizationUninstallResultSchema.parse({
        status: 'not-installed',
        recipeId: recipe.id,
        projectId: before.project.id,
        previousRevision: before.project.revision,
        revision: before.project.revision,
        snapshotId: null,
        smokeTest: { status: 'passed', detail: 'Skill 原本未安装，项目没有写入。' },
        executedThirdPartyCode: false,
      })
    }
    const { snapshotId, snapshotPath } = await this.#createSnapshot(before.path)
    let appliedRevision: number | null = null
    try {
      const written = await this.#core.updateAgentProfile(
        input.projectPath,
        {
          ...before.project.profile,
          skills: before.project.profile.skills.filter(({ id }) => id !== recipe.skillId),
        },
        { expectedRevision: before.project.revision },
      )
      appliedRevision = written.project.revision
      const verified = await this.#core.inspectProject(input.projectPath)
      if (verified.project.profile.skills.some(({ id }) => id === recipe.skillId)) {
        throw new Error('Skill 卸载后仍存在。')
      }
      return customizationUninstallResultSchema.parse({
        status: 'uninstalled',
        recipeId: recipe.id,
        projectId: verified.project.id,
        previousRevision: before.project.revision,
        revision: verified.project.revision,
        snapshotId,
        smokeTest: { status: 'passed', detail: 'Skill 已移除且 Profile 复读验证通过。' },
        executedThirdPartyCode: false,
      })
    } catch (error) {
      if (appliedRevision !== null) {
        await this.#core.restoreProjectSnapshot(input.projectPath, snapshotPath, appliedRevision)
      }
      throw new StudioCoreError(
        'CUSTOMIZATION_UNINSTALL_FAILED',
        appliedRevision === null
          ? '卸载失败，项目未写入。'
          : '卸载 Smoke Test 失败，已自动恢复卸载前快照。',
        { cause: error, details: { recovered: appliedRevision !== null, snapshotId } },
      )
    }
  }

  async restore(input: CustomizationRestoreInput): Promise<CustomizationRestoreResult> {
    const current = await this.#core.inspectProject(input.projectPath)
    const snapshotPath = path.join(
      path.dirname(current.path),
      '.agent-stack-local',
      'install-snapshots',
      `${input.snapshotId}.agent-stack`,
    )
    const metadata = await lstat(snapshotPath).catch((error: unknown) => {
      throw new StudioCoreError('SOURCE_NOT_FOUND', '找不到该安装快照。', { cause: error })
    })
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new StudioCoreError('UNSAFE_SOURCE', '安装快照必须是 Studio 创建的普通文件。')
    }
    const restored = await this.#core.restoreProjectSnapshot(
      input.projectPath,
      snapshotPath,
      input.expectedRevision,
    )
    return customizationRestoreResultSchema.parse({
      status: 'restored',
      projectId: restored.project.id,
      revision: restored.project.revision,
      snapshotId: input.snapshotId,
    })
  }

  #recipe(recipeId: string, harnessId: CustomizationInstallInput['harnessId']): InstallRecipe {
    const recipe = this.#recipes.find(({ id }) => id === recipeId)
    if (!recipe || !recipe.supportedHarnesses.includes(harnessId)) {
      throw new StudioCoreError(
        'CUSTOMIZATION_RECIPE_NOT_FOUND',
        '没有匹配该 Harness 的固定安装方案。',
      )
    }
    return recipe
  }

  #assertRevisionAndHarness(
    state: Awaited<ReturnType<StudioCore['inspectProject']>>,
    expectedRevision: number,
    harnessId: CustomizationInstallInput['harnessId'],
  ): void {
    if (state.project.revision !== expectedRevision) {
      throw new StudioCoreError('REVISION_CONFLICT', '项目修订已变化，请重新读取后操作。', {
        details: { expectedRevision, actualRevision: state.project.revision },
      })
    }
    if (controllerHarness(state.project) !== harnessId) {
      throw new StudioCoreError('HARNESS_NOT_AVAILABLE', '当前项目未选择该 Harness。')
    }
  }

  async #createSnapshot(
    projectFile: string,
  ): Promise<{ snapshotId: string; snapshotPath: string }> {
    const snapshotDirectory = path.join(
      path.dirname(projectFile),
      '.agent-stack-local',
      'install-snapshots',
    )
    await mkdir(snapshotDirectory, { recursive: true, mode: 0o700 })
    const snapshotId = randomUUID()
    const snapshotPath = path.join(snapshotDirectory, `${snapshotId}.agent-stack`)
    await copyFile(projectFile, snapshotPath)
    await chmod(snapshotPath, 0o600)
    return { snapshotId, snapshotPath }
  }

  async #readLocalRecipe(rootPath: string, recipe: InstallRecipe): Promise<[string, string]> {
    const metadata = await lstat(rootPath)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new StudioCoreError('UNSAFE_SOURCE', '本地安装来源必须是非符号链接目录。')
    }
    const root = await realpath(rootPath)
    return Promise.all([
      this.#readPinnedLocalFile(root, recipe.artifactPath),
      this.#readPinnedLocalFile(root, recipe.licensePath),
    ])
  }

  async #readPinnedLocalFile(root: string, relativePath: string): Promise<string> {
    const filePath = relativeFile(root, relativePath)
    let metadata
    try {
      metadata = await lstat(filePath)
    } catch (error) {
      throw new StudioCoreError('SOURCE_NOT_FOUND', '本地来源缺少固定方案文件。', {
        cause: error,
        details: { relativePath },
      })
    }
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_ARTIFACT_BYTES) {
      throw new StudioCoreError(
        'UNSAFE_SOURCE',
        '固定方案文件必须是来源目录内、大小受限的普通文本文件。',
        { details: { relativePath } },
      )
    }
    return readFile(filePath, 'utf8')
  }

  async #download(url: string, signal: AbortSignal): Promise<string> {
    let response: Response
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal,
        headers: { Accept: 'text/plain' },
      })
    } catch (error) {
      if (signal.aborted) throw new StudioCoreError('OPERATION_CANCELLED', '安装下载已取消。')
      throw new StudioCoreError('DISCOVERY_NETWORK_FAILED', '无法下载固定 Skill 文件。', {
        cause: error,
      })
    }
    if (!response.ok) {
      throw new StudioCoreError(
        'DISCOVERY_PROVIDER_FAILED',
        `固定 Skill 来源返回 HTTP ${response.status}。`,
      )
    }
    const length = Number(response.headers.get('content-length') ?? '0')
    if (Number.isFinite(length) && length > MAX_ARTIFACT_BYTES) {
      throw new StudioCoreError('CUSTOMIZATION_INTEGRITY_FAILED', '下载文件超出大小上限。')
    }
    const value = await response.text()
    if (Buffer.byteLength(value, 'utf8') > MAX_ARTIFACT_BYTES) {
      throw new StudioCoreError('CUSTOMIZATION_INTEGRITY_FAILED', '下载文件超出大小上限。')
    }
    return value
  }
}
