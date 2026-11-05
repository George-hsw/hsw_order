import { useRef, useState } from 'react'
import { useConfirm } from './Confirm'
import { useToast } from './Toast'
import { groupByVendor, money, navColumn, navText } from './lib/order'
import { useEscape } from './lib/useEscape'
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

type Part = 'no' | 'qty' | 'full'

/**
 * Copy for NAV. Two copies per vendor: the item numbers (pasted into the No. column, so NAV fills in the rest itself) and then the
 * quantities (pasted into the Quantity column). A one-paste full-line copy (every in-between cell filled, none empty) is under
 * "Other ways to copy". Then the NAV order number once it is entered.
 */
export default function CopyDialog({ lines, wasCopied, onCopied, onOrdered, onDelete, onClose }: Props) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const groups = groupByVendor(lines)
  const [copied, setCopied] = useState<string[]>([]) // 'vendor|no', 'vendor|qty', 'vendor|full': what was copied in this visit
  const [ref, setRef] = useState('')
  const startedCopied = useRef(wasCopied) // was the order already copied before this dialog opened?
  const markedCopied = useRef(false)
  const asked = useRef(false)
  useEscape(onClose)

  const has = (vendor: string, part: Part) => copied.includes(`${vendor}|${part}`)

  const copy = async (vendor: string, part: Part) => {
    const g = groups.find((x) => x.vendor === vendor)!
    const text = part === 'full' ? navText(g, false, true) : navColumn(g, part)
    if (!(await copyText(text))) return toast.error('Could not copy. Select the lines and copy them by hand.')

    const next = [...new Set([...copied, `${vendor}|${part}`])]
    setCopied(next)
    if (!startedCopied.current && !markedCopied.current) { markedCopied.current = true; onCopied() }
    const n = g.lines.length
    toast.success(part === 'no' ? `Copied ${n} item ${n === 1 ? 'number' : 'numbers'}. Paste them into the No. column.`
      : part === 'qty' ? `Copied ${n} ${n === 1 ? 'quantity' : 'quantities'}. Paste them into the Quantity column.`
        : `Copied ${n} ${n === 1 ? 'line' : 'lines'} for ${vendor}.`)

    // Once both columns have been copied for the first time, offer to delete the order: some stores only need the app to get the lines into NAV.
    const both = (next.includes(`${vendor}|no`) && next.includes(`${vendor}|qty`)) || next.includes(`${vendor}|full`)
    if (both && !startedCopied.current && !asked.current) {
      asked.current = true
      if (await ask({
        title: 'Copied for NAV',
        body: <p>Everything has been copied. Do you want to delete this order now, or keep it to record the NAV order number?</p>,
        confirmLabel: 'Delete order', cancelLabel: 'Keep it', danger: true,
      })) await onDelete()
    }
  }

  const valid = ref.trim().length > 0

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="copy-title">
      <div className="modalbox wide">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="copy-title">Copy for NAV</h2>
        <ol className="copysteps">
          <li>Copy the item numbers, click the first empty No. cell on the NAV purchase order and paste. NAV fills in the description, unit and cost itself.</li>
          <li>Copy the quantities, click the Quantity cell on the first of those lines and paste.</li>
        </ol>

        <ul className="people vendors">
          {groups.map((g) => (
            <li key={g.vendor}>
              <div className="who-line">
                <b>{g.vendor}</b>
                <span className="muted">{g.totals.lines} {g.totals.lines === 1 ? 'line' : 'lines'}, {g.totals.units} units, {money(g.totals.cost)}</span>
              </div>
              <div className="person-actions">
                <button type="button" className="btn" onClick={() => copy(g.vendor, 'no')}>1. Copy item numbers</button>
                {has(g.vendor, 'no') && <span className="chip paid">Copied</span>}
              </div>
              <div className="person-actions">
                <button type="button" className="btn" onClick={() => copy(g.vendor, 'qty')}>2. Copy quantities</button>
                {has(g.vendor, 'qty') && <span className="chip paid">Copied</span>}
              </div>
            </li>
          ))}
        </ul>

        <details className="storedetails">
          <summary>Other ways to copy</summary>
          <p className="muted">One paste for everything: Type, No., Vendor Item No., Description, Unit of Measure and Quantity, with only Variant and Inventory left empty. Paste it into the first empty line of the NAV purchase order. If NAV asks about a description, use the two steps above instead.</p>
          <div className="actions">
            {groups.map((g) => <button key={g.vendor} type="button" className="btn" onClick={() => copy(g.vendor, 'full')}>Copy full lines for {g.vendor}</button>)}
          </div>
        </details>

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
    </div>
  )
}
