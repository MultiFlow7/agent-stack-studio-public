import {
  ArrowClockwise,
  CheckCircle,
  CloudSlash,
  LockKey,
  PaperPlaneTilt,
  ShieldCheck,
  WarningCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import type { AgentVersion } from '../../../shared/agent-detail'
import {
  localContractTestTargetId,
  type PublishHistory,
  type PublishPreview,
  type PublishTarget,
} from '../../../shared/publish'
import { publishStatusLabels } from '../copy'

interface PublishPanelProps {
  agentId: string
  version: AgentVersion | undefined
}

export function PublishPanel({ agentId, version }: PublishPanelProps) {
  const [targets, setTargets] = useState<PublishTarget[]>([])
  const [selectedTargetId, setSelectedTargetId] =
    useState<PublishTarget['id']>(localContractTestTargetId)
  const [preview, setPreview] = useState<PublishPreview>()
  const [history, setHistory] = useState<PublishHistory>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string>()
  const [confirmed, setConfirmed] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [feedback, setFeedback] = useState<string>()

  const load = useCallback(async () => {
    setStatus('loading')
    setError(undefined)
    try {
      const availableTargets = await window.studio.publishing.targets()
      setTargets(availableTargets)
      if (!version) {
        setPreview(undefined)
        setHistory(undefined)
        setStatus('ready')
        return
      }
      const [nextPreview, nextHistory] = await Promise.all([
        window.studio.publishing.preview({
          targetId: selectedTargetId,
          agentId,
          agentVersionId: version.id,
        }),
        window.studio.publishing.history(selectedTargetId, agentId),
      ])
      setPreview(nextPreview)
      setHistory(nextHistory)
      setStatus('ready')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法载入发布预检。')
      setStatus('error')
    }
  }, [agentId, selectedTargetId, version])

  useEffect(() => {
    void load()
  }, [load])

  async function publish(): Promise<void> {
    if (!version || !confirmed) return
    setPublishing(true)
    setError(undefined)
    setFeedback(undefined)
    try {
      const result = await window.studio.publishing.publish({
        targetId: selectedTargetId,
        agentId,
        agentVersionId: version.id,
        confirmed: true,
      })
      setFeedback(
        result.receipt.status === 'succeeded'
          ? result.reused
            ? '相同发布包已存在，已复用原 Receipt，未重复创建远端身份。'
            : '发布包已通过本地 Connector Contract Test。'
          : `发布失败：${result.receipt.failure?.message ?? '未知错误'}`,
      )
      setConfirmed(false)
      const [nextPreview, nextHistory] = await Promise.all([
        window.studio.publishing.preview({
          targetId: selectedTargetId,
          agentId,
          agentVersionId: version.id,
        }),
        window.studio.publishing.history(selectedTargetId, agentId),
      ])
      setPreview(nextPreview)
      setHistory(nextHistory)
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : '无法完成发布。')
    } finally {
      setPublishing(false)
    }
  }

  if (status === 'loading') {
    return (
      <section aria-busy="true" aria-label="正在载入发布预检" className="publish-loading">
        <div className="skeleton skeleton--title" />
        <div className="skeleton" />
        <div className="skeleton" />
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section className="publish-error" role="alert">
        <WarningCircle aria-hidden="true" size={22} />
        <span>
          <strong>无法载入发布记录</strong>
          <small>{error}</small>
        </span>
        <button className="button button--secondary" onClick={() => void load()} type="button">
          <ArrowClockwise aria-hidden="true" size={16} /> 重试
        </button>
      </section>
    )
  }

  if (!version) {
    return (
      <section className="publish-empty">
        <PaperPlaneTilt aria-hidden="true" size={28} />
        <h2>先创建不可变 Agent Version</h2>
        <p>发布不会读取可变草稿。创建版本并完成一次成功本地 Run 后，再进行预检。</p>
      </section>
    )
  }

  const blockingIssues =
    preview?.validation.issues.filter(({ severity }) => severity === 'blocking') ?? []
  const warnings = preview?.validation.issues.filter(({ severity }) => severity === 'warning') ?? []

  return (
    <div className="publish-panel">
      <header className="publish-panel__header">
        <div>
          <h2>发布 Agent Version</h2>
          <p>发布始终是主动操作，本地草稿和实验数据不会自动共享。</p>
        </div>
        <span className="publish-version">Version {version.versionNumber}</span>
      </header>

      <fieldset className="publish-targets">
        <legend>发布目标</legend>
        {targets.map((target) => (
          <label key={target.id}>
            <input
              checked={selectedTargetId === target.id}
              disabled={target.availability !== 'ready'}
              name="publish-target"
              onChange={() => {
                setSelectedTargetId(target.id)
                setConfirmed(false)
              }}
              type="radio"
            />
            <span>
              <strong>{target.label}</strong>
              <small>{target.description}</small>
            </span>
            <em>{target.availability === 'ready' ? '可验证' : '需要产品决策'}</em>
          </label>
        ))}
      </fieldset>

      <section
        className={`publish-validation publish-validation--${preview?.validation.status}`}
        aria-live="polite"
      >
        <header>
          {preview?.validation.status === 'ready' ? (
            <ShieldCheck aria-hidden="true" size={22} weight="fill" />
          ) : (
            <WarningCircle aria-hidden="true" size={22} weight="fill" />
          )}
          <span>
            <strong>
              {preview?.validation.status === 'ready' ? '发布预检通过' : '发布已阻断'}
            </strong>
            <small>
              检查时间：{new Date(preview?.validation.checkedAt ?? '').toLocaleString('zh-CN')}
            </small>
          </span>
        </header>
        {blockingIssues.length > 0 ? (
          <ul>
            {blockingIssues.map((issue) => (
              <li key={`${issue.code}-${issue.field}`}>
                <strong>{issue.field}</strong>
                {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p>版本已通过本地 Run 验证，Stack 未漂移，发布包不含敏感内容。</p>
        )}
        {warnings.map((issue) => (
          <div className="publish-warning" key={`${issue.code}-${issue.field}`}>
            <CloudSlash aria-hidden="true" size={17} /> {issue.message}
          </div>
        ))}
      </section>

      {preview ? (
        <section className="publish-package">
          <header>
            <h3>发布包预览</h3>
            <code>{preview.package.contentHash.slice(0, 12)}</code>
          </header>
          <dl>
            <div>
              <dt>包含</dt>
              <dd>
                Agent 名称与描述、版本溯源、{preview.package.stack.components.length} 个组件、能力
                Owner、Runtime 要求
              </dd>
            </div>
            <div>
              <dt>环境声明</dt>
              <dd>{preview.package.environmentDeclarations.length} 项，仅包含名称和是否必需</dd>
            </div>
            <div>
              <dt>明确排除</dt>
              <dd>本地路径、Keychain 密钥、实验数据、Run 日志和 Artifact</dd>
            </div>
          </dl>
          <div className="publish-confirmation">
            <label>
              <input
                checked={confirmed}
                disabled={preview.validation.status !== 'ready' || publishing}
                onChange={(event) => setConfirmed(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>我已检查发布范围</strong>
                <small>当前操作仅写入本地 Contract Test Receipt，不连接 Multica。</small>
              </span>
            </label>
            <button
              className="button button--primary"
              disabled={!confirmed || preview.validation.status !== 'ready' || publishing}
              onClick={() => void publish()}
              type="button"
            >
              <PaperPlaneTilt aria-hidden="true" size={16} weight="fill" />
              {publishing ? '正在发布…' : '发布此版本到本地测试目标'}
            </button>
          </div>
        </section>
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

      <section className="publish-history">
        <header>
          <h3>Receipt 与身份映射</h3>
          {history?.mapping ? (
            <span>
              Remote ID：<code>{history.mapping.remoteAgentId}</code>
            </span>
          ) : (
            <span>尚未建立映射</span>
          )}
        </header>
        {history?.receipts.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">尝试</th>
                  <th scope="col">状态</th>
                  <th scope="col">远端版本</th>
                  <th scope="col">时间</th>
                </tr>
              </thead>
              <tbody>
                {history.receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td>#{receipt.attempt}</td>
                    <td>
                      <span className={`receipt-status receipt-status--${receipt.status}`}>
                        {publishStatusLabels[receipt.status]}
                      </span>
                      {receipt.failure ? <small>{receipt.failure.message}</small> : null}
                    </td>
                    <td>
                      <code>{receipt.remoteVersionId ?? '—'}</code>
                    </td>
                    <td>
                      {new Date(receipt.completedAt ?? receipt.createdAt).toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="publish-history__empty">
            <LockKey aria-hidden="true" size={18} />
            还没有发布 Receipt。失败不会改变本地 Agent Version。
          </div>
        )}
      </section>
    </div>
  )
}
