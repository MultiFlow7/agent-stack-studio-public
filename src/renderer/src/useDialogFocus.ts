import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react'

const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocus<TElement extends HTMLElement>(): {
  dialogRef: RefObject<TElement | null>
  trapTabKey: (event: KeyboardEvent<TElement>) => void
} {
  const dialogRef = useRef<TElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) {
      dialog.querySelector<HTMLElement>(focusableSelector)?.focus()
    }
    const previous = previouslyFocused.current
    return () => {
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  function trapTabKey(event: KeyboardEvent<TElement>): void {
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector),
    )
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return { dialogRef, trapTabKey }
}
