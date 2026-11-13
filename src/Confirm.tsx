import { useCallback, useRef, useState, type ReactNode } from 'react'
import Modal from './Modal'

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


  const dialog = opts && (
    <Modal className="confirm" role="alertdialog" labelledBy="confirm-title" describedBy={opts.body ? 'confirm-body' : undefined} onClose={() => answer(false)}>
      <div className="modalbox">
        <h2 id="confirm-title">{opts.title}</h2>
        {opts.body && <div id="confirm-body" className="confirm-body">{opts.body}</div>}
        <div className="actions">
          <button type="button" className="btn" data-autofocus={opts.danger ? '' : undefined} onClick={() => answer(false)}>{opts.cancelLabel ?? 'Cancel'}</button>
          <button type="button" className={'btn ' + (opts.danger ? 'danger-fill' : 'primary')} data-autofocus={opts.danger ? undefined : ''} onClick={() => answer(true)}>{opts.confirmLabel}</button>
        </div>
      </div>
    </Modal>
  )
  return [ask, dialog]
}
