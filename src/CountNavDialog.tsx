import { useMemo, useState } from 'react'
import Modal from './Modal'
import { copyText } from './CopyDialog'
import { useToast } from './Toast'
import { api } from './lib/api'
import { trackError } from './lib/analytics/track'
import { money } from './lib/order'
import { SIDE_HELP, SIDE_LABEL, fmtQty, navAdjustText, sideTotals, sidesToPost, splitAdjustments, variance, type Side } from './lib/stocktake'
import type { CountLine, CountRow } from './lib/supabase'

interface Props {
  count: CountRow
  lines: CountLine[]
  locationCode: string // the store's NAV location code
  onChanged: (c: CountRow) => void // a journal was recorded (the count may now be posted)
  onClose: () => void
}

const SIDES: Side[] = ['positive', 'negative']

/** Copy for NAV, for a stock take: a Positive adjustment tab and a Negative adjustment tab, because NAV takes them as two item journal entry types. */
export default function CountNavDialog({ count, lines, locationCode, onChanged, onClose }: Props) {
  const toast = useToast()
  const split = useMemo(() => splitAdjustments(lines), [lines])
  const [tab, setTab] = useState<Side>(() => sidesToPost(count, split)[0] ?? 'positive')
  const [copied, setCopied] = useState<Side[]>([])
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)

  const mine = split[tab]
  const totals = sideTotals(mine)
  const entered = tab === 'positive' ? count.nav_pos_ref : count.nav_neg_ref

  // Arrow keys move between the two tabs, and focus follows the selection.
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const to: Side = e.key === 'ArrowLeft' || e.key === 'Home' ? 'positive' : 'negative'
    setTab(to)
    document.getElementById(`navtab-${to}`)?.focus()
  }

  const copy = async () => {
    if (!(await copyText(navAdjustText(lines, tab, locationCode)))) return toast.error('Could not copy. Select the lines and copy them by hand.')
    setCopied((c) => (c.includes(tab) ? c : [...c, tab]))
    toast.success(`Copied ${mine.length} ${mine.length === 1 ? 'line' : 'lines'}. Paste them into a NAV item journal as ${tab === 'positive' ? 'Positive Adjmt.' : 'Negative Adjmt.'} entries.`)
  }

  const record = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ref.trim() || busy) return
    setBusy(true)
    try {
      const next = await api.postCountSide(count.id, tab, ref.trim())
      onChanged(next)
      setRef('')
      toast.success(next.status === 'posted' ? 'Both adjustments are entered in NAV. This count is complete.' : `${SIDE_LABEL[tab]} recorded.`)
      const other = sidesToPost(next, split)[0]
      if (other) setTab(other)
    } catch (err) { trackError('count nav', err); toast.error('Could not record that. Try again.') } finally { setBusy(false) }
  }

  return (
    <Modal labelledBy="countnav-title" onClose={onClose}>
      <div className="modalbox wide panel">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="countnav-title">Copy for NAV</h2>
        <p className="muted">NAV takes gains and losses as two kinds of item journal entry. Copy one tab, paste it into an item journal, then do the other.</p>

        <div className="segmented" role="tablist" aria-label="Which adjustment" onKeyDown={onTabKey}>
          {SIDES.map((s) => (
            <button key={s} type="button" role="tab" id={`navtab-${s}`} aria-selected={tab === s} tabIndex={tab === s ? 0 : -1} onClick={() => setTab(s)}>
              {s === 'positive' ? 'Positive' : 'Negative'} ({split[s].length})
            </button>
          ))}
        </div>

        <div role="tabpanel" aria-labelledby={`navtab-${tab}`}>
        <p className="muted facts-note">{SIDE_HELP[tab]}</p>

        {mine.length === 0 ? (
          <div className="state compact"><p>Nothing to adjust</p><p className="muted">No item came out {tab === 'positive' ? 'above' : 'below'} the system in this count.</p></div>
        ) : (
          <>
            <p><b>{totals.lines} {totals.lines === 1 ? 'line' : 'lines'}, {fmtQty(totals.units)} units, {money(totals.value)}</b> at store cost {entered && <span className="chip paid">Entered in NAV</span>} {!entered && copied.includes(tab) && <span className="chip quote">Copied</span>}</p>
            <div className="tablewrap">
              <table className="book detail">
                <thead><tr><th>Item</th><th>Description</th><th className="r">Qty</th><th className="r">Cost</th></tr></thead>
                <tbody>
                  {mine.map((l) => (
                    <tr key={l.id}>
                      <td data-label="Item" className="num">{l.item_code}</td>
                      <td data-label="Description">{l.description}</td>
                      <td data-label="Qty" className="r num">{fmtQty(Math.abs(variance(l)))}</td>
                      <td data-label="Cost" className="r num">{money(Math.abs(variance(l)) * l.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions"><button type="button" className="btn primary" onClick={() => void copy()}>{copied.includes(tab) ? 'Copy again' : `Copy ${SIDE_LABEL[tab].toLowerCase()}`}</button></div>

            {entered ? (
              <p className="note">Entered in NAV as <span className="num">{entered}</span>.</p>
            ) : (
              <form className="addperson" onSubmit={record}>
                <h3>Entered in NAV?</h3>
                <div className="grid one">
                  <label>NAV journal batch or document number
                    <input name="navRef" autoComplete="off" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="STOCKTAKE-001" />
                  </label>
                </div>
                <div className="actions">
                  <button type="button" className="btn" onClick={onClose}>Not yet</button>
                  <button type="submit" className="btn primary" disabled={!ref.trim() || busy}>{busy ? 'Saving…' : 'Mark as entered'}</button>
                </div>
              </form>
            )}
          </>
        )}
        </div>
        {count.status === 'posted' && <p className="note">Both adjustments are entered in NAV. This count is complete.</p>}
      </div>
    </Modal>
  )
}
