import { useState } from 'react'
import Modal from './Modal'
import { useConfirm } from './Confirm'
import { useToast } from './Toast'
import { api } from './lib/api'
import { trackError } from './lib/analytics/track'
import { useLoad } from './lib/useLoad'
import { money } from './lib/order'
import { byImpact, countTotals, fmtDiff, fmtQty, scopeLabel, variance } from './lib/stocktake'
import type { CountLine, CountRow } from './lib/supabase'

interface Props {
  count: CountRow
  lines: CountLine[]
  canManage: boolean // a manager (or the admin) may treat uncounted items as zero
  onRecount: (l: CountLine) => void
  onBack: () => void // back to counting
  onSaved: (c: CountRow) => void // the count is saved: Copy for NAV comes next
}

const UNCOUNTED_SHOWN = 300

/** The end of a count: the totals, then Review the differences or Save. A full count also lists what was never scanned. */
export default function CountFinish({ count, lines, canManage, onRecount, onBack, onSaved }: Props) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [step, setStep] = useState<'choose' | 'review'>('choose')
  const [busy, setBusy] = useState(false)
  const t = countTotals(lines)
  const full = count.kind === 'full'
  const uncounted = useLoad(() => api.uncounted(count.id, UNCOUNTED_SHOWN), [count.id, lines.length], full)

  const save = async () => {
    if (busy) return
    if (full && uncounted.data && uncounted.data.total > 0 && !(await ask({
      title: `${uncounted.data.total} ${uncounted.data.total === 1 ? 'item was' : 'items were'} not counted`,
      body: <p>They have stock on the system but nobody scanned them. Saving leaves their stock exactly as it is: no adjustment is made for them.</p>,
      confirmLabel: 'Save anyway', cancelLabel: 'Keep counting',
    }))) return
    setBusy(true)
    try { onSaved(await api.setCountStatus(count.id, 'saved')) } catch (e) { trackError('count save', e); toast.error('Could not save the count. Try again.'); setBusy(false) }
  }

  const zero = async () => {
    const n = uncounted.data?.total ?? 0
    if (!(await ask({
      title: `Treat ${n} ${n === 1 ? 'item' : 'items'} as zero?`,
      body: <p>Every item with stock on the system that was not scanned will be counted as 0, so NAV gets a negative adjustment for all of it. Only do this if the whole store really has been counted.</p>,
      confirmLabel: 'Treat as zero', danger: true,
    }))) return
    setBusy(true)
    try { const added = await api.zeroUncounted(count.id); toast.success(`${added} ${added === 1 ? 'item' : 'items'} counted as zero.`) } catch (e) { trackError('count zero', e); toast.error('Could not do that. Try again.') } finally { setBusy(false) }
  }

  const shown = byImpact(lines).filter((l) => variance(l) !== 0)

  return (
    <Modal labelledBy="finish-title" onClose={onBack}>
      <div className="modalbox wide panel">
        <button type="button" className="modal-x" aria-label="Back to counting" onClick={onBack}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="finish-title">{step === 'choose' ? 'Finish this count' : 'Review the differences'}</h2>
        <p className="muted">{scopeLabel(count)}{count.name ? `, ${count.name}` : ''}</p>

        <dl className="facts">
          <div><dt>Items counted</dt><dd className="num">{t.counted}</dd></div>
          <div><dt>Matched the system</dt><dd className="num">{t.matched}</dd></div>
          <div><dt>Differences</dt><dd className="num">{t.differ}</dd></div>
          <div><dt>More than the system</dt><dd className="num">+{fmtQty(t.gainUnits)} <small>({money(t.gainValue)})</small></dd></div>
          <div><dt>Fewer than the system</dt><dd className="num">−{fmtQty(t.lossUnits)} <small>({money(t.lossValue)})</small></dd></div>
        </dl>
        <p className="muted facts-note">Values are at store cost, ex GST.</p>

        {full && uncounted.data && uncounted.data.total > 0 && (
          <div className="note">
            <p><b>{uncounted.data.total} {uncounted.data.total === 1 ? 'item has' : 'items have'} stock on the system but {uncounted.data.total === 1 ? 'was' : 'were'} not scanned.</b> They are left alone unless you decide otherwise.</p>
            <ul className="uncounted">
              {uncounted.data.items.slice(0, 5).map((u) => <li key={u.item_code}><span className="num">{u.item_code}</span> {u.description} <span className="muted">(system {fmtQty(u.inventory)})</span></li>)}
            </ul>
            {uncounted.data.total > 5 && <p className="muted">…and {uncounted.data.total - 5} more, the highest value first.</p>}
            {canManage
              ? <div className="actions"><button type="button" className="btn danger" onClick={() => void zero()} disabled={busy}>Treat all {uncounted.data.total} as zero</button></div>
              : <p className="muted">Only a manager can treat uncounted items as zero.</p>}
          </div>
        )}
        {full && uncounted.failed && <p className="note bad">Could not check for items that were not counted. <button type="button" className="linkish" onClick={uncounted.retry}>Try again</button></p>}

        {step === 'review' && (
          shown.length === 0 ? (
            <div className="state compact"><p>Every counted item matched the system</p></div>
          ) : (
            <div className="tablewrap">
              <table className="book counted">
                <thead><tr><th>Item</th><th>Description</th><th className="r">System</th><th className="r">Counted</th><th className="r">Difference</th><th className="r">Value</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {shown.map((l) => {
                    const d = variance(l)
                    return (
                      <tr key={l.id}>
                        <td data-label="Item" className="num">{l.item_code}</td>
                        <td data-label="Description">{l.description}</td>
                        <td data-label="System" className="r num">{fmtQty(l.system_qty)}</td>
                        <td data-label="Counted" className="r num">{l.counted}</td>
                        <td data-label="Difference" className="r num"><span className={'chip ' + (d < 0 ? 'bad' : 'warn')}>{fmtDiff(d)}</span></td>
                        <td data-label="Value" className="r num">{money(Math.abs(d) * l.unit_cost)}</td>
                        <td className="rowactions"><button type="button" className="btn" onClick={() => onRecount(l)}>Recount</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        <div className="actions">
          <button type="button" className="btn" onClick={onBack} disabled={busy}>Back to counting</button>
          {step === 'choose' && <button type="button" className="btn" onClick={() => setStep('review')} disabled={busy}>Review differences</button>}
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy || t.counted === 0}>{busy ? 'Saving…' : 'Save count'}</button>
        </div>
      </div>
      {confirmDialog}
    </Modal>
  )
}
