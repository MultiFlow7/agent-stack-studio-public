import { ArrowClockwise, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudioProjectState } from '../../../shared/studio-project'
import { compatibilityAssessmentLabels } from '../copy'
import { RemediationTaskList } from './RemediationTaskList'
import { StackEditorView } from './StackEditorView'
import { WorkflowSection } from './WorkflowSection'

interface AgentCompositionViewProps {
  agentId: string
  onChanged: () => Promise<void>
}

export function AgentCompositionView({ agentId, onChanged }: AgentCompositionViewProps) {
  const [state, setState] = useState<StudioProjectState>()
  const [error, setError] = useState<string>()
  const [feedback, setFeedback] = useState<string>()
  const [pending, setPending] = useState<string>()
  const requestId = useRef(0)

  const load = useCallback(async (preserveError = false) => {
    const request = ++requestId.current
    try {
      const next = await window.studio.studioProject!.current()
      if (request !== requestId.current) return
      setState(next)
      if (!preserveError) setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取 Agent Stack。')
    }
  }, [])

  useEffect(() => {
    void load()
    return window.studio.studioProject!.onExternalChanged(() => void load(true))
  }, [load])

  async function run(
    key: string,
    action: () => Promise<StudioProjectState>,
    success: string,
  ): Promise<void> {
    setPending(key)
    setError(undefined)
    setFeedback(undefined)
    try {
      setState(await action())
      setFeedback(success)
      await onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法更新 Agent Stack。')
    } finally {
      setPending(undefined)
    }
  }

  if (!state) {
    return (
      <div className="loading-state" aria-busy="true">
        正在读取 Agent Stack…
      </div>
    )
  }
  if (!state.project || state.localAgentId !== agentId) {
    return (
      <div className="stack-error" role="alert">
        <WarningCircle aria-hidden="true" size={22} />
        <div>
          <h2>请切换到该 Agent 绑定的项目</h2>
          <p>当前 Agent 的可移植事实只从 .agent-stack 读取。</p>
        </div>
      </div>
    )
  }
  const { project, validation } = state
  return (
    <div className="agent-composition">
      {error ? (
        <div className="detail-feedback detail-feedback--error" role="alert">
          {error}
          <button className="button button--secondary" onClick={() => void load()} type="button">
            <ArrowClockwise size={16} />
            重试
          </button>
        </div>
      ) : null}
      {feedback ? (
        <div className="detail-feedback" role="status">
          <CheckCircle size={18} weight="fill" />
          {feedback}
        </div>
      ) : null}
      <StackEditorView
        agentId={agentId}
        onChanged={async () => {
          await load()
          await onChanged()
        }}
      />
      <section
        className={`project-validation project-validation--${validation?.status ?? 'blocked'}`}
        aria-live="polite"
      >
        <header>
          {validation?.status === 'ready' ? (
            <CheckCircle size={22} weight="fill" />
          ) : (
            <WarningCircle size={22} weight="fill" />
          )}
          <div>
            <h2>兼容性与冲突检查{validation?.status === 'ready' ? '通过' : '已阻断'}</h2>
            <p>
              {validation?.status === 'ready'
                ? '可以冻结 Agent Version。'
                : '按证据与建议动作处理后再冻结。'}
            </p>
          </div>
        </header>
        {validation?.assessments?.length ? (
          <ul>
            {validation.assessments.map((assessment) => (
              <li key={assessment.componentId}>
                <strong>{compatibilityAssessmentLabels[assessment.status]}</strong>
                <span>{assessment.blockers[0] ?? assessment.evidence[0]?.detail}</span>
                <small>{assessment.suggestedActions[0]}</small>
              </li>
            ))}
          </ul>
        ) : null}
        {validation?.issues.length ? (
          <ul>
            {validation.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <strong>{issue.code}</strong>
                <span>{issue.message}</span>
                <small>{issue.suggestedActions[0]}</small>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <RemediationTaskList tasks={validation?.remediationTasks ?? []} />
      <WorkflowSection pending={pending} project={project} run={run} />
    </div>
  )
}
