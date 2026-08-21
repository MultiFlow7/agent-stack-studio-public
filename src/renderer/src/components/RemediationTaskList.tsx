import { CheckCircle, ShieldCheck, WarningCircle } from '@phosphor-icons/react'
import type { CompatibilityRemediationTask } from '../../../shared/remediation'

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
  if (tasks.length === 0) return null

  const requiredCount = tasks.filter(({ status }) => status === 'required').length
  return (
    <section aria-label="兼容性处置任务" className="remediation-tasks">
      <header>
        <div>
          <span className="eyebrow">结构化处置链</span>
          <h3>Adapter / Fork 处置任务</h3>
          <p>
            {requiredCount} 项待完成。任务来自 Descriptor；Studio
            不会自动生成、加载或执行第三方代码。
          </p>
        </div>
        <ShieldCheck aria-hidden="true" size={22} />
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
