import {
  Archive,
  ArrowClockwise,
  CheckCircle,
  Cube,
  FileCode,
  FolderOpen,
  GitBranch,
  Plus,
  Package,
  Snowflake,
  ShieldCheck,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CapabilityId, ComponentDescriptor } from '../../../shared/component'
import type { StudioProjectState } from '../../../shared/studio-project'
import { capabilityLabel } from '../copy'
import { WorkflowSection } from './WorkflowSection'
import { RemediationTaskList } from './RemediationTaskList'

type LoadStatus = 'loading' | 'ready' | 'error'

export function StudioProjectView() {
  const [state, setState] = useState<StudioProjectState>()
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string>()
  const [feedback, setFeedback] = useState<string>()
  const [pending, setPending] = useState<string>()
  const [editingId, setEditingId] = useState<string>()
  const [descriptorText, setDescriptorText] = useState('')
  const [deleteId, setDeleteId] = useState<string>()

  const load = useCallback(async (external = false) => {
    setStatus('loading')
    setError(undefined)
    if (external) setFeedback(undefined)
    try {
      const next = await window.studio.studioProject!.current()
      setState(external ? { ...next, changedExternally: true } : next)
      setStatus('ready')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取 Studio 项目。')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void load()
    return window.studio.studioProject!.onExternalChanged(() => void load(true))
  }, [load])

  const stackComponents = useMemo(() => {
    if (!state?.project) return []
    const ids = new Set(state.project.stack.componentIds)
    return state.project.components.filter(({ id }) => ids.has(id))
  }, [state])

  const providers = useMemo(() => {
    const result = new Map<CapabilityId, typeof stackComponents>()
    for (const component of stackComponents) {
      for (const provider of component.descriptor.provides) {
        result.set(provider.capability, [...(result.get(provider.capability) ?? []), component])
      }
    }
    return [...result.entries()]
  }, [stackComponents])

  async function run(key: string, action: () => Promise<StudioProjectState>, success: string) {
    setPending(key)
    setError(undefined)
    setFeedback(undefined)
    try {
      setState(await action())
      setFeedback(success)
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '项目操作失败。')
    } finally {
      setPending(undefined)
    }
  }

  async function choose(mode: 'open' | 'init') {
    setPending(mode)
    setError(undefined)
    try {
      setState(
        mode === 'open'
          ? await window.studio.studioProject!.open()
          : await window.studio.studioProject!.init(),
      )
      setStatus('ready')
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '无法选择项目。')
    } finally {
      setPending(undefined)
    }
  }

  async function exportPackage() {
    setPending('export')
    setError(undefined)
    setFeedback(undefined)
    try {
      const result = await window.studio.studioProject!.export()
      if (result.status === 'cancelled') {
        setFeedback('已取消导出，项目未发生变化。')
      } else {
        setFeedback(
          `可移植包已导出：${result.path}（${result.workflowCount} 个 Workflow，SHA-256 ${result.packageHash.slice(0, 12)}…）`,
        )
      }
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : '无法导出 Agent Stack Package。',
      )
    } finally {
      setPending(undefined)
    }
  }

  function mutation(componentId: string) {
    if (!state?.project) throw new Error('项目尚未打开。')
    return { componentId, expectedRevision: state.project.revision }
  }

  async function saveDescriptor(componentId: string) {
    if (!state?.project) return
    let descriptor: ComponentDescriptor
    try {
      descriptor = JSON.parse(descriptorText) as ComponentDescriptor
    } catch {
      setError('Descriptor 不是有效的 JSON。')
      return
    }
    await run(
      `descriptor-${componentId}`,
      () =>
        window.studio.studioProject!.updateDescriptor({
          componentId,
          descriptor,
          expectedRevision: state.project?.revision ?? 0,
        }),
      'Descriptor 已记录为用户确认。',
    )
    setEditingId(undefined)
  }

  if (status === 'loading') {
    return (
      <section aria-busy="true" aria-label="正在载入 Studio 项目" className="loading-state">
        <div className="skeleton skeleton--title" />
        <div className="skeleton" />
        <div className="skeleton" />
      </section>
    )
  }

  if (status === 'error' && !state) {
    return (
      <section className="state-panel state-panel--error" role="alert">
        <WarningCircle aria-hidden="true" size={24} />
        <h2>无法载入 Studio 项目</h2>
        <p>{error}</p>
        <button className="button button--secondary" onClick={() => void load()} type="button">
          <ArrowClockwise aria-hidden="true" size={17} />
          重试
        </button>
      </section>
    )
  }

  if (!state?.project) {
    return (
      <div className="project-page">
        <header className="page-header">
          <div>
            <h1>Studio 项目</h1>
            <p>GUI 与任意可调用 Shell 的 Coding Agent 共同管理同一份项目文件。</p>
          </div>
        </header>
        <section className="empty-state project-empty">
          <FileCode aria-hidden="true" size={34} weight="duotone" />
          <h2>打开或创建 .agent-stack</h2>
          <p>
            项目文件保存可移植的组件、Stack、Owner 与不可变版本。Studio 不会执行导入仓库中的脚本。
          </p>
          <div className="empty-state__actions">
            <button
              className="button button--primary"
              disabled={Boolean(pending)}
              onClick={() => void choose('init')}
              type="button"
            >
              <Plus aria-hidden="true" size={17} />
              创建项目
            </button>
            <button
              className="button button--secondary"
              disabled={Boolean(pending)}
              onClick={() => void choose('open')}
              type="button"
            >
              <FolderOpen aria-hidden="true" size={17} />
              打开项目
            </button>
          </div>
          <p className="project-cli-path">
            <strong>CLI 路径</strong>
            <code>{state?.cliPath}</code>
          </p>
        </section>
      </div>
    )
  }

  const project = state.project
  return (
    <div className="project-page">
      <header className="page-header project-header">
        <div>
          <div className="detail-title-line">
            <h1>{project.name}</h1>
            <span className="status-label">revision {project.revision}</span>
          </div>
          <p>{state.projectPath}</p>
        </div>
        <div className="page-header__actions">
          <button
            className="button button--secondary"
            disabled={Boolean(pending)}
            onClick={() => void exportPackage()}
            type="button"
          >
            <Package aria-hidden="true" size={17} />
            导出项目包
          </button>
          <button
            className="button button--secondary"
            disabled={Boolean(pending)}
            onClick={() => void choose('open')}
            type="button"
          >
            <FolderOpen aria-hidden="true" size={17} />
            打开其他项目
          </button>
          <button
            className="button button--secondary"
            disabled={Boolean(pending)}
            onClick={() =>
              void run(
                'import',
                () => window.studio.studioProject!.importComponent(project.revision),
                '组件已通过静态扫描导入。',
              )
            }
            type="button"
          >
            <Plus aria-hidden="true" size={17} />
            导入组件
          </button>
          <button
            className="button button--primary"
            disabled={Boolean(pending) || state.validation?.status !== 'ready'}
            onClick={() =>
              void run(
                'freeze',
                () => window.studio.studioProject!.freeze(project.revision),
                '已创建或复用相同的不可变版本。',
              )
            }
            type="button"
          >
            <Snowflake aria-hidden="true" size={17} />
            冻结版本
          </button>
        </div>
      </header>

      {state.changedExternally ? (
        <div className="project-change-note" role="status">
          <ArrowClockwise aria-hidden="true" size={17} />
          <span>检测到 CLI 或其他编辑器修改，界面已刷新到 revision {project.revision}。</span>
        </div>
      ) : null}
      {state.recovered ? (
        <div className="project-change-note" role="alert">
          <WarningCircle aria-hidden="true" size={17} />
          <span>
            项目已从最后有效备份恢复。原无效文件已保留为
            .agent-stack.invalid-*，请人工比较后再继续修改。
          </span>
        </div>
      ) : null}
      {error ? (
        <div className="detail-feedback detail-feedback--error" role="alert">
          {error}
          <button className="button button--secondary" onClick={() => void load()} type="button">
            重新读取
          </button>
        </div>
      ) : null}
      {feedback ? (
        <div className="detail-feedback" role="status">
          <CheckCircle aria-hidden="true" size={18} weight="fill" />
          {feedback}
        </div>
      ) : null}

      <div className="project-meta-strip">
        <span>
          <FileCode aria-hidden="true" size={17} />
          <strong>.agent-stack v{project.formatVersion}</strong>
        </span>
        <span>
          <GitBranch aria-hidden="true" size={17} />
          {project.components.length} 个组件
        </span>
        <span>
          <Snowflake aria-hidden="true" size={17} />
          {project.versions.length} 个不可变版本
        </span>
        <span>
          <GitBranch aria-hidden="true" size={17} />
          {project.workflows.length} 个 Workflow
        </span>
        <span>
          <ShieldCheck aria-hidden="true" size={17} />
          SHA-256 已验证 {state.integrity?.versionsChecked ?? 0} 个版本
        </span>
        <code title={state.cliPath}>{state.cliPath}</code>
      </div>

      <div className="project-change-note project-export-note">
        <ShieldCheck aria-hidden="true" size={17} />
        <span>
          导出包保留可移植项目事实与不可变版本；不包含 Keychain 密钥、SQLite、Run、
          Experiment、Receipt、Artifact、日志或本机绝对路径。
        </span>
      </div>

      <section className="project-section" aria-labelledby="project-components-title">
        <header>
          <div>
            <h2 id="project-components-title">组件来源与 Descriptor</h2>
            <p>只显示静态证据，不把“已声明”表述成“已运行验证”。</p>
          </div>
          <span>{project.components.length} 个</span>
        </header>
        {project.components.length === 0 ? (
          <div className="project-inline-empty">
            <Cube aria-hidden="true" size={25} />
            <p>
              尚未导入组件。使用 GUI 选择本地仓库，或运行 <code>studio component import</code>。
            </p>
          </div>
        ) : (
          <ul className="project-component-list">
            {project.components.map((component) => {
              const inStack = project.stack.componentIds.includes(component.id)
              const editing = editingId === component.id
              return (
                <li key={component.id}>
                  <div className="project-component-main">
                    <strong>{component.descriptor.name}</strong>
                    <code>{component.id}</code>
                    <small>
                      {component.descriptor.id}@{component.descriptor.version} ·{' '}
                      {component.evidenceLevel} · Git {component.source.git.status}
                    </small>
                  </div>
                  <div className="project-component-actions">
                    <button
                      className="button button--secondary"
                      disabled={Boolean(pending) || Boolean(component.archivedAt)}
                      onClick={() =>
                        void run(
                          `stack-${component.id}`,
                          () =>
                            inStack
                              ? window.studio.studioProject!.removeFromStack(mutation(component.id))
                              : window.studio.studioProject!.addToStack(mutation(component.id)),
                          inStack ? '组件已从 Stack 移除。' : '组件已加入 Stack。',
                        )
                      }
                      type="button"
                    >
                      {inStack ? '从 Stack 移除' : '加入 Stack'}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`更正 ${component.descriptor.name} Descriptor`}
                      onClick={() => {
                        setEditingId(component.id)
                        setDescriptorText(JSON.stringify(component.descriptor, null, 2))
                      }}
                      type="button"
                    >
                      <FileCode aria-hidden="true" size={17} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`归档 ${component.descriptor.name}`}
                      disabled={Boolean(component.archivedAt)}
                      onClick={() =>
                        void run(
                          `archive-${component.id}`,
                          () =>
                            window.studio.studioProject!.archiveComponent(mutation(component.id)),
                          '组件已归档，历史引用保持可读。',
                        )
                      }
                      type="button"
                    >
                      <Archive aria-hidden="true" size={17} />
                    </button>
                    {deleteId === component.id ? (
                      <>
                        <button
                          className="button button--danger"
                          onClick={() =>
                            void run(
                              `delete-${component.id}`,
                              () =>
                                window.studio.studioProject!.deleteComponent(
                                  mutation(component.id),
                                ),
                              '未引用组件已删除。',
                            )
                          }
                          type="button"
                        >
                          确认删除
                        </button>
                        <button
                          className="button button--secondary"
                          onClick={() => setDeleteId(undefined)}
                          type="button"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        className="icon-button"
                        aria-label={`删除 ${component.descriptor.name}`}
                        onClick={() => setDeleteId(component.id)}
                        type="button"
                      >
                        <Trash aria-hidden="true" size={17} />
                      </button>
                    )}
                  </div>
                  {editing ? (
                    <div className="descriptor-editor">
                      <label htmlFor={`descriptor-${component.id}`}>
                        Component Descriptor JSON
                      </label>
                      <textarea
                        id={`descriptor-${component.id}`}
                        value={descriptorText}
                        onChange={(event) => setDescriptorText(event.target.value)}
                        rows={16}
                      />
                      <div>
                        <button
                          className="button button--primary"
                          disabled={Boolean(pending)}
                          onClick={() => void saveDescriptor(component.id)}
                          type="button"
                        >
                          保存 Descriptor
                        </button>
                        <button
                          className="button button--secondary"
                          onClick={() => setEditingId(undefined)}
                          type="button"
                        >
                          取消更正
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="project-section" aria-labelledby="project-owner-title">
        <header>
          <div>
            <h2 id="project-owner-title">Stack 与能力 Owner</h2>
            <p>重叠能力必须由用户明确选择一个 Owner。</p>
          </div>
          <span>{stackComponents.length} 个 Stack 组件</span>
        </header>
        {providers.length === 0 ? (
          <div className="project-inline-empty">
            <p>Stack 为空。先把组件加入 Stack。</p>
          </div>
        ) : (
          <div className="project-owner-list">
            {providers.map(([capability, candidates]) => {
              const selected = project.stack.capabilityOwners.find(
                (owner) => owner.capability === capability,
              )?.componentId
              return (
                <fieldset key={capability}>
                  <legend>
                    <strong>{capabilityLabel(capability)}</strong>
                    <code>{capability}</code>
                  </legend>
                  <div>
                    {candidates.map((component) => (
                      <label key={component.id}>
                        <input
                          checked={candidates.length === 1 || selected === component.id}
                          disabled={candidates.length === 1 || Boolean(pending)}
                          name={`project-owner-${capability}`}
                          onChange={() =>
                            void run(
                              `owner-${capability}`,
                              () =>
                                window.studio.studioProject!.setOwner({
                                  capability,
                                  componentId: component.id,
                                  expectedRevision: project.revision,
                                }),
                              `${capability} Owner 已更新。`,
                            )
                          }
                          type="radio"
                        />
                        <span>{component.descriptor.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )
            })}
          </div>
        )}
      </section>

      <WorkflowSection pending={pending} project={project} run={run} />

      <section
        className={`project-validation project-validation--${state.validation?.status ?? 'blocked'}`}
        aria-live="polite"
      >
        <header>
          {state.validation?.status === 'ready' ? (
            <CheckCircle aria-hidden="true" size={22} weight="fill" />
          ) : (
            <WarningCircle aria-hidden="true" size={22} weight="fill" />
          )}
          <div>
            <h2>项目验证{state.validation?.status === 'ready' ? '通过' : '已阻断'}</h2>
            <p>
              {state.validation?.status === 'ready'
                ? `Runtime Plan ${state.validation.runtimePlanHash?.slice(0, 14)}`
                : '按下方提示修正后再冻结版本。'}
            </p>
          </div>
        </header>
        {state.validation?.issues.length ? (
          <ul>
            {state.validation.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <strong>{issue.code}</strong>
                <span>{issue.message}</span>
                <small>{issue.suggestedActions[0]}</small>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <RemediationTaskList tasks={state.validation?.remediationTasks ?? []} />

      {project.versions.length > 0 ? (
        <section className="project-section">
          <header>
            <div>
              <h2>不可变版本</h2>
              <p>相同内容重复创建会复用已有版本。</p>
            </div>
          </header>
          <ul className="project-version-list">
            {[...project.versions].reverse().map((version) => (
              <li key={version.id}>
                <Snowflake aria-hidden="true" size={18} />
                <span>
                  <strong>版本 {version.versionNumber}</strong>
                  <small>
                    来源 revision {version.sourceRevision} ·{' '}
                    {new Date(version.createdAt).toLocaleString('zh-CN')}
                  </small>
                </span>
                <code>{version.contentHash.slice(0, 16)}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
