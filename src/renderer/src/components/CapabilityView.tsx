import { ArrowClockwise, CheckCircle, Stack, WarningCircle } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StackState } from '../../../shared/runtime-plan'
import { capabilityLabel, stackStatusLabels, validationLabels } from '../copy'
import { RemediationTaskList } from './RemediationTaskList'

interface CapabilityViewProps {
  agentId: string
  onOpenStack: () => void
}

export function CapabilityView({ agentId, onOpenStack }: CapabilityViewProps) {
  const [stack, setStack] = useState<StackState>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    try {
      const nextStack = await window.studio.components.getStack(agentId)
      setStack(nextStack)
      setStatus('ready')
      setError(undefined)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取能力映射。')
      setStatus('error')
    }
  }, [agentId])

  useEffect(() => {
    let active = true
    void window.studio.components.getStack(agentId).then(
      (nextStack) => {
        if (!active) return
        setStack(nextStack)
        setStatus('ready')
        setError(undefined)
      },
      (loadError: unknown) => {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : '无法读取能力映射。')
        setStatus('error')
      },
    )
    return () => {
      active = false
    }
  }, [agentId])

  function retry(): void {
    setStatus('loading')
    setError(undefined)
    void load()
  }

  const capabilities = useMemo(() => {
    if (!stack) return []
    const providers = new Map<
      string,
      Array<{
        componentId: string
        componentName: string
        implementation: string
        validation: (typeof stack.components)[number]['descriptor']['compatibility']['validation']
      }>
    >()
    for (const component of stack.components) {
      for (const provided of component.descriptor.provides) {
        providers.set(provided.capability, [
          ...(providers.get(provided.capability) ?? []),
          {
            componentId: component.id,
            componentName: component.descriptor.name,
            implementation: provided.implementation,
            validation: component.descriptor.compatibility.validation,
          },
        ])
      }
    }
    const explicitOwners = new Map(
      stack.owners.map(({ capability, componentId }) => [capability, componentId]),
    )
    return [...providers.entries()]
      .map(([capability, candidates]) => {
        const ownerId =
          explicitOwners.get(capability) ??
          (candidates.length === 1 ? candidates[0]?.componentId : undefined)
        return {
          capability,
          candidates,
          owner: candidates.find(({ componentId }) => componentId === ownerId),
        }
      })
      .sort((left, right) => left.capability.localeCompare(right.capability))
  }, [stack])

  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-label="正在读取能力映射" className="capability-loading">
        <div className="skeleton skeleton--title" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="state-panel state-panel--error" role="alert">
        <WarningCircle aria-hidden="true" size={24} />
        <h2>无法读取能力映射</h2>
        <p>{error}</p>
        <button className="button button--secondary" onClick={retry} type="button">
          <ArrowClockwise aria-hidden="true" size={16} /> 重试
        </button>
      </div>
    )
  }

  if (!stack || capabilities.length === 0) {
    return (
      <div className="inline-empty inline-empty--large">
        <Stack aria-hidden="true" size={28} />
        <h2>尚无能力映射</h2>
        <p>先把组件加入 Stack，Studio 才能展示能力来源、Owner 和验证证据。</p>
        <button className="button button--primary" onClick={onOpenStack} type="button">
          打开 Stack
        </button>
      </div>
    )
  }

  return (
    <div className="capability-view">
      <header>
        <div>
          <span className="eyebrow">当前草稿修订 {stack.revision}</span>
          <h2>能力与实现来源</h2>
          <p>这里解释 Agent 能做什么，以及每项能力当前由哪个组件负责。</p>
        </div>
        <span className={`plan-pill plan-pill--${stack.compilation.status}`}>
          {stack.compilation.status === 'ready' ? (
            <CheckCircle aria-hidden="true" size={16} weight="fill" />
          ) : (
            <WarningCircle aria-hidden="true" size={16} weight="fill" />
          )}
          Runtime Plan {stackStatusLabels[stack.compilation.status]}
        </span>
      </header>

      <ul aria-label={`${capabilities.length} 项能力`} className="capability-map-list">
        {capabilities.map(({ capability, candidates, owner }) => (
          <li key={capability}>
            <div className="capability-map-list__identity">
              <strong>{capabilityLabel(capability)}</strong>
              <code>{capability}</code>
            </div>
            <div className="capability-map-list__owner">
              <span>当前 Owner</span>
              <strong>{owner?.componentName ?? '需要明确选择'}</strong>
              <small>
                {owner
                  ? `${owner.implementation} · ${validationLabels[owner.validation]}`
                  : `${candidates.length} 个 Provider 存在重叠`}
              </small>
            </div>
            <details>
              <summary>{candidates.length} 个 Provider</summary>
              <ul>
                {candidates.map((candidate) => (
                  <li key={candidate.componentId}>
                    <strong>{candidate.componentName}</strong>
                    <code>{candidate.implementation}</code>
                    <span>{validationLabels[candidate.validation]}</span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>

      {stack.compilation.status === 'blocked' ? (
        <>
          <section className="capability-issues" aria-label="能力阻断项">
            <h3>需要处理</h3>
            <ul>
              {stack.compilation.issues.map((issue, index) => (
                <li key={`${issue.code}-${issue.capability ?? index}`}>
                  <WarningCircle aria-hidden="true" size={16} />
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
            <button className="button button--secondary" onClick={onOpenStack} type="button">
              前往 Stack 处理
            </button>
          </section>
          <RemediationTaskList tasks={stack.compilation.remediationTasks} />
        </>
      ) : null}
    </div>
  )
}
