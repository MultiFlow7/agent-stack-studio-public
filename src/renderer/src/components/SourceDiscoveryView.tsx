import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Copy,
  GitFork,
  GithubLogo,
  MagnifyingGlass,
  ShieldCheck,
  Star,
  Wrench,
  X,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type {
  DiscoveredRepository,
  SourceHandoff,
  SourceSearchResult,
} from '../../../shared/source-discovery'
import type {
  CustomizationInstallResult,
  CustomizationRecipeStatus,
  CustomizationRecognition,
  CustomizationUninstallResult,
  CustomizationTask,
} from '../../../shared/customization'
import type { HarnessId } from '../../../shared/native-agent'

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error' | 'cancelled'
type SearchFailureKind = 'validation' | 'network' | 'timeout' | 'rate-limit' | 'provider'

interface SearchFailure {
  advice: string
  kind: SearchFailureKind
  message: string
  title: string
}

function presentSearchFailure(error: unknown): SearchFailure {
  const message = error instanceof Error ? error.message : '无法搜索 GitHub。'
  if (message.includes('频率') || message.includes('rate limit')) {
    return {
      advice: '等待 GitHub 指定的重置时间后再试；Studio 不会自动重试或改用凭证。',
      kind: 'rate-limit',
      message,
      title: 'GitHub 搜索频率受限',
    }
  }
  if (message.includes('秒内未响应') || message.includes('超时')) {
    return {
      advice: '检查网络或代理延迟后重试；本次请求没有保存结果或下载仓库。',
      kind: 'timeout',
      message,
      title: 'GitHub 响应超时',
    }
  }
  if (message.includes('无法连接') || message.includes('离线')) {
    return {
      advice: '检查网络或代理设置后重试，也可以稍后在 GitHub 网站中搜索。',
      kind: 'network',
      message,
      title: '无法连接 GitHub',
    }
  }
  return {
    advice: '稍后重试；如果问题持续，可在 GitHub 网站搜索后再进行本地静态导入。',
    kind: 'provider',
    message,
    title: 'GitHub Provider 返回错误',
  }
}

