import { ArrowClockwise, CheckCircle, Key, Trash, WarningCircle } from '@phosphor-icons/react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { SecretReferenceStatus } from '../../../shared/secret-reference'

export function SecretReferencesPanel({ agentId }: { agentId: string }) {
  const [references, setReferences] = useState<SecretReferenceStatus[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [feedback, setFeedback] = useState<string>()
  const [label, setLabel] = useState('')
  const [account, setAccount] = useState('')
  const [pendingDelete, setPendingDelete] = useState<string>()

  const load = useCallback(async () => {
    setLoadState('loading')
    setError(undefined)
    try {
      setReferences(await window.studio.secrets.list(agentId))
      setLoadState('ready')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法检查钥匙串状态。')
      setLoadState('error')
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  async function configure(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    setFeedback(undefined)
    try {
      const result = await window.studio.secrets.configure({
        agentId,
        label,
        keychainAccount: account,
      })
      if (result.status === 'cancelled') {
        setFeedback('已取消，未写入钥匙串。')
        return
      }
      setLabel('')
      setAccount('')
      setFeedback(`“${result.reference.label}”已写入 macOS 钥匙串。`)
      setReferences(await window.studio.secrets.list(agentId))
    } catch (configureError) {
      setError(configureError instanceof Error ? configureError.message : '无法写入钥匙串。')
    } finally {
      setBusy(false)
    }
  }

  async function remove(reference: SecretReferenceStatus): Promise<void> {
    setBusy(true)
    setError(undefined)
    setFeedback(undefined)
    try {
      await window.studio.secrets.delete({ referenceId: reference.id })
      setReferences((current) => current.filter(({ id }) => id !== reference.id))
      setPendingDelete(undefined)
      setFeedback(`“${reference.label}”的引用和本机钥匙串条目已移除。`)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '无法删除钥匙串条目。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="secret-references-title" className="secret-reference-section">
      <header>
        <div>
          <h2 id="secret-references-title">密钥引用</h2>
          <p>原文只写入当前 Mac 的登录钥匙串，Renderer、SQLite、备份和版本都不会收到原文。</p>
        </div>
        {loadState === 'ready' ? (
          <button
            aria-label="重新检查钥匙串状态"
            className="icon-button"
            disabled={busy}
            onClick={() => void load()}
            type="button"
          >
            <ArrowClockwise aria-hidden="true" size={17} />
          </button>
        ) : null}
      </header>

      {loadState === 'loading' ? (
        <div aria-busy="true" aria-label="正在检查钥匙串" className="secret-reference-loading">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : null}

      {loadState === 'error' ? (
        <div className="secret-reference-message secret-reference-message--error" role="alert">
          <WarningCircle aria-hidden="true" size={18} />
          <span>{error}</span>
          <button className="button button--secondary" onClick={() => void load()} type="button">
            重试
          </button>
        </div>
      ) : null}

      {loadState === 'ready' ? (
        <>
          {references.length > 0 ? (
            <ul className="secret-reference-list">
              {references.map((reference) => (
                <li key={reference.id}>
                  <span className="secret-reference-list__icon">
                    <Key aria-hidden="true" size={18} />
                  </span>
                  <span className="secret-reference-list__body">
                    <strong>{reference.label}</strong>
                    <code>{reference.keychainAccount}</code>
                    <small>{reference.keychainService}</small>
                  </span>
                  <span
                    className={
                      reference.configured
                        ? 'secret-reference-status secret-reference-status--ready'
                        : 'secret-reference-status secret-reference-status--missing'
                    }
                  >
                    {reference.configured ? (
                      <CheckCircle aria-hidden="true" size={16} weight="fill" />
                    ) : (
                      <WarningCircle aria-hidden="true" size={16} weight="fill" />
                    )}
                    {reference.configured ? '已配置' : '本机缺失'}
                  </span>
                  {pendingDelete === reference.id ? (
                    <span className="secret-reference-list__confirm">
                      <button
                        className="button button--danger"
                        disabled={busy}
                        onClick={() => void remove(reference)}
                        type="button"
                      >
                        确认移除
                      </button>
                      <button
                        className="button button--secondary"
                        disabled={busy}
                        onClick={() => setPendingDelete(undefined)}
                        type="button"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      aria-label={`移除 ${reference.label}`}
                      className="icon-button icon-button--danger"
                      disabled={busy}
                      onClick={() => setPendingDelete(reference.id)}
                      type="button"
                    >
                      <Trash aria-hidden="true" size={17} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="secret-reference-empty">
              <Key aria-hidden="true" size={19} />
              <span>
                <strong>尚未配置密钥</strong>
                <small>添加后，Studio 只保留服务与账户引用。</small>
              </span>
            </div>
          )}

          <form className="secret-reference-form" onSubmit={(event) => void configure(event)}>
            <div className="field">
              <label htmlFor="secret-label">用途名称</label>
              <input
                id="secret-label"
                maxLength={80}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="例如 OpenAI API"
                required
                value={label}
              />
            </div>
            <div className="field">
              <label htmlFor="secret-account">账户标识</label>
              <input
                id="secret-account"
                maxLength={200}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="例如 openai-api"
                required
                value={account}
              />
            </div>
            <div className="secret-reference-form__actions">
              <button className="button button--primary" disabled={busy} type="submit">
                {busy ? '等待系统输入…' : '打开安全输入并写入'}
              </button>
              <button
                className="button button--secondary"
                disabled={busy || (!label && !account)}
                onClick={() => {
                  setLabel('')
                  setAccount('')
                }}
                type="button"
              >
                清空
              </button>
            </div>
            <p className="secret-reference-form__hint">
              密钥在 macOS 原生隐藏输入框中填写，不进入 Renderer。使用相同账户标识会替换现有值。
            </p>
          </form>
        </>
      ) : null}

      {error && loadState === 'ready' ? (
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
    </section>
  )
}
