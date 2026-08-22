import {
  ArrowDown,
  ArrowBendDownLeft,
  ArrowUp,
  Command,
  MagnifyingGlass,
  WarningCircle,
} from '@phosphor-icons/react'
import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import type { CommandCenterDestination, CommandCenterResult } from '../../../shared/command-center'
import { useDialogFocus } from '../useDialogFocus'

const categoryLabels: Record<CommandCenterResult['category'], string> = {
  navigation: '导航',
  action: '操作',
  project: '项目',
  agent: 'Agent',
  component: '组件',
  run: 'Run',
  experiment: '实验',
}

interface CommandPaletteProps {
  onClose: () => void
  onSelect: (destination: CommandCenterDestination) => void
}

export function CommandPalette({ onClose, onSelect }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CommandCenterResult[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string>()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listId = useId()
  const { dialogRef, trapTabKey } = useDialogFocus<HTMLElement>()

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(
      () => {
        void window.studio.commandCenter
          .search({ query })
          .then((nextResults) => {
            if (!active) return
            setResults(nextResults)
            setSelectedIndex(0)
            setStatus('ready')
          })
          .catch((searchError: unknown) => {
            if (!active) return
            setResults([])
            setError(searchError instanceof Error ? searchError.message : '无法搜索本地工作空间。')
            setStatus('error')
          })
      },
      query ? 120 : 0,
    )
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query])

  function select(result: CommandCenterResult | undefined): void {
    if (!result) return
    onSelect(result.destination)
  }

  function handleInputKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((current) => (results.length ? (current + 1) % results.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((current) =>
        results.length ? (current - 1 + results.length) % results.length : 0,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      select(results[selectedIndex])
    }
  }

  return (
    <div className="command-palette-backdrop" role="presentation">
      <section
        aria-describedby="command-palette-description"
        aria-labelledby="command-palette-title"
        aria-modal="true"
        className="command-palette"
        onKeyDown={(event) => {
          trapTabKey(event)
          if (event.key === 'Escape') onClose()
        }}
        ref={dialogRef}
        role="dialog"
      >
        <header className="command-palette__header">
          <Command aria-hidden="true" size={19} />
          <div>
            <h2 id="command-palette-title">全局搜索与操作</h2>
            <p className="sr-only" id="command-palette-description">
              搜索 Agent、组件、Run、实验和应用操作。
            </p>
          </div>
          <kbd>ESC</kbd>
        </header>
        <label className="command-palette__search">
          <span className="sr-only">搜索本地工作空间</span>
          <MagnifyingGlass aria-hidden="true" size={19} />
          <input
            aria-activedescendant={
              results[selectedIndex] ? `${listId}-${results[selectedIndex].id}` : undefined
            }
            aria-controls={listId}
            aria-expanded="true"
            aria-haspopup="listbox"
            autoFocus
            maxLength={100}
            onChange={(event) => {
              setQuery(event.target.value)
              setStatus('loading')
              setError(undefined)
            }}
            onKeyDown={handleInputKey}
            placeholder="Agent、组件、Run、实验或操作…"
            role="combobox"
            type="search"
            value={query}
          />
        </label>

        <div aria-live="polite" className="command-palette__results">
          {status === 'loading' ? (
            <div aria-busy="true" className="command-palette__message">
              正在读取本地索引…
            </div>
          ) : null}
          {status === 'error' ? (
            <div className="command-palette__message command-palette__message--error" role="alert">
              <WarningCircle aria-hidden="true" size={18} />
              <span>{error}</span>
            </div>
          ) : null}
          {status === 'ready' && results.length === 0 ? (
            <div className="command-palette__message">没有匹配的本地内容或操作。</div>
          ) : null}
          {status === 'ready' && results.length > 0 ? (
            <ul id={listId} role="listbox">
              {results.map((result, index) => (
                <li
                  aria-selected={index === selectedIndex}
                  id={`${listId}-${result.id}`}
                  key={result.id}
                  role="option"
                >
                  <button
                    className="command-palette__result"
                    onClick={() => select(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    tabIndex={-1}
                    type="button"
                  >
                    <span className="command-palette__category">
                      {categoryLabels[result.category]}
                    </span>
                    <span>
                      <strong>{result.label}</strong>
                      <small>{result.detail}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <footer className="command-palette__footer" aria-hidden="true">
          <span>
            <ArrowUp size={13} /> <ArrowDown size={13} /> 选择
          </span>
          <span>
            <ArrowBendDownLeft size={13} /> 打开
          </span>
          <span>仅搜索本机元数据</span>
        </footer>
      </section>
    </div>
  )
}
