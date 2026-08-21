import {
  ArrowClockwise,
  ArrowLeft,
  Cube,
  Info,
  MagnifyingGlass,
  WarningCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentCatalogItem } from '../../../shared/component-catalog'
import { capabilityLabel, compatibilityLabels, validationLabels } from '../copy'

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
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<ComponentCatalogItem>()
  const [detailStatus, setDetailStatus] = useState<CatalogStatus>('ready')
  const [detailError, setDetailError] = useState<string>()
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
      return matchesQuery && matchesCompatibility && matchesSource
    })
  }, [compatibility, items, query, source])

  return (
    <div className="catalog-page">
      <header className="page-header">
        <div>
          <h1>组件</h1>
          <p>查看保存在这台 Mac 上的 Component Contract、能力覆盖、使用方和验证证据。</p>
        </div>
      </header>

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
          <p>静态导入或内置组件通过 Component Contract v1 验证后，会出现在这里。</p>
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
                <option value="unknown">待确认</option>
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
                              {compatibilityLabels[compatibilityState.level]}
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
          {detailStatus === 'ready' && detail ? <ComponentDetail item={detail} /> : null}
        </section>
      ) : null}
    </div>
  )
}

function ComponentDetail({ item }: { item: ComponentCatalogItem }) {
  const descriptor = item.component.descriptor
  return (
    <div className="component-detail">
      <header>
        <span className="eyebrow">Component Contract v{descriptor.contractVersion}</span>
        <h2>{descriptor.name}</h2>
        <p>{descriptor.compatibility.detail}</p>
        <code>{descriptor.id}</code>
      </header>

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
              <dt>敏感字段</dt>
              <dd>Descriptor 未携带密钥原文；敏感值仅允许使用 Keychain 引用。</dd>
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
                <p>{evidence.detail}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p>尚无证据。声明本身不授予执行权限。</p>
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
