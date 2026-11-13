import { useRef, useState } from 'react'
import Modal from './Modal'
import { useConfirm } from './Confirm'
import { useToast } from './Toast'
import { groupByVendor, money, navText } from './lib/order'
import type { OrderLine } from './lib/supabase'

interface Props {
  lines: OrderLine[]
  wasCopied: boolean
  onCopied: () => void // first copy: the order is marked Copied
  onOrdered: (navRef: string) => void
  onDelete: () => Promise<void> // the order is deleted
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

/** Copy for NAV: one copy and one paste of the order's purchase lines, then the NAV order number once it is entered. */
export default function CopyDialog({ lines, wasCopied, onCopied, onOrdered, onDelete, onClose }: Props) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const groups = groupByVendor(lines)
  const [copied, setCopied] = useState<string[]>([]) // vendors copied in this visit
  const [ref, setRef] = useState('')
  const startedCopied = useRef(wasCopied) // was the order already copied before this dialog opened?
  const asked = useRef(false)

  const copy = async (vendor: string) => {
    const g = groups.find((x) => x.vendor === vendor)!
    if (!(await copyText(navText(g)))) return toast.error('Could not copy. Select the lines and copy them by hand.')
    setCopied((c) => (c.includes(vendor) ? c : [...c, vendor]))
    if (!startedCopied.current && !asked.current) onCopied()
    toast.success(`Copied ${g.lines.length} ${g.lines.length === 1 ? 'line' : 'lines'} for ${vendor}. Paste them into NAV.`)

    // The first time an order is copied, offer to delete it: some stores only need the app to get the lines into NAV.
    if (!startedCopied.current && !asked.current) {
      asked.current = true
      if (await ask({
        title: 'Copied for NAV',
        body: <p>The lines are on your clipboard. Do you want to delete this order now, or keep it to record the NAV order number?</p>,
        confirmLabel: 'Delete order', cancelLabel: 'Keep it', danger: true,
      })) await onDelete()
    }
  }

  const valid = ref.trim().length > 0

  return (
    <Modal labelledBy="copy-title" onClose={onClose}>
      <div className="modalbox wide">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="copy-title">Copy for NAV</h2>
        <p className="muted">Copy the lines, then paste them into the first empty line of the NAV purchase order for this vendor. NAV fills in the costs.</p>

        <ul className="people vendors">
          {groups.map((g) => (
            <li key={g.vendor}>
              <div className="who-line">
                <b>{g.vendor}</b>
                <span className="muted">{g.totals.lines} {g.totals.lines === 1 ? 'line' : 'lines'}, {g.totals.units} units, {money(g.totals.cost)}</span>
                {copied.includes(g.vendor) && <span className="chip paid">Copied</span>}
              </div>
              <div className="person-actions">
                <button type="button" className="btn" onClick={() => copy(g.vendor)}>{copied.includes(g.vendor) ? 'Copy again' : 'Copy'}</button>
              </div>
            </li>
          ))}
        </ul>

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
      {confirmDialog}
    </Modal>
  )
}
