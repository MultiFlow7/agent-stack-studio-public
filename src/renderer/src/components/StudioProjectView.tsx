import {
  ArrowClockwise,
  CheckCircle,
  FileCode,
  FolderOpen,
  Package,
  Plus,
  ShieldCheck,
  WarningCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudioProjectState } from '../../../shared/studio-project'

type LoadStatus = 'loading' | 'ready' | 'error'

export function StudioProjectView() {
  const [state, setState] = useState<StudioProjectState>()
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string>()
  const [feedback, setFeedback] = useState<string>()
  const [pending, setPending] = useState<string>()
  const requestId = useRef(0)

  const load = useCallback(async (external = false) => {
    const request = ++requestId.current
    setStatus('loading')
    setError(undefined)
    try {
      const next = await window.studio.studioProject!.current()
      if (request !== requestId.current) return
      setState(external ? { ...next, changedExternally: true } : next)
      setStatus('ready')
    } catch (cause) {
      if (request !== requestId.current) return
      setError(cause instanceof Error ? cause.message : '无法读取项目设置。')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
    return window.studio.studioProject!.onExternalChanged(() => void load(true))
  }, [load])

  async function choose(mode: 'open' | 'init') {
    setPending(mode)
    setError(undefined)
    setFeedback(undefined)
    try {
      const next =
        mode === 'open'
          ? await window.studio.studioProject!.open()
          : await window.studio.studioProject!.init()
      setState(next)
      setStatus('ready')
      if (next.project) setFeedback(`已切换到“${next.project.name}”。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '项目选择失败。')
    } finally {
      setPending(undefined)
    }
  }

  async function exportPackage() {
    setPending('export')
    setError(undefined)
    setFeedback(undefined)
    try {
      const result = await window.studio.studioProject!.export()
      setFeedback(
        result.status === 'cancelled'
          ? '已取消导出，项目未发生变化。'
          : `已导出可移植包：${result.path}`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法导出项目包。')
    } finally {
      setPending(undefined)
    }
  }

  if (status === 'loading') {
    return (
      <section aria-busy="true" aria-label="正在载入项目设置" className="loading-state">
        <div className="skeleton skeleton--title" />
        <div className="skeleton" />
      </section>
    )
  }

  if (status === 'error' && !state) {
    return (
      <section className="state-panel state-panel--error" role="alert">
        <WarningCircle aria-hidden="true" size={24} />
        <h2>无法载入项目设置</h2>
        <p>{error}</p>
        <button className="button button--secondary" onClick={() => void load()} type="button">
          <ArrowClockwise aria-hidden="true" size={17} />
          重试
        </button>
      </section>
    )
  }

  const project = state?.project
  return (
    <div className="project-page">
      <header className="page-header project-header">
        <div>
          <h1>项目设置</h1>
          <p>切换当前项目，查看可移植文件的 revision、完整性与备份恢复状态。</p>
        </div>
        <div className="page-header__actions">
          {project ? (
            <button
              className="button button--secondary"
              disabled={Boolean(pending)}
              onClick={() => void exportPackage()}
              type="button"
            >
              <Package aria-hidden="true" size={17} />
              导出可移植包
            </button>
          ) : null}
          <button
            className="button button--secondary"
            disabled={Boolean(pending)}
            onClick={() => void choose('open')}
            type="button"
          >
            <FolderOpen aria-hidden="true" size={17} />
            打开项目
          </button>
          <button
            className="button button--primary"
            disabled={Boolean(pending)}
            onClick={() => void choose('init')}
            type="button"
          >
            <Plus aria-hidden="true" size={17} />
            创建项目
          </button>
        </div>
      </header>

      {state?.changedExternally ? (
        <div className="project-change-note" role="status">
          <ArrowClockwise aria-hidden="true" size={17} />
          <span>检测到外部修改，已刷新到 revision {project?.revision}。</span>
        </div>
      ) : null}
      {state?.recovered ? (
        <div className="project-change-note" role="alert">
          <WarningCircle aria-hidden="true" size={17} />
          <span>项目已从最后有效备份恢复；无效原文件已保留供人工比较。</span>
        </div>
      ) : null}
      {error ? (
        <div className="detail-feedback detail-feedback--error" role="alert">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="detail-feedback" role="status">
          <CheckCircle aria-hidden="true" size={18} weight="fill" />
          {feedback}
        </div>
      ) : null}

      {!project ? (
        <section className="empty-state project-empty">
          <FileCode aria-hidden="true" size={34} weight="duotone" />
          <h2>当前没有打开的项目</h2>
          <p>一个 .agent-stack 项目对应一个可移植 Agent Stack；组件组装在 Agent 页完成。</p>
        </section>
      ) : (
        <section className="project-section" aria-labelledby="project-settings-summary">
          <header>
            <div>
              <h2 id="project-settings-summary">{project.name}</h2>
              <p>{project.description || '暂无项目描述'}</p>
            </div>
            <span>revision {project.revision}</span>
          </header>
          <dl className="fact-list">
            <div>
              <dt>事实文件</dt>
              <dd>{state?.projectPath}</dd>
            </div>
            <div>
              <dt>格式</dt>
              <dd>.agent-stack v{project.formatVersion}</dd>
            </div>
            <div>
              <dt>完整性</dt>
              <dd>
                <ShieldCheck aria-hidden="true" size={16} /> SHA-256 已验证{' '}
                {state?.integrity?.versionsChecked ?? 0} 个版本
              </dd>
            </div>
            <div>
              <dt>本机 Agent 引用</dt>
              <dd>{state?.localAgentId ?? '尚未建立'}</dd>
            </div>
            <div>
              <dt>CLI</dt>
              <dd>
                <code>{state?.cliPath}</code>
              </dd>
            </div>
          </dl>
          <div className="project-change-note project-export-note">
            <ShieldCheck aria-hidden="true" size={17} />
            <span>
              项目包不包含 Keychain
              密钥、SQLite、Run、Experiment、Receipt、Artifact、日志或本机绝对路径。
            </span>
          </div>
        </section>
      )}
    </div>
  )
}
