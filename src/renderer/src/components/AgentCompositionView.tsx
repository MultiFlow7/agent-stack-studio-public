import { ArrowClockwise, CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { StudioProjectState } from '../../../shared/studio-project'
import { compatibilityAssessmentLabels } from '../copy'
import type { CompatibilityAction } from '../../../shared/compatibility-assessment'
import { RemediationTaskList } from './RemediationTaskList'
import { StackEditorView } from './StackEditorView'
import { WorkflowSection } from './WorkflowSection'

interface AgentCompositionViewProps {
  agentId: string
  onChanged: () => Promise<void>
}

const validationIssueLabels: Record<string, string> = {
  EMPTY_STACK: 'Stack 为空',
  COMPONENT_MISSING: '组件引用缺失',
  COMPONENT_ARCHIVED: '组件已归档',
  OWNER_REQUIRED: '需要选择 Owner',
  OWNER_INVALID: 'Owner 无效',
  UNSATISFIED_REQUIREMENT: '依赖未满足',
  COMPONENT_BLOCKED: '组件不兼容',
  COMPATIBILITY_UNKNOWN: '机器证据不足',
  ADAPTER_UNVERIFIED: 'Adapter 尚未验证',
  UNCONTROLLED_SIDE_EFFECT: '存在未受控激活',
  SOURCE_DIRTY: '来源存在未提交更改',
  SOURCE_UNAVAILABLE: '来源不可用',
}

export function AgentCompositionView({ agentId, onChanged }: AgentCompositionViewProps) {
  const [state, setState] = useState<StudioProjectState>()
  const [error, setError] = useState<string>()
  const [feedback, setFeedback] = useState<string>()
  const [pending, setPending] = useState<string>()
  const requestId = useRef(0)
  const actionNotice = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!error && !feedback) return
    const frame = window.requestAnimationFrame(() => actionNotice.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [error, feedback])

  async function run(
    key: string,
    action: () => Promise<StudioProjectState>,
    success: string,
    unchanged?: string,
  ): Promise<void> {
    setPending(key)
    setError(undefined)
    setFeedback(undefined)
    try {
      const previousRevision = state?.project?.revision
      const next = await action()
      setState(next)
      const didNotWrite = unchanged !== undefined && next.project?.revision === previousRevision
      setFeedback(didNotWrite ? unchanged : success)
      if (!didNotWrite) await onChanged()
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
  const handleCompatibilityAction = async (
    componentId: string,
    action: CompatibilityAction,
  ): Promise<void> => {
    if (
      action.action === 'edit-contract' ||
      action.action === 'declare-configuration' ||
      action.action === 'select-strategy'
    ) {
      window.dispatchEvent(
        new CustomEvent('studio:navigate-component', { detail: { componentId } }),
      )
      return
    }
    if (action.presentation === 'external-step') return
    await run(
      `${componentId}:${action.action}`,
      () => {
        const input = { componentId, expectedRevision: project.revision }
        if (action.action === 'recheck-static') {
          return window.studio.studioProject!.recheckComponent(input)
        }
        if (action.action === 'run-contract-test') {
          return window.studio.studioProject!.runComponentContractTest(input)
        }
        if (action.action === 'run-trusted-validation') {
          return window.studio.studioProject!.runComponentRuntimeValidation({
            ...input,
            timeoutMs: 5_000,
          })
        }
        return window.studio.studioProject!.current()
      },
      `${action.label}已完成。`,
      action.action === 'recheck-static' ? '已取消重新关联，项目与兼容证据均未改动。' : undefined,
    )
  }
  const openIssueResolution = (componentId: string | null): void => {
    if (componentId) {
      window.dispatchEvent(
        new CustomEvent('studio:navigate-component', { detail: { componentId } }),
      )
      return
    }
    document.getElementById('stack-editor-heading')?.focus()
  }
  return (
    <div className="agent-composition">
      {error ? (
        <div
          className="detail-feedback detail-feedback--error"
          ref={actionNotice}
          role="alert"
          tabIndex={-1}
        >
          {error}
          <button className="button button--secondary" onClick={() => void load()} type="button">
            <ArrowClockwise size={16} />
            重试
          </button>
        </div>
      ) : null}
      {feedback ? (
        <div className="detail-feedback" ref={actionNotice} role="status" tabIndex={-1}>
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
                <span>{assessment.explanation}</span>
                <div className="assessment-inline-actions">
                  {assessment.suggestedActions.map((action) => {
                    const actionKey = `${assessment.componentId}:${action.action}`
                    return action.presentation === 'external-step' ? (
                      <details key={action.id}>
                        <summary>{action.label}</summary>
                        <p>{action.externalStep}</p>
                      </details>
                    ) : (
                      <button
                        aria-busy={pending === actionKey}
                        className="button button--quiet"
                        disabled={Boolean(pending) || !action.enabled}
                        key={action.id}
                        onClick={() =>
                          void handleCompatibilityAction(assessment.componentId, action)
                        }
                        type="button"
                      >
                        {pending === actionKey ? `${action.label}中…` : action.label}
                      </button>
                    )
                  })}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {validation?.issues.length ? (
          <ul>
            {validation.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <strong>{validationIssueLabels[issue.code] ?? '需处理的组合问题'}</strong>
                <span>{issue.message}</span>
                <div className="assessment-inline-actions">
                  {issue.suggestedActions.map((suggestion) =>
                    issue.code === 'SOURCE_DIRTY' || issue.code === 'SOURCE_UNAVAILABLE' ? (
                      <details key={suggestion}>
                        <summary>查看外部处置步骤</summary>
                        <p>{suggestion}</p>
                      </details>
                    ) : (
                      <button
                        className="button button--quiet"
                        key={suggestion}
                        onClick={() => openIssueResolution(issue.componentId)}
                        type="button"
                      >
                        {issue.componentId ? '前往组件处置' : '在 Stack 编辑器处理'}
                      </button>
                    ),
                  )}
                </div>
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
