import {
  ArrowClockwise,
  CheckCircle,
  Cube,
  Plus,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CapabilityId, ComponentRecord } from '../../../shared/component'
import type { StackState } from '../../../shared/runtime-plan'
import { capabilityLabel, compatibilityLabels, stackStatusLabels, validationLabels } from '../copy'

interface StackEditorViewProps {
  agentId: string
  onChanged: () => Promise<void>
}

export function StackEditorView({ agentId, onChanged }: StackEditorViewProps) {
  const [catalog, setCatalog] = useState<ComponentRecord[]>([])
  const [stack, setStack] = useState<StackState>()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string>()
  const [isChoosing, setChoosing] = useState(false)
  const [pendingKey, setPendingKey] = useState<string>()
  const firstConflict = useRef<HTMLFieldSetElement>(null)
  const pickerHeading = useRef<HTMLHeadingElement>(null)
  const firstPickerAction = useRef<HTMLButtonElement>(null)
  const changeInFlight = useRef(false)
  const loadRequest = useRef(0)

  const load = useCallback(async () => {
    const request = ++loadRequest.current
    setStatus('loading')
    setError(undefined)
    try {
      const [nextCatalog, nextStack] = await Promise.all([
        window.studio.components.list(),
        window.studio.components.getStack(agentId),
      ])
      if (request !== loadRequest.current) return
      setCatalog(nextCatalog.filter(({ archivedAt }) => !archivedAt))
      setStack(nextStack)
      setStatus('ready')
    } catch (loadError) {
      if (request !== loadRequest.current) return
      setError(loadError instanceof Error ? loadError.message : '无法载入 Harness 与组件。')
      setStatus('error')
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!window.studio.studioProject?.onExternalChanged) return undefined
    return window.studio.studioProject.onExternalChanged(() => void load())
  }, [load])

  const coverage = useMemo(() => {
    const result = new Map<CapabilityId, ComponentRecord[]>()
    for (const component of stack?.components ?? []) {
      for (const provider of component.descriptor.provides) {
        result.set(provider.capability, [...(result.get(provider.capability) ?? []), component])
      }
    }
    return [...result.entries()]
  }, [stack])

  const available = catalog.filter(
    (component) => !stack?.components.some((current) => current.id === component.id),
  )

  useEffect(() => {
    if (!window.location.hash.endsWith(':conflicts') || status !== 'ready') return
    const frame = requestAnimationFrame(() => {
      const conflict = firstConflict.current
      const container = conflict?.closest<HTMLElement>('.content')
      if (!conflict || !container) return
      const conflictBounds = conflict.getBoundingClientRect()
      const containerBounds = container.getBoundingClientRect()
      container.scrollTop += conflictBounds.top - containerBounds.top - 24
    })
    return () => cancelAnimationFrame(frame)
  }, [stack, status])

  useEffect(() => {
    if (!isChoosing || status !== 'ready') return
    const frame = requestAnimationFrame(() => {
      const target = firstPickerAction.current ?? pickerHeading.current
      target?.scrollIntoView?.({ block: 'nearest' })
      target?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [available.length, isChoosing, status])

  async function runChange(key: string, change: () => Promise<StackState>): Promise<void> {
    if (changeInFlight.current) return
    changeInFlight.current = true
    setPendingKey(key)
    setError(undefined)
    try {
      setStack(await change())
      await onChanged()
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : '无法更新 Harness 与组件。')
    } finally {
      changeInFlight.current = false
      setPendingKey(undefined)
    }
  }

  async function mutateProject(
    change: (expectedRevision: number) => Promise<unknown>,
  ): Promise<StackState> {
    const state = await window.studio.studioProject!.current()
    if (!state.project || state.localAgentId !== agentId) {
      throw new Error('请先切换到该 Agent 绑定的当前项目。')
    }
    await change(state.project.revision)
    return window.studio.components.getStack(agentId)
  }

  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-label="正在载入 Harness 与组件" className="stack-loading">
        <div className="skeleton skeleton--title" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    )
  }

  if (status === 'error' || !stack) {
    return (
      <div className="stack-error" role="alert">
        <WarningCircle aria-hidden="true" size={22} />
        <div>
          <h2>无法载入 Harness 与组件</h2>
          <p>{error}</p>
        </div>
        <button className="button button--secondary" onClick={() => void load()} type="button">
          <ArrowClockwise aria-hidden="true" size={16} />
          重试
        </button>
      </div>
    )
  }

  const openComponents = (): void => {
    window.dispatchEvent(new CustomEvent('studio:navigate-library', { detail: 'components' }))
  }

  const openDiscovery = (): void => {
    window.dispatchEvent(new CustomEvent('studio:navigate-library', { detail: 'discovery' }))
  }

  const picker = (
    <section
      aria-labelledby="component-picker-title"
      aria-live="polite"
      className="component-picker"
      id="component-picker"
    >
      <div>
        <h3 id="component-picker-title" ref={pickerHeading} tabIndex={-1}>
          从本地组件目录添加
        </h3>
        <p>添加只更新本地草稿，不会执行组件代码。</p>
      </div>
      {catalog.length === 0 ? (
        <div className="picker-empty-state">
          <p className="picker-empty">本地组件目录还是空的。先从组件库添加一个来源。</p>
          <div className="picker-empty-state__actions">
            <button
              className="button button--secondary"
              onClick={openComponents}
              ref={firstPickerAction}
              type="button"
            >
              前往组件库
            </button>
            <button className="button button--quiet" onClick={openDiscovery} type="button">
              添加来源
            </button>
          </div>
        </div>
      ) : available.length > 0 ? (
        <ul>
          {available.map((component, index) => (
            <li key={component.id}>
              <span>
                <strong>{component.descriptor.name}</strong>
                <small>
                  {component.descriptor.provides.length} 项能力 ·{' '}
                  {validationLabels[component.descriptor.compatibility.validation]}
                </small>
              </span>
              <button
                className="button button--secondary"
                disabled={Boolean(pendingKey)}
                onClick={() =>
                  void runChange(`add-${component.id}`, () =>
                    mutateProject((expectedRevision) =>
                      window.studio.studioProject!.addToStack({
                        expectedRevision,
                        componentId: component.id,
                      }),
                    ),
                  )
                }
                ref={index === 0 ? firstPickerAction : undefined}
                type="button"
              >
                {pendingKey === `add-${component.id}`
                  ? '正在添加…'
                  : `添加 ${component.descriptor.name}`}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="picker-empty-state">
          <p className="picker-empty">当前目录中的组件都已加入这个 Agent。</p>
          <button
            className="button button--secondary"
            onClick={openComponents}
            ref={firstPickerAction}
            type="button"
          >
            查看组件库
          </button>
        </div>
      )}
    </section>
  )

  return (
    <div className="stack-editor">
      <header className="stack-editor__header">
        <div>
          <h2 id="stack-editor-heading" tabIndex={-1}>
            Harness 与组件
          </h2>
          <p>修订 {stack.revision}。先确认每项能力由哪个组件负责，再检查运行计划。</p>
        </div>
        <button
          aria-controls="component-picker"
          aria-expanded={isChoosing}
          className="button button--secondary"
          disabled={Boolean(pendingKey)}
          onClick={() => setChoosing((value) => !value)}
          type="button"
        >
          <Plus aria-hidden="true" size={17} />
          {isChoosing ? '取消选择' : '添加组件'}
        </button>
      </header>

      {error ? (
        <div className="detail-feedback detail-feedback--error stack-change-error" role="alert">
          <span>{error}</span>
          <button className="button button--secondary" onClick={() => void load()} type="button">
            <ArrowClockwise aria-hidden="true" size={16} />
            重新读取
          </button>
        </div>
      ) : null}

      {isChoosing && stack.components.length > 0 ? picker : null}

      {stack.components.length === 0 ? (
        isChoosing ? (
          picker
        ) : (
          <section className="stack-empty">
            <Cube aria-hidden="true" size={28} weight="duotone" />
            <h3>先添加一个组件</h3>
            <p>运行计划只会使用已验证组件和明确的负责实现。</p>
            <button
              aria-controls="component-picker"
              aria-expanded={false}
              className="button button--primary"
              onClick={() => setChoosing(true)}
              type="button"
            >
              <Plus aria-hidden="true" size={17} />
              添加第一个组件
            </button>
          </section>
        )
      ) : (
        <>
          <section className="stack-section" aria-labelledby="stack-components-title">
            <div className="section-heading">
              <h3 id="stack-components-title">已添加的组件</h3>
              <span>{stack.components.length} 个</span>
            </div>
            <ul className="stack-components">
              {stack.components.map((component) => (
                <li key={component.id}>
                  <span className="component-symbol" aria-hidden="true">
                    {component.descriptor.name.slice(0, 1)}
                  </span>
                  <span className="component-main">
                    <strong>{component.descriptor.name}</strong>
                    <small>
                      {component.descriptor.id} · {component.descriptor.version}
                    </small>
                  </span>
                  <span className="component-compatibility">
                    {compatibilityLabels[component.descriptor.compatibility.level]}
                    <small>{validationLabels[component.descriptor.compatibility.validation]}</small>
                    {component.descriptor.compatibility.level === 'unknown' ? (
                      <small>不是等待点击确认；缺少替换边界、契约测试或受信运行证据。</small>
                    ) : null}
                  </span>
                  <button
                    aria-label={`从 Agent 移除 ${component.descriptor.name}`}
                    className="icon-button"
                    disabled={Boolean(pendingKey)}
                    onClick={() =>
                      void runChange(`remove-${component.id}`, () =>
                        mutateProject((expectedRevision) =>
                          window.studio.studioProject!.removeFromStack({
                            expectedRevision,
                            componentId: component.id,
                          }),
                        ),
                      )
                    }
                    title={`从 Agent 移除 ${component.descriptor.name}`}
                    type="button"
                  >
                    <Trash aria-hidden="true" size={17} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="stack-section" aria-labelledby="coverage-title">
            <div className="section-heading">
              <h3 id="coverage-title">能力覆盖与负责实现</h3>
              <span>{coverage.length} 项能力</span>
            </div>
            <div className="coverage-list">
              {coverage.map(([capability, providers]) => {
                const selectedId = stack.owners.find(
                  (owner) => owner.capability === capability,
                )?.componentId
                const overlap = providers.length > 1
                return (
                  <fieldset
                    className={overlap ? 'coverage-row coverage-row--conflict' : 'coverage-row'}
                    key={capability}
                    ref={
                      overlap && !selectedId
                        ? (element) => {
                            if (element && !firstConflict.current) firstConflict.current = element
                          }
                        : undefined
                    }
                  >
                    <legend>
                      <span>{capabilityLabel(capability)}</span>
                      <code>{capability}</code>
                    </legend>
                    <div className="owner-options">
                      {providers.map((component) => (
                        <label key={component.id}>
                          <input
                            checked={overlap ? selectedId === component.id : true}
                            disabled={!overlap || Boolean(pendingKey)}
                            name={`owner-${capability}`}
                            onChange={() =>
                              void runChange(`owner-${capability}`, () =>
                                mutateProject((expectedRevision) =>
                                  window.studio.studioProject!.setOwner({
                                    expectedRevision,
                                    capability,
                                    componentId: component.id,
                                  }),
                                ),
                              )
                            }
                            type="radio"
                          />
                          <span>
                            <strong>{component.descriptor.name}</strong>
                            <small>{overlap ? '候选实现' : '唯一实现，自动负责'}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                    {overlap && !selectedId ? (
                      <p>
                        <WarningCircle aria-hidden="true" size={16} />
                        能力重叠，请选择一个负责实现。
                      </p>
                    ) : null}
                  </fieldset>
                )
              })}
            </div>
          </section>
        </>
      )}

      <section
        className={`plan-status plan-status--${stack.compilation.status}`}
        aria-live="polite"
      >
        <header>
          {stack.compilation.status === 'ready' ? (
            <CheckCircle aria-hidden="true" size={22} weight="fill" />
          ) : (
            <WarningCircle aria-hidden="true" size={22} weight="fill" />
          )}
          <div>
            <h3>Stack/兼容性 {stackStatusLabels[stack.compilation.status]}</h3>
            <p>
              {stack.compilation.status === 'ready'
                ? 'Stack 的负责实现、依赖和兼容性检查已通过；模型认证仍单独检查。'
                : '解决以下 Stack 问题后才能继续配置模型。'}
            </p>
          </div>
        </header>
        {stack.compilation.status === 'blocked' ? (
          <ul>
            {stack.compilation.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <strong>{issue.code}</strong>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="plan-preview">
            <span>{stack.compilation.plan.services.length} 个 Cordis Service</span>
            <code title={stack.compilation.plan.contentHash}>
              {stack.compilation.plan.contentHash.slice(0, 14)}
            </code>
            <small>Plan 仅包含稳定 Studio Contract，Cordis 类型不会进入领域层或 UI。</small>
          </div>
        )}
      </section>
    </div>
  )
}
