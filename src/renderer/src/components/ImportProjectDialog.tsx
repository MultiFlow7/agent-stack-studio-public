import { FolderOpen, ShieldCheck, Warning } from '@phosphor-icons/react'
import type { ImportScan } from '../../../shared/import'
import { useDialogFocus } from '../useDialogFocus'

interface ImportProjectDialogProps {
  scan: ImportScan
  isImporting: boolean
  error?: string
  onCancel: () => void
  onConfirm: () => void
}

export function ImportProjectDialog({
  scan,
  isImporting,
  error,
  onCancel,
  onConfirm,
}: ImportProjectDialogProps) {
  const { dialogRef, trapTabKey } = useDialogFocus<HTMLElement>()
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby="import-description"
        aria-labelledby="import-title"
        aria-modal="true"
        className="modal import-modal"
        ref={dialogRef}
        role="dialog"
        onKeyDown={(event) => {
          trapTabKey(event)
          if (event.key === 'Escape' && !isImporting) onCancel()
        }}
      >
        <header className="modal__header">
          <h2 id="import-title">确认静态扫描结果</h2>
          <p id="import-description">Studio 只检查了文件，没有执行任何项目代码。</p>
        </header>
        <div className="import-summary">
          <div className="import-path">
            <FolderOpen aria-hidden="true" size={22} />
            <span>
              <strong>{scan.suggestedName}</strong>
              <small>{scan.sourcePath}</small>
            </span>
          </div>
          <div className="safety-note">
            <ShieldCheck aria-hidden="true" size={19} weight="fill" />
            <span>静态检查已完成</span>
          </div>
          <section aria-labelledby="scan-evidence-title" className="evidence-section">
            <h3 id="scan-evidence-title">发现的项目特征</h3>
            {scan.evidence.length > 0 ? (
              <ul>
                {scan.evidence.map((item, index) => (
                  <li key={`${item.path}-${item.detail}-${index}`}>
                    <span>{item.path}</span>
                    <strong>{item.detail}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p>未发现可识别的项目特征。导入后需要手动检查 Agent。</p>
            )}
          </section>
          {scan.warnings.map((warning) => (
            <div className="warning-note" key={warning}>
              <Warning aria-hidden="true" size={18} />
              <span>{warning}</span>
            </div>
          ))}
          {error ? (
            <div className="error-summary" role="alert">
              <strong>导入未完成</strong>
              <span>{error}</span>
            </div>
          ) : null}
        </div>
        <footer className="modal__footer modal__footer--separated">
          <button
            className="button button--secondary"
            disabled={isImporting}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="button button--primary"
            disabled={isImporting}
            onClick={onConfirm}
            type="button"
          >
            {isImporting ? '正在导入…' : '导入为 Agent'}
          </button>
        </footer>
      </section>
    </div>
  )
}
