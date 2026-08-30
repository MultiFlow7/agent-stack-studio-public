import { Check, CheckCircle, Copy, WarningCircle } from '@phosphor-icons/react'
import { useId, useMemo, useState } from 'react'
import {
  buildCodingAgentRemediationPrompt,
  type CompatibilityRemediationTask,
} from '../../../shared/remediation'

interface RemediationTaskListProps {
  tasks: CompatibilityRemediationTask[]
}

const kindLabels: Record<CompatibilityRemediationTask['kind'], string> = {
  'adapter-work': 'Adapter',
  'fork-work': 'Fork',
  'contract-test': '契约测试',
  'runtime-validation': '运行验证',
}

export function RemediationTaskList({ tasks }: RemediationTaskListProps) {
  const feedbackId = useId()
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const codingAgentPrompt = useMemo(
    () => (tasks.length > 0 ? buildCodingAgentRemediationPrompt(tasks) : ''),
    [tasks],
  )

  if (tasks.length === 0) return null

  const requiredCount = tasks.filter(({ status }) => status === 'required').length

  async function copyForCodingAgent(): Promise<void> {
    setCopyStatus('copying')
    try {
      await window.studio.discovery.copy(codingAgentPrompt)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('error')
    }
  }

  return (
    <section aria-label="兼容性处置任务" className="remediation-tasks">
      <header>
        <div className="remediation-tasks__intro">
          <span className="eyebrow">结构化处置链</span>
          <h3>Adapter / Fork 处置任务</h3>
          <p>
            {requiredCount} 项待完成。复制完整任务交给 Coding Agent；Studio
            不会自动生成、加载或执行第三方代码。
          </p>
        </div>
        <div className="remediation-tasks__actions">
          <button
            aria-describedby={copyStatus === 'idle' ? undefined : feedbackId}
            className="button button--primary remediation-tasks__copy"
            disabled={copyStatus === 'copying'}
            onClick={() => void copyForCodingAgent()}
            type="button"
          >
            {copyStatus === 'copied' ? (
              <Check aria-hidden="true" size={15} weight="bold" />
            ) : (
              <Copy aria-hidden="true" size={15} />
            )}
            {copyStatus === 'copying'
              ? '正在复制…'
              : copyStatus === 'copied'
                ? '提示词已复制'
                : '复制给 Coding Agent'}
          </button>
          <span
            className={`remediation-tasks__feedback remediation-tasks__feedback--${copyStatus}`}
            id={feedbackId}
            role={copyStatus === 'error' ? 'alert' : 'status'}
          >
            {copyStatus === 'copied'
              ? '可直接粘贴到 Coding Agent'
              : copyStatus === 'error'
                ? '复制失败，请重试'
                : ''}
          </span>
        </div>
      </header>
      <ol>
        {tasks.map((task) => (
          <li className={`remediation-task remediation-task--${task.status}`} key={task.id}>
            <div className="remediation-task__status">
              {task.status === 'complete' ? (
                <CheckCircle aria-hidden="true" size={17} weight="fill" />
              ) : (
                <WarningCircle aria-hidden="true" size={17} weight="fill" />
              )}
              <span>{task.status === 'complete' ? '已有证据' : '待完成'}</span>
            </div>
            <div className="remediation-task__body">
              <span>{kindLabels[task.kind]}</span>
              <strong>
                {task.componentName} · {task.title}
              </strong>
              <p>{task.description}</p>
              <details>
                <summary>验收条件</summary>
                <ul>
                  {task.acceptanceCriteria.map((criterion) => (
                    <li key={criterion}>{criterion}</li>
                  ))}
                </ul>
              </details>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
