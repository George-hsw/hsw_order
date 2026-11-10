import { useEffect, useId, useRef, useState } from 'react'
import { money } from './lib/order'
import type { MovCheck } from './lib/mov'

/**
 * A small "Review" flag shown when an order is under the supplier's minimum order value. Pressing it opens the working: how far the order is
 * from the minimum, what is missing, and any fee the supplier charges. It never stops anything; the order can still be copied.
 * `float` opens the panel above the flag instead of below it, for the bar fixed to the bottom of the phone screen.
 */
export default function MovFlag({ check, total, float = false }: { check: MovCheck; total: number; float?: boolean }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', away)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', away) }
  }, [open])

  const share = Math.min(1, Math.max(0, total / check.mov))
  return (
    <span className={'movflag' + (float ? ' float' : '')} ref={box}>
      <button type="button" className="movflag-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <svg className="movflag-i" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3.5 14V2.5m0 0h8l-1.8 3 1.8 3h-8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Review: below minimum
      </button>
      {open && (
        <div className="movflag-panel" id={id} role="region" aria-label="Minimum order value">
          <p className="movflag-title">Under this supplier’s minimum order value</p>
          <div className="movflag-meter" role="img" aria-label={`${money(total)} of ${money(check.mov)}`}><span style={{ transform: `scaleX(${share})` }} /></div>
          <dl className="movflag-figs">
            <div><dt>Order so far</dt><dd className="num">{money(total)}</dd></div>
            <div><dt>Minimum</dt><dd className="num">{money(check.mov)}</dd></div>
            <div className="need"><dt>Still to add</dt><dd className="num">{money(check.short)}</dd></div>
          </dl>
          <p className="muted">Amounts exclude GST.{check.note ? ` Supplier terms: ${check.note}.` : ''} You can still copy this order, but add more items to reach the minimum first if you can.</p>
        </div>
      )}
    </span>
  )
}
