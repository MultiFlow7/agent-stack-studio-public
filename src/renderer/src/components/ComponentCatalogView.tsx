import {
  Archive,
  ArrowClockwise,
  ArrowLeft,
  Cube,
  Info,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentCatalogItem } from '../../../shared/component-catalog'
import type { ComponentDescriptor } from '../../../shared/component'
import {
  capabilityLabel,
  compatibilityAssessmentLabels,
  compatibilityLabels,
  validationLabels,
} from '../copy'
import { DescriptorEditor } from './DescriptorEditor'
import type { CompatibilityAction } from '../../../shared/compatibility-assessment'

type CatalogStatus = 'loading' | 'ready' | 'error'

interface ComponentCatalogViewProps {
  initialComponentId?: string
}

function sourceLabel(kind: ComponentCatalogItem['component']['descriptor']['source']['kind']) {
  if (kind === 'built-in') return '内置'
  if (kind === 'generated-adapter') return '生成的 Adapter'
  if (kind === 'static-import') return '静态导入'
  return '本地包'
}

export function ComponentCatalogView({ initialComponentId }: ComponentCatalogViewProps) {
  const [items, setItems] = useState<ComponentCatalogItem[]>([])
  const [status, setStatus] = useState<CatalogStatus>('loading')
  const [error, setError] = useState<string>()
  const [query, setQuery] = useState('')
  const [compatibility, setCompatibility] = useState('all')
  const [source, setSource] = useState('all')
  const [lifecycle, setLifecycle] = useState<'active' | 'archived' | 'all'>('active')
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<ComponentCatalogItem>()
  const [detailStatus, setDetailStatus] = useState<CatalogStatus>('ready')
  const [detailError, setDetailError] = useState<string>()
  const [isImporting, setImporting] = useState(false)
  const [feedback, setFeedback] = useState<string>()
  const [pending, setPending] = useState<string>()
  const detailRequest = useRef(0)

  const load = useCallback(async () => {
    setStatus('loading')
    setError(undefined)
    try {
      setItems(await window.studio.components.catalog())
      setStatus('ready')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取本地组件。')
      setStatus('error')
    }
  }, [])

  const importComponent = useCallback(async () => {
    setImporting(true)
    setError(undefined)
    setFeedback(undefined)
    try {
      const current = await window.studio.studioProject!.current()
      if (!current.project) throw new Error('请先在顶栏打开或创建一个项目。')
      const next = await window.studio.studioProject!.importComponent(current.project.revision)
      setItems(await window.studio.components.catalog())
      setStatus('ready')
      if (next.project?.revision !== current.project.revision) {
        setFeedback('组件已静态导入，现在可以在 Agent 的 Stack 中选择。')
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '无法导入组件。')
      setStatus('error')
    } finally {
      setImporting(false)
    }
  }, [])

  const openDetail = useCallback(async (componentId: string) => {
    const request = ++detailRequest.current
    setSelectedId(componentId)
    setDetail(undefined)
    setDetailError(undefined)
    setDetailStatus('loading')
    window.setTimeout(() => document.getElementById('component-detail-panel')?.focus(), 0)
    try {
      const nextDetail = await window.studio.components.get(componentId)
      if (request !== detailRequest.current) return
      setDetail(nextDetail)
      setDetailStatus('ready')
    } catch (loadError) {
      if (request !== detailRequest.current) return
      setDetailError(loadError instanceof Error ? loadError.message : '无法读取组件详情。')
      setDetailStatus('error')
    }
  }, [])

  const mutateComponent = useCallback(
    async (
      componentId: string,
      action: (expectedRevision: number) => Promise<unknown>,
      success: string,
      deleted = false,
      operation?: string,
    ): Promise<boolean> => {
      setPending(operation ? `${componentId}:${operation}` : componentId)
      setDetailError(undefined)
      setFeedback(undefined)
      try {
        const current = await window.studio.studioProject!.current()
        if (!current.project) throw new Error('请先在顶栏打开或创建一个项目。')
        await action(current.project.revision)
        const nextItems = await window.studio.components.catalog()
        setItems(nextItems)
        setFeedback(success)
        if (deleted) {
          setSelectedId(undefined)
          setDetail(undefined)
        } else {
          setDetail(await window.studio.components.get(componentId))
        }
        return true
      } catch (cause) {
        setDetailError(cause instanceof Error ? cause.message : '无法更新组件。')
        return false
      } finally {
        setPending(undefined)
      }
    },
    [],
  )

  useEffect(() => {
    let active = true
    void window.studio.components
      .catalog()
      .then((nextItems) => {
        if (!active) return
        setItems(nextItems)
        setStatus('ready')
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : '无法读取本地组件。')
        setStatus('error')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!window.studio.studioProject?.onExternalChanged) return undefined
    return window.studio.studioProject.onExternalChanged(() => {
      void load()
      if (selectedId) void openDetail(selectedId)
    })
  }, [load, openDetail, selectedId])

  useEffect(() => {
    if (!initialComponentId) return
    const timer = window.setTimeout(() => void openDetail(initialComponentId), 0)
    return () => window.clearTimeout(timer)
  }, [initialComponentId, openDetail])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-CN')
    return items.filter(({ component }) => {
      const descriptor = component.descriptor
      const matchesQuery =
        !normalized ||
        [descriptor.name, descriptor.id, ...descriptor.provides.map(({ capability }) => capability)]
          .join(' ')
          .toLocaleLowerCase('zh-CN')
          .includes(normalized)
      const matchesCompatibility =
        compatibility === 'all' || descriptor.compatibility.level === compatibility
      const matchesSource = source === 'all' || descriptor.source.kind === source
      const matchesLifecycle =
        lifecycle === 'all' ||
        (lifecycle === 'archived' ? Boolean(component.archivedAt) : !component.archivedAt)
      return matchesQuery && matchesCompatibility && matchesSource && matchesLifecycle
    })
  }, [compatibility, items, lifecycle, query, source])

  return (
    <div className="catalog-page">
      <header className="page-header">
        <div>
          <h1>组件库</h1>
          <p>管理当前项目可用的组件、来源、版本、Descriptor 与兼容证据。</p>
        </div>
        <div className="page-header__actions">
          <button
            className="button button--primary"
            disabled={isImporting}
            onClick={() => void importComponent()}
            type="button"
          >
            <Plus aria-hidden="true" size={17} />
            {isImporting ? '正在检查…' : '从本地导入组件'}
          </button>
        </div>
      </header>

      {feedback ? (
        <div className="detail-feedback" role="status">
          {feedback}
        </div>
      ) : null}

      {status === 'loading' ? (
        <section aria-busy="true" aria-label="正在载入组件" className="loading-state">
          <div className="skeleton skeleton--title" />
          <div className="skeleton" />
          <div className="skeleton" />
        </section>
      ) : null}

      {status === 'error' ? (
        <section className="state-panel state-panel--error" role="alert">
          <div className="state-panel__icon">
            <ArrowClockwise aria-hidden="true" size={24} />
          </div>
          <h2>无法载入组件</h2>
          <p>{error}</p>
          <button className="button button--secondary" onClick={() => void load()} type="button">
            重试
          </button>
        </section>
      ) : null}

      {status === 'ready' && items.length === 0 ? (
        <section className="empty-state">
          <div className="empty-state__mark" aria-hidden="true">
            <Cube size={32} weight="duotone" />
          </div>
          <h2>尚无本地组件记录</h2>
          <p>选择本地仓库后，Studio 只做静态检查；导入完成后会立即出现在 Agent 组装器中。</p>
          <button
            className="button button--primary"
            onClick={() => void importComponent()}
            type="button"
          >
            <Plus aria-hidden="true" size={17} /> 导入第一个组件
          </button>
        </section>
      ) : null}

      {status === 'ready' && items.length > 0 ? (
        <>
          <section className="catalog-filters" aria-label="筛选本地组件">
            <label className="catalog-search">
              <span>搜索</span>
              <span>
                <MagnifyingGlass aria-hidden="true" size={17} />
                <input
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="名称、Contract ID 或能力"
                  type="search"
                  value={query}
                />
              </span>
            </label>
            <label>
              <span>范围</span>
              <select
                onChange={(event) => setLifecycle(event.target.value as typeof lifecycle)}
                value={lifecycle}
              >
                <option value="active">现有组件</option>
                <option value="archived">已归档</option>
                <option value="all">全部</option>
              </select>
            </label>
            <label>
              <span>兼容状态</span>
              <select
                onChange={(event) => setCompatibility(event.target.value)}
                value={compatibility}
              >
                <option value="all">全部</option>
                <option value="native">原生兼容</option>
                <option value="configuration">需要配置</option>
                <option value="adapter">需要 Adapter</option>
                <option value="fork">需要 Fork</option>
                <option value="blocked">已阻断</option>
                <option value="unknown">机器证据不足</option>
              </select>
            </label>
            <label>
              <span>来源</span>
              <select onChange={(event) => setSource(event.target.value)} value={source}>
                <option value="all">全部</option>
                <option value="built-in">内置</option>
                <option value="local-package">本地包</option>
                <option value="static-import">静态导入</option>
                <option value="generated-adapter">生成的 Adapter</option>
              </select>
            </label>
          </section>

          {filtered.length === 0 ? (
            <section className="inline-empty catalog-filter-empty">
              <p>没有符合当前筛选条件的组件。</p>
              <button
                className="button button--quiet"
                onClick={() => {
                  setQuery('')
                  setCompatibility('all')
                  setSource('all')
                  setLifecycle('active')
                }}
                type="button"
              >
                清除筛选
              </button>
            </section>
          ) : (
            <section className="component-catalog" aria-label={`${filtered.length} 个本地组件`}>
              <div className="catalog-summary">
                <span>
                  显示 {filtered.length} / {items.length} 个本地组件
                </span>
                <span>
                  <Info aria-hidden="true" size={15} />
                  已生成 Adapter 不等于已验证兼容
                </span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">组件</th>
                      <th scope="col">版本</th>
                      <th scope="col">来源</th>
                      <th scope="col">能力覆盖</th>
                      <th scope="col">兼容状态</th>
                      <th scope="col">使用方</th>
                      <th scope="col">最近验证记录</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const component = item.component
                      const descriptor = component.descriptor
                      const compatibilityState = descriptor.compatibility
                      const needsAttention = compatibilityState.validation !== 'runtime-verified'
                      return (
                        <tr key={component.id}>
                          <th scope="row">
                            <button
                              className="catalog-component-link"
                              onClick={() => void openDetail(component.id)}
                              type="button"
                            >
                              <strong>{descriptor.name}</strong>
                              <code>{descriptor.id}</code>
                            </button>
                          </th>
                          <td>{descriptor.version}</td>
                          <td>
                            <span>{sourceLabel(descriptor.source.kind)}</span>
                            <small>{descriptor.source.license}</small>
                          </td>
                          <td>
                            <div className="capability-tags">
                              {descriptor.provides.map(({ capability }) => (
                                <span key={capability}>{capabilityLabel(capability)}</span>
                              ))}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`compatibility compatibility--${needsAttention ? 'warning' : 'ready'}`}
                            >
                              {needsAttention ? (
                                <WarningCircle aria-hidden="true" size={16} />
                              ) : null}
                              {component.archivedAt
                                ? '已归档'
                                : compatibilityLabels[compatibilityState.level]}
                            </span>
                            <small>{validationLabels[compatibilityState.validation]}</small>
                          </td>
                          <td>
                            <span>{item.usedByAgents.length} 个 Agent 草稿</span>
                            <small>{item.affectedVersions.length} 个不可变版本</small>
                          </td>
                          <td>
                            {item.validationRecord ? (
                              <>
                                <span>{validationLabels[item.validationRecord.status]}</span>
                                <small>
                                  {new Date(item.validationRecord.recordedAt).toLocaleString(
                                    'zh-CN',
                                  )}
                                </small>
                              </>
                            ) : (
                              <span>尚无验证记录</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      ) : null}

      {selectedId ? (
        <section
          aria-label="组件详情"
          className="component-detail-panel"
          id="component-detail-panel"
          tabIndex={-1}
        >
          <button
            className="back-button"
            onClick={() => {
              detailRequest.current += 1
              setSelectedId(undefined)
              setDetail(undefined)
              setDetailError(undefined)
            }}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={17} /> 返回组件目录
          </button>

          {detailStatus === 'loading' ? (
            <div aria-busy="true" aria-label="正在载入组件详情" className="loading-state">
              <div className="skeleton skeleton--title" />
              <div className="skeleton" />
            </div>
          ) : null}
          {detailStatus === 'error' ? (
            <div className="state-panel state-panel--error" role="alert">
              <h2>无法载入组件详情</h2>
              <p>{detailError}</p>
              <button
                className="button button--secondary"
                onClick={() => void openDetail(selectedId)}
                type="button"
              >
                重试
              </button>
            </div>
          ) : null}
          {detailStatus === 'ready' && detailError ? (
            <div className="detail-feedback detail-feedback--error" role="alert">
              {detailError}
            </div>
          ) : null}
          {detailStatus === 'ready' && detail ? (
            <ComponentDetail
              item={detail}
              pending={Boolean(pending?.startsWith(detail.component.id))}
              runtimePending={pending === `${detail.component.id}:runtime`}
              onArchive={() =>
                mutateComponent(
                  detail.component.id,
                  (expectedRevision) =>
                    window.studio.studioProject!.archiveComponent({
                      componentId: detail.component.id,
                      expectedRevision,
                    }),
                  '组件已归档，历史引用保持可读。',
                )
              }
              onDelete={() =>
                mutateComponent(
                  detail.component.id,
                  (expectedRevision) =>
                    window.studio.studioProject!.deleteComponent({
                      componentId: detail.component.id,
                      expectedRevision,
                    }),
                  '未引用组件已删除。',
                  true,
                )
              }
              onRestore={() =>
                mutateComponent(
                  detail.component.id,
                  (expectedRevision) =>
                    window.studio.studioProject!.restoreComponent({
                      componentId: detail.component.id,
                      expectedRevision,
                    }),
                  '组件已恢复，现在可在 Agent Stack 中选择。',
                )
              }
              onRecheck={() =>
                mutateComponent(
                  detail.component.id,
                  (expectedRevision) =>
                    window.studio.studioProject!.recheckComponent({
                      componentId: detail.component.id,
                      expectedRevision,
                    }),
                  '静态检查已完成，未执行组件代码。',
                )
              }
              onContractTest={() =>
                mutateComponent(
                  detail.component.id,
                  (expectedRevision) =>
                    window.studio.studioProject!.runComponentContractTest({
                      componentId: detail.component.id,
                      expectedRevision,
                    }),
                  '契约测试已通过，Receipt 与 Artifact 哈希已记录。',
                  false,
                  'contract',
                )
              }
              onRuntimeValidate={() =>
                mutateComponent(
                  detail.component.id,
                  (expectedRevision) =>
                    window.studio.studioProject!.runComponentRuntimeValidation({
                      componentId: detail.component.id,
                      expectedRevision,
                      timeoutMs: 5_000,
                    }),
                  '受信最小运行验证已通过。',
                  false,
                  'runtime',
                )
              }
              onCancelRuntime={async () => {
                const result = await window.studio.studioProject!.cancelComponentRuntimeValidation({
                  componentId: detail.component.id,
                })
                setFeedback(
                  result.cancelled
                    ? '正在取消运行验证，本次不会写入证据。'
                    : '当前没有可取消的运行验证。',
                )
              }}
              onUpdate={(descriptor) =>
                mutateComponent(
                  detail.component.id,
                  (expectedRevision) =>
                    window.studio.studioProject!.updateDescriptor({
                      componentId: detail.component.id,
                      descriptor,
                      expectedRevision,
                    }),
                  'Descriptor 已更新，原兼容证据等级保持不变。',
                )
              }
            />
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function ComponentDetail({
  item,
  pending,
  runtimePending,
  onArchive,
  onRestore,
  onDelete,
  onUpdate,
  onRecheck,
  onContractTest,
  onRuntimeValidate,
  onCancelRuntime,
}: {
  item: ComponentCatalogItem
  pending: boolean
  runtimePending: boolean
  onArchive: () => Promise<boolean>
  onRestore: () => Promise<boolean>
  onDelete: () => Promise<boolean>
  onUpdate: (descriptor: ComponentDescriptor) => Promise<boolean>
  onRecheck: () => Promise<boolean>
  onContractTest: () => Promise<boolean>
  onRuntimeValidate: () => Promise<boolean>
  onCancelRuntime: () => Promise<void>
}) {
  const descriptor = item.component.descriptor
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const executeAssessmentAction = (action: CompatibilityAction): void => {
    if (
      action.action === 'edit-contract' ||
      action.action === 'declare-configuration' ||
      action.action === 'select-strategy'
    ) {
      setEditing(true)
    } else if (action.action === 'recheck-static') {
      void onRecheck()
    } else if (action.action === 'run-contract-test') {
      void onContractTest()
    } else if (action.action === 'run-trusted-validation') {
      void onRuntimeValidate()
    }
  }
  return (
    <div className="component-detail">
      <header>
        <span className="eyebrow">Component Contract v{descriptor.contractVersion}</span>
        <h2>{descriptor.name}</h2>
        <p>{descriptor.compatibility.detail}</p>
        <code>{descriptor.id}</code>
        <div className="page-header__actions">
          <button
            className="button button--secondary"
            disabled={pending}
            onClick={() => setEditing((value) => !value)}
            type="button"
          >
            <PencilSimple aria-hidden="true" size={17} />
            {editing ? '取消更新' : '更新 Descriptor'}
          </button>
          {item.component.archivedAt ? (
            <button
              className="button button--secondary"
              disabled={pending}
              onClick={() => void onRestore()}
              type="button"
            >
              <ArrowClockwise aria-hidden="true" size={17} />
              恢复组件
            </button>
          ) : (
            <button
              className="button button--secondary"
              disabled={pending}
              onClick={() => void onArchive()}
              type="button"
            >
              <Archive aria-hidden="true" size={17} />
              归档组件
            </button>
          )}
          {!confirmDelete ? (
            <button
              className="button button--danger"
              disabled={pending || !item.component.archivedAt}
              onClick={() => setConfirmDelete(true)}
              type="button"
              title={item.component.archivedAt ? undefined : '请先归档并复核引用'}
            >
              <Trash aria-hidden="true" size={17} />
              永久删除
            </button>
          ) : (
            <span className="inline-confirm" role="group" aria-label={`删除 ${descriptor.name}`}>
              <button
                className="button button--danger"
                disabled={pending}
                onClick={() => void onDelete()}
                type="button"
              >
                确认删除
              </button>
              <button
                className="button button--secondary"
                disabled={pending}
                onClick={() => setConfirmDelete(false)}
                type="button"
              >
                取消
              </button>
            </span>
          )}
        </div>
      </header>

      {editing ? (
        <DescriptorEditor
          descriptor={descriptor}
          onCancel={() => setEditing(false)}
          onSave={onUpdate}
          pending={pending}
        />
      ) : null}

      <div className="component-detail__grid">
        <section>
          <h3>Manifest 与来源</h3>
          <dl className="fact-list">
            <div>
              <dt>版本 / 类型</dt>
              <dd>
                {descriptor.version} · {descriptor.kind === 'adapter' ? 'Adapter' : 'Component'}
              </dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>
                {sourceLabel(descriptor.source.kind)} · {descriptor.source.location}
              </dd>
            </div>
            <div>
              <dt>许可证</dt>
              <dd>{descriptor.source.license}</dd>
            </div>
            <div>
              <dt>平台</dt>
              <dd>{descriptor.platforms.join('、')}</dd>
            </div>
            <div>
              <dt>配置 Schema</dt>
              <dd>{descriptor.configSchema ?? '未声明'}</dd>
            </div>
            <div>
              <dt>权限</dt>
              <dd>
                {descriptor.permissions?.length
                  ? descriptor.permissions
                      .map(({ scope, required }) => `${scope}${required ? '（必需）' : ''}`)
                      .join('、')
                  : '未声明额外权限'}
              </dd>
            </div>
            <div>
              <dt>Keychain 引用</dt>
              <dd>
                {descriptor.secretReferences?.length
                  ? descriptor.secretReferences.map(({ name }) => name).join('、')
                  : '未声明；Descriptor 不允许密钥原文'}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h3>Adapter / Fork 状态</h3>
          <dl className="fact-list">
            <div>
              <dt>兼容等级</dt>
              <dd>{compatibilityLabels[descriptor.compatibility.level]}</dd>
            </div>
            <div>
              <dt>验证等级</dt>
              <dd>{validationLabels[descriptor.compatibility.validation]}</dd>
            </div>
            <div>
              <dt>Runtime Adapter</dt>
              <dd>{descriptor.runtimeAdapter ?? '未声明'}</dd>
            </div>
            <div>
              <dt>补丁 / Fork</dt>
              <dd>
                {descriptor.compatibility.level === 'fork'
                  ? '需要独立 Fork 与补丁证据，当前未验证前保持阻断。'
                  : '当前 Descriptor 未声明独立补丁集。'}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section>
        <h3>可解释的兼容性评估</h3>
        {item.assessment ? (
          <div className="compatibility-assessment">
            <p>
              <strong>{compatibilityAssessmentLabels[item.assessment.status]}</strong>
              <span>
                {new Date(item.assessment.checkedAt).toLocaleString('zh-CN')} ·{' '}
                {item.assessment.method === 'trusted-runtime-v1'
                  ? '受信运行验证'
                  : '静态 Descriptor 评估'}
              </span>
            </p>
            <p>{item.assessment.explanation}</p>
            <ul>
              {item.assessment.evidence.map((evidence, index) => (
                <li key={`${evidence.kind}-${index}`}>
                  <strong>
                    {evidence.status === 'passed'
                      ? '已通过'
                      : evidence.status === 'blocked'
                        ? '阻断'
                        : evidence.status === 'missing'
                          ? '缺失'
                          : '需人工决定'}
                  </strong>
                  <span>{evidence.detail}</span>
                </li>
              ))}
            </ul>
            {item.assessment.blockers.length > 0 ? (
              <div role="alert">
                <strong>阻断原因</strong>
                <ul>
                  {item.assessment.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="compatibility-actions">
              <strong>建议下一步</strong>
              <ol>
                {item.assessment.suggestedActions.map((action) => (
                  <li key={action.id}>
                    <div>
                      <strong>{action.label}</strong>
                      <p>{action.description}</p>
                    </div>
                    {action.presentation === 'external-step' ? (
                      <details>
                        <summary>{action.label}</summary>
                        <p>{action.externalStep}</p>
                      </details>
                    ) : (
                      <button
                        className="button button--secondary"
                        disabled={pending || !action.enabled}
                        onClick={() => executeAssessmentAction(action)}
                        type="button"
                      >
                        {action.label}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
              {runtimePending ? (
                <button
                  className="button button--secondary"
                  onClick={() => void onCancelRuntime()}
                  type="button"
                >
                  取消运行验证
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p>将组件加入 Agent Stack 后，系统会生成静态评估。</p>
        )}
      </section>

      <section>
        <h3>提供与依赖的能力</h3>
        <div className="component-detail__capabilities">
          <div>
            <h4>提供</h4>
            <ul>
              {descriptor.provides.map((provider) => (
                <li key={provider.capability}>
                  <strong>{capabilityLabel(provider.capability)}</strong>
                  <code>{provider.implementation}</code>
                  <span>
                    {provider.replaceability} · {provider.confidence}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>依赖</h4>
            {descriptor.requires.length > 0 ? (
              <ul>
                {descriptor.requires.map((requirement) => (
                  <li key={requirement.capability}>
                    <strong>{capabilityLabel(requirement.capability)}</strong>
                    <span>{requirement.version ?? '任意兼容版本'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>没有声明外部能力依赖。</p>
            )}
          </div>
        </div>
      </section>

      <section>
        <h3>契约测试与来源证据</h3>
        {descriptor.evidence.length > 0 ? (
          <ol className="component-evidence-list">
            {descriptor.evidence.map((evidence, index) => (
              <li key={`${evidence.kind}-${index}`}>
                <span>{evidence.kind}</span>
                <p>
                  {evidence.detail}
                  {evidence.recordedAt
                    ? ` ${new Date(evidence.recordedAt).toLocaleString('zh-CN')}`
                    : ''}
                  {evidence.supersededAt
                    ? ` · 已于 ${new Date(evidence.supersededAt).toLocaleString('zh-CN')} 因契约变更失效`
                    : ''}
                  {evidence.receiptId ? ` · Receipt ${evidence.receiptId}` : ''}
                  {evidence.artifact
                    ? ` · Artifact ${evidence.artifact.name} (${evidence.artifact.contentHash.slice(0, 12)}…)`
                    : ''}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p>尚无证据。声明本身不授予执行权限。</p>
        )}
      </section>

      <section>
        <h3>处置审计记录</h3>
        {item.auditTrail?.length ? (
          <ol className="component-evidence-list">
            {[...item.auditTrail].reverse().map((entry) => (
              <li key={entry.id}>
                <span>{entry.action}</span>
                <p>
                  {entry.summary} · {entry.actor === 'system' ? '系统' : '用户'} ·{' '}
                  {new Date(entry.recordedAt).toLocaleString('zh-CN')}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p>旧组件尚无处置审计记录；下次结构编辑、检查、归档或恢复后开始记录。</p>
        )}
      </section>

      <section>
        <h3>当前使用方与受影响版本</h3>
        <div className="component-detail__usage">
          <div>
            <h4>Agent 草稿</h4>
            {item.usedByAgents.length > 0 ? (
              <ul>
                {item.usedByAgents.map((agent) => (
                  <li key={agent.id}>
                    <strong>{agent.name}</strong>
                    <span>
                      草稿修订 {agent.draftRevision} · {agent.archivedAt ? '已归档' : '现有'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>当前没有 Agent 草稿使用此组件。</p>
            )}
          </div>
          <div>
            <h4>不可变 Agent Version</h4>
            {item.affectedVersions.length > 0 ? (
              <ul>
                {item.affectedVersions.map((version) => (
                  <li key={version.versionId}>
                    <strong>{version.agentName}</strong>
                    <span>
                      版本 {version.versionNumber} ·{' '}
                      {new Date(version.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>没有不可变版本引用此组件。</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
