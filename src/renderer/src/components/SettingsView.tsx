import {
  Archive,
  ArrowClockwise,
  CheckCircle,
  ClockCounterClockwise,
  Database,
  FolderOpen,
  ShieldCheck,
  WarningCircle,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import type {
  CreateBackupResult,
  DataLocationId,
  RestorePreview,
} from '../../../shared/maintenance'

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

export function SettingsView() {
  const [status, setStatus] =
    useState<Awaited<ReturnType<typeof window.studio.maintenance.status>>>()
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busyAction, setBusyAction] = useState<'backup' | 'select' | 'restore'>()
  const [error, setError] = useState<string>()
  const [backupResult, setBackupResult] =
    useState<Extract<CreateBackupResult, { status: 'saved' }>>()
  const [restorePreview, setRestorePreview] = useState<RestorePreview>()
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const [restartMessage, setRestartMessage] = useState<string>()
  const [demoFeedback, setDemoFeedback] = useState<string>()
  const [openingLocation, setOpeningLocation] = useState<DataLocationId>()
  const [revealedLocation, setRevealedLocation] = useState<DataLocationId>()

  const load = useCallback(async () => {
    setLoadState('loading')
    setError(undefined)
    try {
      setStatus(await window.studio.maintenance.status())
      setLoadState('ready')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法读取本地数据状态。')
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createBackup(): Promise<void> {
    setBusyAction('backup')
    setError(undefined)
    setBackupResult(undefined)
    try {
      const result = await window.studio.maintenance.createBackup()
      if (result.status === 'saved') setBackupResult(result)
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : '无法创建本地备份。')
    } finally {
      setBusyAction(undefined)
    }
  }

  async function selectRestore(): Promise<void> {
    setBusyAction('select')
    setError(undefined)
    setRestoreConfirmed(false)
    setRestorePreview(undefined)
    try {
      const result = await window.studio.maintenance.selectRestore()
      if (result.status === 'selected') setRestorePreview(result.preview)
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : '所选备份无法通过检查。')
    } finally {
      setBusyAction(undefined)
    }
  }

  async function restore(): Promise<void> {
    if (!restorePreview || !restoreConfirmed) return
    setBusyAction('restore')
    setError(undefined)
    try {
      const result = await window.studio.maintenance.applyRestore({
        selectionId: restorePreview.selectionId,
        confirmed: true,
      })
      setRestartMessage(`已准备恢复“${result.backupName}”，应用正在重启。`)
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : '无法准备恢复。')
      setBusyAction(undefined)
    }
  }

  async function revealDataLocation(id: DataLocationId): Promise<void> {
    setOpeningLocation(id)
    setRevealedLocation(undefined)
    setError(undefined)
    try {
      await window.studio.maintenance.revealDataLocation({ id })
      setRevealedLocation(id)
    } catch (locationError) {
      setError(
        locationError instanceof Error ? locationError.message : '无法在 Finder 中打开该位置。',
      )
    } finally {
      setOpeningLocation(undefined)
    }
  }

  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <h1>设置</h1>
          <p>检查本地数据版本，创建可验证备份，或从备份恢复。</p>
        </div>
      </header>

      {loadState === 'loading' ? (
        <section
          aria-busy="true"
          aria-label="正在读取本地数据状态"
          className="loading-state settings-loading"
        >
          <div className="skeleton skeleton--title" />
          <div className="skeleton" />
        </section>
      ) : null}

      {loadState === 'error' ? (
        <section className="state-panel state-panel--error settings-state" role="alert">
          <div className="state-panel__icon">
            <ArrowClockwise aria-hidden="true" size={24} />
          </div>
          <h2>无法读取设置</h2>
          <p>{error}</p>
          <button className="button button--secondary" onClick={() => void load()} type="button">
            重试
          </button>
        </section>
      ) : null}

      {loadState === 'ready' && status ? (
        <div className="maintenance-layout">
          <section aria-labelledby="local-data-title" className="maintenance-section">
            <header className="maintenance-section__header">
              <Database aria-hidden="true" size={22} />
              <div>
                <h2 id="local-data-title">本地数据</h2>
                <p>升级时会按顺序迁移旧数据库，不会打开由更新版应用创建的数据库。</p>
              </div>
            </header>
            <dl className="maintenance-facts">
              <div>
                <dt>应用版本</dt>
                <dd>{status.applicationVersion}</dd>
              </div>
              <div>
                <dt>SQLite schema</dt>
                <dd>
                  v{status.databaseSchemaVersion}
                  {status.databaseSchemaVersion === status.supportedDatabaseSchemaVersion
                    ? '，当前版本'
                    : `，可迁移至 v${status.supportedDatabaseSchemaVersion}`}
                </dd>
              </div>
              <div>
                <dt>运行形式</dt>
                <dd>{status.packaged ? '打包应用' : '开发构建'}</dd>
              </div>
              <div>
                <dt>最近恢复</dt>
                <dd>
                  {status.lastRestoreAt
                    ? new Date(status.lastRestoreAt).toLocaleString('zh-CN')
                    : '尚未执行恢复'}
                </dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="storage-boundary-title" className="maintenance-section">
            <header className="maintenance-section__header">
              <FolderOpen aria-hidden="true" size={22} />
              <div>
                <h2 id="storage-boundary-title">存储与卸载边界</h2>
                <p>路径由 Main 进程固定并以枚举白名单打开，Renderer 不能传入任意路径。</p>
              </div>
            </header>
            <ul className="data-location-list">
              {status.dataLocations.map((location) => (
                <li key={location.id}>
                  <div>
                    <span className="data-location-list__title">
                      <strong>{location.label}</strong>
                      <small>{location.includedInBackup ? '备份包含' : '备份排除'}</small>
                    </span>
                    <code title={location.path}>{location.path}</code>
                    <p>{location.purpose}</p>
                  </div>
                  <button
                    aria-label={`在 Finder 中显示 ${location.label}`}
                    className="button button--secondary"
                    disabled={Boolean(openingLocation)}
                    onClick={() => void revealDataLocation(location.id)}
                    type="button"
                  >
                    {openingLocation === location.id ? '正在打开…' : 'Finder'}
                  </button>
                </li>
              ))}
            </ul>
            {revealedLocation ? (
              <div className="maintenance-feedback" role="status">
                <CheckCircle aria-hidden="true" size={20} weight="fill" />
                <span>已在 Finder 中打开所选位置。</span>
              </div>
            ) : null}
            <div className="maintenance-note maintenance-note--uninstall">
              <ShieldCheck aria-hidden="true" size={19} weight="fill" />
              <span>
                <strong>卸载应用不会删除这些数据</strong>
                <small>
                  先创建备份，再退出并移除 .app。彻底清理需由用户手动删除 Application Support 目录和
                  Keychain 条目。外部 .agent-stack 项目不受影响。
                </small>
              </span>
            </div>
          </section>

          <section aria-labelledby="backup-title" className="maintenance-section">
            <header className="maintenance-section__header">
              <Archive aria-hidden="true" size={22} />
              <div>
                <h2 id="backup-title">创建备份</h2>
                <p>备份包含 SQLite、工作空间和运行产物，并为每个文件记录完整性哈希。</p>
              </div>
            </header>
            <div className="maintenance-note">
              <ShieldCheck aria-hidden="true" size={19} weight="fill" />
              <span>
                <strong>密钥原文与日志不会进入备份</strong>
                <small>SQLite 中的 Keychain 引用会保留，钥匙串内的密钥不会被导出。</small>
              </span>
            </div>
            <button
              className="button button--primary"
              disabled={Boolean(busyAction)}
              onClick={() => void createBackup()}
              type="button"
            >
              <FolderOpen aria-hidden="true" size={17} />
              {busyAction === 'backup' ? '正在创建备份…' : '选择位置并创建备份'}
            </button>
            {backupResult ? (
              <div className="maintenance-feedback" role="status">
                <CheckCircle aria-hidden="true" size={20} weight="fill" />
                <span>
                  <strong>备份已创建：{backupResult.backupName}</strong>
                  <small>
                    {backupResult.fileCount} 个文件，{formatBytes(backupResult.sizeBytes)}，SQLite v
                    {backupResult.databaseSchemaVersion}
                  </small>
                </span>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="demo-data-title" className="maintenance-section">
            <header className="maintenance-section__header">
              <Database aria-hidden="true" size={22} />
              <div>
                <h2 id="demo-data-title">演示数据</h2>
                <p>新安装默认不填充演示组件。需要查看旧版样例时可在此主动加载。</p>
              </div>
            </header>
            <div className="maintenance-note">
              <ShieldCheck aria-hidden="true" size={19} weight="fill" />
              <span>
                <strong>不调用真实服务</strong>
                <small>
                  三个样例仅用于本地 Component Contract、Owner 冲突和内置 Runtime 验证。
                </small>
              </span>
            </div>
            <button
              className="button button--secondary"
              disabled={Boolean(busyAction)}
              onClick={() => {
                setError(undefined)
                void window.studio
                  .studioProject!.loadDemoData()
                  .then((components) =>
                    setDemoFeedback(`已加载 ${components.length} 个本地演示组件。`),
                  )
                  .catch((demoError: unknown) =>
                    setError(demoError instanceof Error ? demoError.message : '无法加载演示数据。'),
                  )
              }}
              type="button"
            >
              加载演示数据
            </button>
            {demoFeedback ? (
              <div className="maintenance-feedback" role="status">
                <CheckCircle aria-hidden="true" size={20} weight="fill" />
                <span>{demoFeedback}</span>
              </div>
            ) : null}
          </section>

          <section
            aria-labelledby="restore-title"
            className="maintenance-section maintenance-section--warning"
          >
            <header className="maintenance-section__header">
              <ClockCounterClockwise aria-hidden="true" size={22} />
              <div>
                <h2 id="restore-title">从备份恢复</h2>
                <p>先检查清单、文件哈希、SQLite 完整性和 schema 兼容性，确认后才会重启应用。</p>
              </div>
            </header>
            <button
              className="button button--secondary"
              disabled={Boolean(busyAction)}
              onClick={() => void selectRestore()}
              type="button"
            >
              <FolderOpen aria-hidden="true" size={17} />
              {busyAction === 'select' ? '正在检查备份…' : '选择备份并检查'}
            </button>

            {restorePreview ? (
              <div className="restore-preview" aria-live="polite">
                <div className="restore-preview__status">
                  <CheckCircle aria-hidden="true" size={20} weight="fill" />
                  <span>
                    <strong>备份检查通过</strong>
                    <small>{restorePreview.backupName}</small>
                  </span>
                </div>
                <dl className="maintenance-facts maintenance-facts--compact">
                  <div>
                    <dt>创建时间</dt>
                    <dd>{new Date(restorePreview.createdAt).toLocaleString('zh-CN')}</dd>
                  </div>
                  <div>
                    <dt>数据版本</dt>
                    <dd>
                      v{restorePreview.sourceDatabaseSchemaVersion}
                      {restorePreview.migrationRequired
                        ? `，重启后迁移至 v${restorePreview.targetDatabaseSchemaVersion}`
                        : '，无需迁移'}
                    </dd>
                  </div>
                  <div>
                    <dt>内容</dt>
                    <dd>
                      {restorePreview.fileCount} 个文件，{formatBytes(restorePreview.sizeBytes)}
                    </dd>
                  </div>
                </dl>
                <label className="restore-confirmation">
                  <input
                    checked={restoreConfirmed}
                    disabled={busyAction === 'restore'}
                    onChange={(event) => setRestoreConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    我了解当前 SQLite、工作空间和产物将被替换。Studio 会先创建一份自动回滚备份。
                  </span>
                </label>
                <button
                  className="button button--danger"
                  disabled={!restoreConfirmed || Boolean(busyAction)}
                  onClick={() => void restore()}
                  type="button"
                >
                  <ClockCounterClockwise aria-hidden="true" size={17} />
                  {busyAction === 'restore' ? '正在准备恢复…' : '恢复备份并重启'}
                </button>
              </div>
            ) : null}
          </section>

          {error && loadState === 'ready' ? (
            <div className="maintenance-error" role="alert">
              <WarningCircle aria-hidden="true" size={19} />
              <span>{error}</span>
            </div>
          ) : null}
          {restartMessage ? (
            <div className="maintenance-feedback maintenance-feedback--restart" role="status">
              <ClockCounterClockwise aria-hidden="true" size={20} />
              <strong>{restartMessage}</strong>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
