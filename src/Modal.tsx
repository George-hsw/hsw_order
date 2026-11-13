import { useLayoutEffect, useRef, type MouseEventHandler, type ReactNode } from 'react'

interface Props {
  labelledBy: string
  onClose: () => void // Escape and the platform back gesture
  describedBy?: string
  className?: string // extra classes after "modal", e.g. "confirm"
  role?: 'alertdialog'
  onClick?: MouseEventHandler<HTMLDialogElement>
  children: ReactNode
}

/**
 * A modal popup on the native <dialog>: the browser makes the page behind it inert, keeps focus inside, closes on Escape and the back
 * gesture, and returns focus to the button that opened it. It looks exactly as before (.modal / .modalbox in styles.css).
 * Put data-autofocus on the element that should take focus first; otherwise the first control does.
 */
export default function Modal({ labelledBy, onClose, describedBy, className, role, onClick, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (!d.open) d.showModal()
    const first = d.querySelector<HTMLElement>('[data-autofocus]')
    if (first) first.focus()
    else {
      // The browser would put focus on the close button, which draws a ring before anyone has touched it: start on the heading instead.
      const h = d.querySelector<HTMLElement>('h2')
      if (h && document.activeElement?.classList.contains('modal-x')) { h.tabIndex = -1; h.focus() }
    }
    return () => { if (d.open) d.close() }
  }, [])

  // stopPropagation on cancel: React passes the event up to the popup behind this one, which would close it too.
  return (
    <dialog ref={ref} className={className ? `modal ${className}` : 'modal'} role={role} aria-labelledby={labelledBy} aria-describedby={describedBy}
      onCancel={(e) => { e.preventDefault(); e.stopPropagation(); closeRef.current() }} onClick={onClick}>
      {children}
    </dialog>
  )
}
