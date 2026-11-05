import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean // a delete or other step that cannot be undone: the button is red and focus starts on Cancel
}

/**
 * An in-app replacement for window.confirm. `ask(...)` resolves true or false; render `dialog` once in the component.
 *   const [ask, dialog] = useConfirm()
 *   if (!(await ask({ title: 'Delete Sam?', confirmLabel: 'Delete', danger: true }))) return
 */
export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((v: boolean) => void) | null>(null)

  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current?.(false)
    resolver.current = resolve
    setOpts(o)
  }), [])
  const answer = useCallback((v: boolean) => {
    resolver.current?.(v)
    resolver.current = null
    setOpts(null)
  }, [])

  useEffect(() => {
    if (!opts) return
    // Capture phase, so Escape closes only this dialog and not the popup underneath it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); answer(false) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [opts, answer])

  const dialog = opts && (
    <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={opts.body ? 'confirm-body' : undefined}>
      <div className="modalbox">
        <h2 id="confirm-title">{opts.title}</h2>
        {opts.body && <div id="confirm-body" className="confirm-body">{opts.body}</div>}
        <div className="actions">
          <button type="button" className="btn" autoFocus={opts.danger} onClick={() => answer(false)}>{opts.cancelLabel ?? 'Cancel'}</button>
          <button type="button" className={'btn ' + (opts.danger ? 'danger-fill' : 'primary')} autoFocus={!opts.danger} onClick={() => answer(true)}>{opts.confirmLabel}</button>
        </div>
      </div>
    </div>
  )
  return [ask, dialog]
}
