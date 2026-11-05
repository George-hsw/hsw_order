import { useState } from 'react'
import { useToast } from './Toast'
import { groupByVendor, money, navText } from './lib/order'
import { useEscape } from './lib/useEscape'
import type { OrderLine } from './lib/supabase'

interface Props {
  lines: OrderLine[]
  wasCopied: boolean
  onCopied: () => void // first copy: the order is marked Copied
  onOrdered: (navRef: string) => void
  onClose: () => void
}

/** Writes text to the clipboard. Falls back to a hidden textarea where the Clipboard API is blocked (older iPhones, plain http). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { /* ignore */ }
    ta.remove()
    return ok
  }
}

/** Copy for NAV: one block per vendor to paste into NAV, then the NAV order number once it is entered. */
export default function CopyDialog({ lines, wasCopied, onCopied, onOrdered, onClose }: Props) {
  const toast = useToast()
  const groups = groupByVendor(lines)
  const [header, setHeader] = useState(false)
  const [done, setDone] = useState<string[]>([]) // vendors copied in this visit
  const [ref, setRef] = useState('')
  useEscape(onClose)

  const copy = async (vendor: string) => {
    const g = groups.find((x) => x.vendor === vendor)!
    if (await copyText(navText(g, header))) {
      setDone((d) => (d.includes(vendor) ? d : [...d, vendor]))
      if (!wasCopied && done.length === 0) onCopied()
      toast.success(`Copied ${g.lines.length} ${g.lines.length === 1 ? 'line' : 'lines'} for ${vendor}. Paste them into NAV.`)
    } else toast.error('Could not copy. Select the lines and copy them by hand.')
  }

  const valid = ref.trim().length > 0

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="copy-title">
      <div className="modalbox wide">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="copy-title">Copy for NAV</h2>
        <p className="muted">Copy the lines, paste them into the NAV purchase order for this vendor, then enter the NAV order number below.</p>

        <ul className="people vendors">
          {groups.map((g) => (
            <li key={g.vendor}>
              <div className="who-line">
                <b>{g.vendor}</b>
                <span className="muted">{g.totals.lines} {g.totals.lines === 1 ? 'line' : 'lines'}, {g.totals.units} units, {money(g.totals.cost)}</span>
                {done.includes(g.vendor) && <span className="chip paid">Copied</span>}
              </div>
              <div className="person-actions">
                <button type="button" className="btn" onClick={() => copy(g.vendor)}>{done.includes(g.vendor) ? 'Copy again' : 'Copy'}</button>
              </div>
            </li>
          ))}
        </ul>
        <label className="inline"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Include column headings</label>

        <form className="addperson" onSubmit={(e) => { e.preventDefault(); if (valid) onOrdered(ref.trim()) }}>
          <h3>Entered in NAV?</h3>
          <div className="grid one">
            <label>NAV order number
              <input name="navRef" autoComplete="off" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="PO-004512" />
            </label>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>Not yet</button>
            <button type="submit" className="btn primary" disabled={!valid}>Mark as ordered</button>
          </div>
        </form>
      </div>
    </div>
  )
}
