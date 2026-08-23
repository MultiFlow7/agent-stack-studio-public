import { useRef, useState, type FormEvent } from 'react'
import type { CreateAgentInput } from '../../../shared/agent'
import { useDialogFocus } from '../useDialogFocus'

interface CreateAgentDialogProps {
  isSaving: boolean
  error?: string
  onCancel: () => void
  onSubmit: (input: CreateAgentInput) => Promise<void>
}

export function CreateAgentDialog({ isSaving, error, onCancel, onSubmit }: CreateAgentDialogProps) {
  const nameInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fieldError, setFieldError] = useState<string>()
  const { dialogRef, trapTabKey } = useDialogFocus<HTMLElement>()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      setFieldError('请输入 Agent 名称。')
      nameInput.current?.focus()
      return
    }
    setFieldError(undefined)
    await onSubmit({ name, description, executionMode: 'external-harness' })
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby="create-agent-description"
        aria-labelledby="create-agent-title"
        aria-modal="true"
        className="modal"
        ref={dialogRef}
        role="dialog"
        onKeyDown={(event) => {
          trapTabKey(event)
          if (event.key === 'Escape' && !isSaving) onCancel()
        }}
      >
        <header className="modal__header">
          <h2 id="create-agent-title">创建 Agent</h2>
          <p id="create-agent-description">从本地草稿开始。只有主动发布后，内容才会被共享。</p>
        </header>
        {error ? (
          <div className="error-summary" role="alert">
            <strong>Agent 创建失败</strong>
            <span>{error}</span>
          </div>
        ) : null}
        <form onSubmit={(event) => void submit(event)}>
          <div className="field">
            <label htmlFor="agent-name">名称</label>
            <input
              aria-describedby={fieldError ? 'agent-name-error' : undefined}
              aria-invalid={Boolean(fieldError)}
              autoFocus
              id="agent-name"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              ref={nameInput}
              value={name}
            />
            {fieldError ? (
              <span className="field__error" id="agent-name-error">
                {fieldError}
              </span>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="agent-description">描述</label>
            <textarea
              id="agent-description"
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              value={description}
            />
            <span className="field__help">选填。说明这个 Agent 的用途。</span>
          </div>
          <div className="legacy-boundary-note">
            <strong>Native Harness Agent</strong>
            <span>创建后选择 Pi、OpenClaw 或 Codex，再组合 Prompt、Skill、Memory 与 MCP。</span>
            <small>新 Agent 不再生成旧 Agent Loop、Workflow 或 Hybrid 模式。</small>
          </div>
          <footer className="modal__footer">
            <button
              className="button button--secondary"
              disabled={isSaving}
              onClick={onCancel}
              type="button"
            >
              取消
            </button>
            <button className="button button--primary" disabled={isSaving} type="submit">
              {isSaving ? '正在创建 Agent…' : '创建 Agent'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}
