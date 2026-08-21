import { useRef, useState, type FormEvent } from 'react'
import type { CreateAgentInput, ExecutionMode } from '../../../shared/agent'
import { executionModeLabels } from '../copy'
import { useDialogFocus } from '../useDialogFocus'

interface CreateAgentDialogProps {
  isSaving: boolean
  error?: string
  onCancel: () => void
  onSubmit: (input: CreateAgentInput) => Promise<void>
}

const modeOptions: Array<{ value: ExecutionMode; label: string; detail: string }> = [
  {
    value: 'agent-loop',
    label: executionModeLabels['agent-loop'],
    detail: '由循环控制模型与工具。',
  },
  {
    value: 'workflow',
    label: executionModeLabels.workflow,
    detail: '由结构化流程控制执行。',
  },
  {
    value: 'hybrid',
    label: executionModeLabels.hybrid,
    detail: '工作流与 Agent 循环共同控制执行。',
  },
  {
    value: 'external-harness',
    label: executionModeLabels['external-harness'],
    detail: '由现有项目控制执行。',
  },
]

export function CreateAgentDialog({ isSaving, error, onCancel, onSubmit }: CreateAgentDialogProps) {
  const nameInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('agent-loop')
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
    await onSubmit({ name, description, executionMode })
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
          <fieldset className="field">
            <legend>执行模式</legend>
            <div className="mode-options">
              {modeOptions.map((option) => (
                <label className="mode-option" key={option.value}>
                  <input
                    checked={executionMode === option.value}
                    name="execution-mode"
                    onChange={() => setExecutionMode(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
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