function dateLabel(value: string | null): string {
  if (!value) return '没有提交时间'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function shellArgument(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function commandText(command: SourceHandoff['commands'][number]): string {
  return [command.executable, ...command.args].map(shellArgument).join(' ')
}

export function SourceDiscoveryView() {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'relevance' | 'stars' | 'updated'>('relevance')
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [result, setResult] = useState<SourceSearchResult>()
  const [error, setError] = useState<SearchFailure>()
  const [handoff, setHandoff] = useState<SourceHandoff>()
  const [handoffError, setHandoffError] = useState<string>()
  const [handoffLoading, setHandoffLoading] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [customSource, setCustomSource] = useState('')
  const [customHarness, setCustomHarness] = useState<HarnessId>('openclaw')
  const [customStatus, setCustomStatus] = useState<
    'idle' | 'recognizing' | 'ready' | 'task' | 'installing' | 'installed' | 'error' | 'cancelled'
  >('idle')
  const [recognition, setRecognition] = useState<CustomizationRecognition>()
  const [customTask, setCustomTask] = useState<CustomizationTask>()
  const [installResult, setInstallResult] = useState<CustomizationInstallResult>()
  const [uninstallResult, setUninstallResult] = useState<CustomizationUninstallResult>()
  const [recipeStatuses, setRecipeStatuses] = useState<CustomizationRecipeStatus[]>([])
  const [selectedRecipeId, setSelectedRecipeId] = useState('')
  const [lastSnapshotId, setLastSnapshotId] = useState<string>()
  const [customError, setCustomError] = useState<string>()
  const [installConfirmed, setInstallConfirmed] = useState(false)
  const operation = useRef(0)
  const searchInput = useRef<HTMLInputElement>(null)

  const totalPages = useMemo(() => {
    if (!result) return 1
    return Math.max(1, Math.min(10, Math.ceil(result.totalCount / result.perPage)))
  }, [result])
  const selectedRecipe = useMemo(
    () => recognition?.availableRecipes.find(({ id }) => id === selectedRecipeId),
    [recognition, selectedRecipeId],
  )
  const selectedRecipeStatus = useMemo(
    () => recipeStatuses.find(({ recipe }) => recipe.id === selectedRecipeId),
    [recipeStatuses, selectedRecipeId],
  )

  async function search(page = 1): Promise<void> {
    const normalized = query.trim()
    if (normalized.length < 2) {
      setError({
        advice: '增加搜索词或 GitHub 限定符后再次提交；当前输入没有发送到网络。',
        kind: 'validation',
        message: '请输入至少两个字符。',
        title: '搜索条件不完整',
      })
      setStatus('error')
      return
    }
    const id = ++operation.current
    setStatus('loading')
    setError(undefined)
    setHandoff(undefined)
    setHandoffError(undefined)
    setNotice(undefined)
    try {
      const next = await window.studio.discovery.search({
        provider: 'github',
        query: normalized,
        sort,
        order: 'desc',
        page,
        perPage: 10,
      })
      if (id !== operation.current) return
      setResult(next)
      setStatus('ready')
    } catch (searchError) {
      if (id !== operation.current) return
      setError(presentSearchFailure(searchError))
      setStatus('error')
    }
  }

  async function cancelSearch(): Promise<void> {
    operation.current += 1
    await window.studio.discovery.cancel().catch(() => undefined)
    setStatus('cancelled')
    setError(undefined)
  }

  async function prepareHandoff(repository: DiscoveredRepository): Promise<void> {
    setHandoffLoading(repository.fullName)
    setHandoffError(undefined)
    setNotice(undefined)
    try {
      setHandoff(
        await window.studio.discovery.handoff({
          provider: 'github',
          locator: repository.fullName,
        }),
      )
    } catch (handoffFailure) {
      setHandoffError(
        handoffFailure instanceof Error ? handoffFailure.message : '无法生成下载交接计划。',
      )
    } finally {
      setHandoffLoading(undefined)
    }
  }

  async function copyText(text: string, message: string): Promise<void> {
    try {
      await window.studio.discovery.copy(text)
      setNotice(message)
    } catch (copyError) {
      setHandoffError(copyError instanceof Error ? copyError.message : '无法复制交接内容。')
    }
  }

  async function recognizeCustomization(): Promise<void> {
    const api = window.studio.customization
    if (!api) return
    const source = customSource.trim()
    if (!source) {
      setCustomStatus('error')
      setCustomError('请输入 GitHub URL、owner/repo 或本地目录。')
      return
    }
    setCustomStatus('recognizing')
    setCustomError(undefined)
    setRecognition(undefined)
    setCustomTask(undefined)
    setInstallResult(undefined)
    setUninstallResult(undefined)
    setRecipeStatuses([])
    setSelectedRecipeId('')
    setInstallConfirmed(false)
    try {
      const result = await api.recognize({ source, harnessId: customHarness })
      setRecognition(result)
      setSelectedRecipeId(result.recipe?.id ?? '')
      setCustomStatus('ready')
    } catch (failure) {
      setCustomStatus('error')
      setCustomError(failure instanceof Error ? failure.message : '无法识别来源。')
    }
  }

  async function generateCustomizationTask(): Promise<void> {
    const api = window.studio.customization
    if (!api) return
    setCustomStatus('recognizing')
    setCustomError(undefined)
    try {
      const task = await api.task({ source: customSource.trim(), harnessId: customHarness })
      setRecognition(task.recognition)
      setCustomTask(task)
      setCustomStatus('task')
    } catch (failure) {
      setCustomStatus('error')
      setCustomError(failure instanceof Error ? failure.message : '无法生成定制任务。')
    }
  }

  async function refreshRecipeStatuses(): Promise<void> {
    const api = window.studio.customization
    if (!api) return
    setCustomError(undefined)
    try {
      setRecipeStatuses(await api.check({ harnessId: customHarness }))
    } catch (failure) {
      setCustomError(failure instanceof Error ? failure.message : '无法检查安装状态。')
    }
  }

  async function installKnownRecipe(operation: 'install' | 'update'): Promise<void> {
    const api = window.studio.customization
    const recipe = selectedRecipe
    const source = recognition?.source
    if (!api || !recipe || !source || !installConfirmed) return
    setCustomStatus('installing')
    setCustomError(undefined)
    try {
      const current = await window.studio.studioProject?.current()
      if (!current?.project) throw new Error('请先打开 Agent Stack 项目。')
      const installed = await api[operation]({
        recipeId: recipe.id,
        harnessId: customHarness,
        ...(source.kind === 'local' ? { localSourcePath: source.path } : {}),
        expectedRevision: current.project.revision,
        confirmed: true,
      })
      setInstallResult(installed)
      setUninstallResult(undefined)
      setLastSnapshotId(installed.snapshotId)
      setInstallConfirmed(false)
      setCustomStatus('installed')
      await refreshRecipeStatuses()
    } catch (failure) {
      setCustomStatus('error')
      setCustomError(failure instanceof Error ? failure.message : '无法安装固定方案。')
    }
  }

  async function smokeKnownRecipe(): Promise<void> {
    const api = window.studio.customization
    if (!api || !selectedRecipeId) return
    setCustomError(undefined)
    try {
      const result = await api.smoke({ recipeId: selectedRecipeId, harnessId: customHarness })
      setNotice(`内容接线 Smoke Test 通过：${result.level}。`)
    } catch (failure) {
      setCustomError(failure instanceof Error ? failure.message : 'Smoke Test 未通过。')
    }
  }

  async function uninstallKnownRecipe(): Promise<void> {
    const api = window.studio.customization
    if (!api || !selectedRecipeId || !installConfirmed) return
    setCustomStatus('installing')
    setCustomError(undefined)
    try {
      const current = await window.studio.studioProject?.current()
      if (!current?.project) throw new Error('请先打开 Agent Stack 项目。')
      const result = await api.uninstall({
        recipeId: selectedRecipeId,
        harnessId: customHarness,
        expectedRevision: current.project.revision,
        confirmed: true,
      })
      setUninstallResult(result)
      setInstallResult(undefined)
      if (result.snapshotId) setLastSnapshotId(result.snapshotId)
      setInstallConfirmed(false)
      setCustomStatus('installed')
      await refreshRecipeStatuses()
    } catch (failure) {
      setCustomStatus('error')
      setCustomError(failure instanceof Error ? failure.message : '无法卸载固定方案。')
    }
  }

  async function restoreLastSnapshot(): Promise<void> {
    const api = window.studio.customization
    if (!api || !lastSnapshotId || !installConfirmed) return
    setCustomStatus('installing')
    setCustomError(undefined)
    try {
      const current = await window.studio.studioProject?.current()
      if (!current?.project) throw new Error('请先打开 Agent Stack 项目。')
      await api.restore({
        snapshotId: lastSnapshotId,
        expectedRevision: current.project.revision,
        confirmed: true,
      })
      setInstallConfirmed(false)
      setCustomStatus('installed')
      setNotice('安装快照已恢复。')
      await refreshRecipeStatuses()
    } catch (failure) {
      setCustomStatus('error')
      setCustomError(failure instanceof Error ? failure.message : '无法恢复安装快照。')
    }
  }

  async function cancelInstall(): Promise<void> {
    await window.studio.customization?.cancel().catch(() => undefined)
    setCustomStatus('cancelled')
    setCustomError(undefined)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (customStatus === 'installing') void cancelInstall()
      else if (status === 'loading') void cancelSearch()
      else if (handoff) setHandoff(undefined)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  useEffect(
    () => () => {
      operation.current += 1
      void window.studio.discovery.cancel().catch(() => undefined)
    },
    [],
  )

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void search(1)
  }

  return (
    <div className="discovery-view">
      <header className="page-header discovery-header">
        <div>
          <div className="discovery-kicker">
            <GithubLogo aria-hidden="true" size={18} weight="fill" />
            GitHub 公开仓库
          </div>
          <h1>发现组件来源</h1>
          <p>搜索公开元数据，把下载和静态检查交给你选择的人或 Coding Agent。</p>
        </div>
        <div className="discovery-boundary" aria-label="安全边界">
          <ShieldCheck aria-hidden="true" size={20} weight="duotone" />
          <span>
            <strong>仅公开元数据</strong>
            不下载，不执行代码
          </span>
        </div>
      </header>

      {window.studio.customization ? (
        <section className="customization-lab" aria-labelledby="customization-title">
          <header>
            <div>
              <span className="discovery-kicker">
                <Wrench aria-hidden="true" size={18} />
                M36 固定方案
              </span>
              <h2 id="customization-title">识别已知方案或生成定制任务</h2>
              <p>GitHub URL 和本地目录都只读检查；未知来源不会被执行。</p>
            </div>
            <span className="status-chip">不执行来源代码</span>
          </header>
          <div className="customization-form">
            <label className="field customization-source-field">
              <span>来源</span>
              <input
                disabled={customStatus === 'recognizing' || customStatus === 'installing'}
                onChange={(event) => setCustomSource(event.target.value)}
                placeholder="https://github.com/owner/repo 或 /path/to/local"
                value={customSource}
              />
            </label>
            <label className="field">
              <span>目标 Harness</span>
              <select
                disabled={customStatus === 'recognizing' || customStatus === 'installing'}
                onChange={(event) => setCustomHarness(event.target.value as HarnessId)}
                value={customHarness}
              >
                <option value="openclaw">OpenClaw</option>
                <option value="pi">Pi</option>
                <option value="codex">Codex CLI</option>
              </select>
            </label>
            <button
              className="button button--secondary"
              disabled={customStatus === 'recognizing' || customStatus === 'installing'}
              onClick={() => void recognizeCustomization()}
              type="button"
            >
              {customStatus === 'recognizing' ? '正在识别…' : '静态识别'}
            </button>
          </div>

          {customError ? (
            <div className="inline-feedback inline-feedback--error" role="alert">
              {customError}
            </div>
          ) : null}
          {customStatus === 'cancelled' ? (
            <div className="inline-feedback">安装已取消；如果尚未写入，项目保持不变。</div>
          ) : null}

          {recognition ? (
            <div className={`customization-result customization-result--${recognition.status}`}>
              <div>
                <strong>{recognition.status === 'known' ? '命中固定安装方案' : '未知来源'}</strong>
                <p>{recognition.safetyNotice}</p>
              </div>
              {recognition.recipe ? (
                <dl>
                  {recognition.availableRecipes.length > 1 ? (
                    <div>
                      <dt>固定方案</dt>
                      <dd>
                        <select
                          aria-label="固定方案"
                          disabled={customStatus === 'installing'}
                          onChange={(event) => setSelectedRecipeId(event.target.value)}
                          value={selectedRecipeId}
                        >
                          {recognition.availableRecipes.map((recipe) => (
                            <option key={recipe.id} value={recipe.id}>
                              {recipe.title}
                            </option>
                          ))}
                        </select>
                      </dd>
                    </div>
                  ) : null}
                  {recognition.availableRecipes.length === 1 ? (
                    <div>
                      <dt>方案</dt>
                      <dd>{selectedRecipe?.title ?? recognition.recipe.title}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>固定提交</dt>
                    <dd>
                      <code>{(selectedRecipe ?? recognition.recipe).commit.slice(0, 12)}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>SHA-256</dt>
                    <dd>
                      <code>
                        {(selectedRecipe ?? recognition.recipe).artifactSha256.slice(0, 16)}
                      </code>
                    </dd>
                  </div>
                  <div>
                    <dt>License</dt>
                    <dd>{recognition.recipe.license}</dd>
                  </div>
                  <div>
                    <dt>Harness 支持</dt>
                    <dd>
                      {(selectedRecipe ?? recognition.recipe).harnessSupport.find(
                        ({ harnessId }) => harnessId === customHarness,
                      )?.level ?? 'unavailable'}
                    </dd>
                  </div>
                </dl>
              ) : null}
              {selectedRecipe ? (
                <div className="inline-feedback">
                  <strong>
                    {selectedRecipe.contentCompleteness === 'complete'
                      ? '完整 Markdown 方案'
                      : '仅说明文件，能力会降级'}
                  </strong>
                  <p>
                    {
                      selectedRecipe.harnessSupport.find(
                        ({ harnessId }) => harnessId === customHarness,
                      )?.detail
                    }
                  </p>
                  {selectedRecipe.limitations.map((limitation) => (
                    <p key={limitation}>{limitation}</p>
                  ))}
                </div>
              ) : null}
              <div className="customization-actions">
                <button
                  className="button button--secondary"
                  disabled={customStatus === 'recognizing' || customStatus === 'installing'}
                  onClick={() => void generateCustomizationTask()}
                  type="button"
                >
                  生成 Coding Agent 任务
                </button>
                {recognition.recipe ? (
                  <>
                    <button
                      className="button button--secondary"
                      disabled={customStatus === 'installing'}
                      onClick={() => void refreshRecipeStatuses()}
                      type="button"
                    >
                      检查安装状态
                    </button>
                    <label className="customization-confirm">
                      <input
                        checked={installConfirmed}
                        disabled={customStatus === 'installing'}
                        onChange={(event) => setInstallConfirmed(event.target.checked)}
                        type="checkbox"
                      />
                      <span>已检查 commit、SHA-256、License 与快照恢复范围</span>
                    </label>
                    {customStatus === 'installing' ? (
                      <button
                        className="button button--secondary"
                        onClick={() => void cancelInstall()}
                        type="button"
                      >
                        取消安装
                      </button>
                    ) : (
                      <button
                        className="button button--primary"
                        disabled={!installConfirmed}
                        onClick={() =>
                          void installKnownRecipe(
                            selectedRecipeStatus?.state === 'drifted' ? 'update' : 'install',
                          )
                        }
                        type="button"
                      >
                        {selectedRecipeStatus?.state === 'drifted'
                          ? '更新到固定版本'
                          : '安装固定 Skill'}
                      </button>
                    )}
                    {selectedRecipeStatus?.state === 'current' ? (
                      <>
                        <button
                          className="button button--secondary"
                          onClick={() => void smokeKnownRecipe()}
                          type="button"
                        >
                          运行内容 Smoke Test
                        </button>
                        <button
                          className="button button--secondary"
                          disabled={!installConfirmed}
                          onClick={() => void uninstallKnownRecipe()}
                          type="button"
                        >
                          卸载 Skill
                        </button>
                      </>
                    ) : null}
                    {lastSnapshotId ? (
                      <button
                        className="button button--secondary"
                        disabled={!installConfirmed}
                        onClick={() => void restoreLastSnapshot()}
                        type="button"
                      >
                        恢复上次快照
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {customTask ? (
            <div className="customization-task">
              <header>
                <strong>{customTask.fileName}</strong>
                <button
                  className="button button--secondary"
                  onClick={() => void copyText(customTask.markdown, 'Coding Agent 任务已复制。')}
                  type="button"
                >
                  <Copy aria-hidden="true" size={16} /> 复制 Markdown 任务
                </button>
              </header>
              <pre>{customTask.markdown}</pre>
            </div>
          ) : null}

          {installResult ? (
            <div className="inline-feedback inline-feedback--success" role="status">
              {installResult.status === 'reused'
                ? 'Skill 已存在，未重复写入。'
                : 'Skill 已安装并通过 Smoke Test。'}
              上游代码执行：否。
            </div>
          ) : null}
          {uninstallResult ? (
            <div className="inline-feedback inline-feedback--success" role="status">
              {uninstallResult.status === 'uninstalled'
                ? 'Skill 已卸载并通过复读验证。'
                : 'Skill 原本未安装，项目没有写入。'}
              上游代码执行：否。
            </div>
          ) : null}
        </section>
      ) : null}

      <form className="discovery-search" onSubmit={submit} role="search">
        <label className="discovery-search__field">
          <span className="sr-only">搜索 GitHub 公开仓库</span>
          <MagnifyingGlass aria-hidden="true" size={20} />
          <input
            autoFocus
            disabled={status === 'loading'}
            maxLength={256}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="能力、框架或 GitHub 搜索限定符"
            type="search"
            value={query}
            ref={searchInput}
          />
        </label>
        <label className="discovery-sort">
          <span>排序</span>
          <select
            disabled={status === 'loading'}
            onChange={(event) => setSort(event.target.value as 'relevance' | 'stars' | 'updated')}
            value={sort}
          >
            <option value="relevance">相关度</option>
            <option value="stars">Star</option>
            <option value="updated">最近更新</option>
          </select>
        </label>
        {status === 'loading' ? (
          <button
            className="button button--secondary"
            onClick={() => void cancelSearch()}
            type="button"
          >
            <X aria-hidden="true" size={17} />
            取消搜索
          </button>
        ) : (
          <button className="button button--primary" type="submit">
            <MagnifyingGlass aria-hidden="true" size={17} />
            搜索来源
          </button>
        )}
      </form>

      <p aria-live="polite" className="sr-only">
        {status === 'loading' ? '正在搜索 GitHub 公开仓库。' : null}
        {status === 'cancelled' ? '搜索已取消。' : null}
        {status === 'ready' ? `找到 ${result?.totalCount ?? 0} 个结果。` : null}
        {notice}
      </p>

      {status === 'idle' ? (
        <section className="discovery-intro">
          <div className="discovery-intro__icon" aria-hidden="true">
            <MagnifyingGlass size={30} weight="duotone" />
          </div>
          <h2>先找到候选来源，再决定是否下载</h2>
          <p>
            Studio 展示 GitHub
            报告的许可、语言、活跃时间和仓库状态。搜索结果不是安全认证，下载后的内容仍需经过本地静态检查。
          </p>
          <ul>
            <li>不会发送当前项目文件、路径或组件信息</li>
            <li>不会自动执行 clone、install、Hook 或仓库脚本</li>
            <li>交接计划同时适用于人工 Shell 和任意 Coding Agent</li>
          </ul>
        </section>
      ) : null}

      {status === 'loading' ? (
        <section aria-busy="true" aria-label="正在搜索来源" className="discovery-loading">
          <div className="skeleton skeleton--title" />
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </section>
      ) : null}

      {status === 'cancelled' ? (
        <section className="state-panel">
          <h2>搜索已取消</h2>
          <p>没有保存结果，也没有下载仓库。你可以修改搜索条件后重新开始。</p>
          <button className="button button--secondary" onClick={() => void search(1)} type="button">
            重新搜索
          </button>
        </section>
      ) : null}

      {status === 'error' ? (
        <section className="state-panel state-panel--error" role="alert">
          <h2>{error?.title}</h2>
          <p>{error?.message}</p>
          <p>{error?.advice}</p>
          <button
            className="button button--secondary"
            onClick={() =>
              error?.kind === 'validation' ? searchInput.current?.focus() : void search(1)
            }
            type="button"
          >
            {error?.kind === 'validation' ? '修改搜索条件' : '重试搜索'}
          </button>
        </section>
      ) : null}

      {status === 'ready' && result?.items.length === 0 ? (
        <section className="empty-state discovery-empty">
          <h2>没有匹配的公开仓库</h2>
          <p>尝试减少限定词、改用英文能力名称，或直接输入已知的 owner/repo。</p>
        </section>
      ) : null}

      {status === 'ready' && result && result.items.length > 0 ? (
        <section className="discovery-results" aria-labelledby="discovery-results-title">
          <header className="discovery-results__header">
            <div>
              <h2 id="discovery-results-title">候选来源</h2>
              <p>
                GitHub 报告 {result.totalCount.toLocaleString('zh-CN')} 个结果
                {result.incompleteResults ? '，当前结果可能不完整' : ''}。
              </p>
            </div>
            <span className="discovery-rate">
              {result.rateLimit.remaining === null
                ? '未返回搜索额度'
                : `本窗口剩余 ${result.rateLimit.remaining} 次`}
            </span>
          </header>
          <div className="discovery-result-list">
            {result.items.map((repository) => (
              <article className="discovery-result" key={repository.sourceId}>
                <div className="discovery-result__main">
                  <div className="discovery-result__title">
                    <GithubLogo aria-hidden="true" size={19} />
                    <h3>{repository.fullName}</h3>
                    {repository.archived ? <span className="status-chip">已归档</span> : null}
                    {repository.fork ? <span className="status-chip">Fork</span> : null}
                  </div>
                  <p>{repository.description || '该仓库没有公开描述。'}</p>
                  <div className="discovery-result__meta">
                    <span>
                      <Star aria-hidden="true" size={15} />
                      {repository.stars.toLocaleString('zh-CN')}
                    </span>
                    <span>
                      <GitFork aria-hidden="true" size={15} />
                      {repository.forks.toLocaleString('zh-CN')}
                    </span>
                    <span>{repository.language || '语言未知'}</span>
                    <span>{repository.licenseSpdx || '未声明许可证'}</span>
                    <span>提交于 {dateLabel(repository.pushedAt)}</span>
                  </div>
                </div>
                <button
                  className="button button--secondary discovery-result__action"
                  disabled={handoffLoading === repository.fullName || repository.disabled}
                  onClick={() => void prepareHandoff(repository)}
                  type="button"
                >
                  {handoffLoading === repository.fullName ? '正在准备…' : '准备下载交接'}
                </button>
              </article>
            ))}
          </div>
          <footer className="discovery-pagination" aria-label="搜索结果分页">
            <button
              className="button button--secondary"
              disabled={result.page <= 1}
              onClick={() => void search(result.page - 1)}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={16} />
              上一页
            </button>
            <span>
              第 {result.page} / {totalPages} 页
            </span>
            <button
              className="button button--secondary"
              disabled={result.page >= totalPages}
              onClick={() => void search(result.page + 1)}
              type="button"
            >
              下一页
              <ArrowRight aria-hidden="true" size={16} />
            </button>
          </footer>
        </section>
      ) : null}

      {handoffError ? (
        <div className="inline-feedback inline-feedback--error" role="alert">
          {handoffError}
        </div>
      ) : null}

      {handoff ? (
        <section className="handoff-panel" aria-labelledby="handoff-title">
          <header>
            <div>
              <span className="handoff-panel__label">下载交接 v{handoff.formatVersion}</span>
              <h2 id="handoff-title">{handoff.repository.fullName}</h2>
            </div>
            <button
              aria-label="关闭下载交接"
              className="icon-button"
              onClick={() => setHandoff(undefined)}
              type="button"
            >
              <X aria-hidden="true" size={18} />
            </button>
          </header>
          <p className="handoff-panel__notice">
            <ShieldCheck aria-hidden="true" size={18} />
            {handoff.safetyNotice}
          </p>
          <div className="handoff-command-list">
            {handoff.commands.map((command) => {
              const text = commandText(command)
              return (
                <div className="handoff-command" key={command.purpose}>
                  <div>
                    <strong>{command.purpose === 'clone' ? '下载仓库' : '静态检查'}</strong>
                    <span>执行前需要审阅</span>
                  </div>
                  <code>{text}</code>
                  <button
                    aria-label={`复制${command.purpose === 'clone' ? '下载' : '静态检查'}命令`}
                    className="icon-button"
                    onClick={() => void copyText(text, '命令已复制。')}
                    type="button"
                  >
                    <Copy aria-hidden="true" size={18} />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="handoff-panel__actions">
            <button
              className="button button--secondary"
              onClick={() =>
                void copyText(JSON.stringify(handoff, null, 2), '结构化交接 JSON 已复制。')
              }
              type="button"
            >
              <Copy aria-hidden="true" size={17} />
              复制交接 JSON
            </button>
            <button
              className="button button--secondary"
              onClick={() => void window.studio.discovery.open(handoff.repository.htmlUrl)}
              type="button"
            >
              <ArrowSquareOut aria-hidden="true" size={17} />
              打开 GitHub 仓库
            </button>
          </div>
          {notice ? <p className="handoff-panel__success">{notice}</p> : null}
        </section>
      ) : null}
    </div>
  )
}
