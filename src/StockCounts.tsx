import { useMemo, useState } from 'react'
import Modal from './Modal'
import CountNavDialog from './CountNavDialog'
import { useConfirm } from './Confirm'
import { useToast } from './Toast'
import { api } from './lib/api'
import { trackError } from './lib/analytics/track'
import { money } from './lib/order'
import { byImpact, fmtDiff, fmtQty, scopeLabel, variance } from './lib/stocktake'
import { useLoad } from './lib/useLoad'
import type { CountLine, CountStatus, CountSummary, StoreRow } from './lib/supabase'

interface Props { multi: boolean; stores: StoreRow[]; names: Record<string, string> }

const when = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
const STATUS_LABEL: Record<CountStatus, string> = { open: 'Counting', saved: 'Waiting for NAV', posted: 'In NAV' }
const STATUS_CHIP: Record<CountStatus, string> = { open: 'quote', saved: 'warn', posted: 'paid' }
type Filter = 'all' | CountStatus

/** Every stock take for the store, newest first. Open a saved one to copy its adjustments for NAV, or to look back at what was found. */
export default function StockCounts({ multi, stores, names }: Props) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [status, setStatus] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const counts = useLoad(() => api.listCounts(stores.map((s) => s.id)), [stores])
  const who = (e: string | null) => (e ? names[e.toLowerCase()] ?? e : '–')

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (counts.data ?? []).filter((c) => (status === 'all' || c.status === status) &&
      (!term || [scopeLabel(c), c.store_name, c.nav_pos_ref, c.nav_neg_ref, c.created_by].some((v) => v?.toLowerCase().includes(term))))
  }, [counts.data, status, q])
  const open = counts.data?.find((c) => c.id === openId) ?? null

  const remove = async (c: CountSummary) => {
    if (!(await ask({ title: `Delete this ${scopeLabel(c).toLowerCase()}?`, body: <p>{c.lines} {c.lines === 1 ? 'item' : 'items'} counted at {c.store_name} will be removed. This cannot be undone.</p>, confirmLabel: 'Delete count', danger: true }))) return
    try { await api.deleteCount(c.id); toast.success('Count deleted.'); counts.retry() } catch (e) { trackError('counts', e); toast.error('Could not delete the count. Try again.') }
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Counts</h1>
          <p className="muted">Every stock take for your {multi ? 'stores' : 'store'}, newest first.</p>
        </div>
      </div>

      <div className="filters">
        <input type="search" name="countSearch" aria-label="Search counts" placeholder="Search by vendor, category, NAV number, person or store…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="segmented" role="group" aria-label="Status">
          {(['all', 'open', 'saved', 'posted'] as const).map((s) => <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s === 'all' ? 'All' : STATUS_LABEL[s]}</button>)}
        </div>
      </div>

      {counts.failed ? (
        <div className="state error" role="alert"><p>Counts did not load</p><p className="muted">Check your connection and try again.</p><div className="actions"><button type="button" className="btn" onClick={counts.retry}>Try again</button></div></div>
      ) : counts.loading ? (
        <div className="skeleton" aria-busy="true" aria-label="Loading counts"><i /><i /><i /><i /></div>
      ) : shown.length === 0 ? (
        <div className="state"><p>{(counts.data ?? []).length === 0 ? 'No stock takes yet' : 'No counts match'}</p>
          <p className="muted">{(counts.data ?? []).length === 0 ? 'Start one on the Count tab.' : 'Try a different search or status.'}</p></div>
      ) : (
        <div className="tablewrap">
          <table className="book counts">
            <thead><tr><th>Started</th>{multi && <th>Store</th>}<th>Count</th><th>By</th><th>Status</th><th className="r">Items</th><th className="r">Differ</th><th className="r">More</th><th className="r">Fewer</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td data-label="Started">{when(c.created_at)}</td>
                  {multi && <td data-label="Store">{c.store_name}</td>}
                  <td data-label="Count"><b>{scopeLabel(c)}</b></td>
                  <td data-label="By">{who(c.created_by)}</td>
                  <td data-label="Status"><span className={'chip ' + STATUS_CHIP[c.status]}>{STATUS_LABEL[c.status]}</span></td>
                  <td data-label="Items" className="r num">{c.lines}</td>
                  <td data-label="Differ" className="r num">{c.differ}</td>
                  <td data-label="More" className="r num">{money(c.gain_value)}</td>
                  <td data-label="Fewer" className="r num">{money(c.loss_value)}</td>
                  <td className="rowactions">
                    {c.status === 'open' ? <span className="muted">Continue on the Count tab</span> : <button type="button" className="btn" onClick={() => setOpenId(c.id)}>Open</button>}
                    {c.status !== 'posted' && <button type="button" className="btn danger" onClick={() => void remove(c)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <CountDetail count={open} store={stores.find((s) => s.id === open.store_id)} who={who} onClose={() => setOpenId(null)} onChanged={counts.retry} />}
      {confirmDialog}
    </>
  )
}

/** One saved count: what was found, with Copy for NAV. */
function CountDetail({ count, store, who, onClose, onChanged }: { count: CountSummary; store: StoreRow | undefined; who: (e: string | null) => string; onClose: () => void; onChanged: () => void }) {
  const [nav, setNav] = useState(false)
  const [current, setCurrent] = useState(count)
  const lines = useLoad<CountLine[]>(() => api.countLines(count.id), [count.id])
  const differences = byImpact(lines.data ?? []).filter((l) => variance(l) !== 0)

  return (
    <Modal labelledBy="countdetail-title" onClose={onClose}>
      <div className="modalbox wide panel">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="countdetail-title">{count.store_name}, {scopeLabel(count)}, {when(count.created_at)}</h2>
        <p className="muted"><span className={'chip ' + STATUS_CHIP[current.status]}>{STATUS_LABEL[current.status]}</span> Started by {who(count.created_by)}.</p>
        {current.nav_pos_ref && <p className="muted">Positive adjustment entered as <span className="num">{current.nav_pos_ref}</span>.</p>}
        {current.nav_neg_ref && <p className="muted">Negative adjustment entered as <span className="num">{current.nav_neg_ref}</span>.</p>}

        {lines.failed ? <div className="state error"><p>The lines did not load</p></div>
          : lines.loading ? <div className="skeleton" aria-busy="true"><i /><i /></div>
          : differences.length === 0 ? <div className="state compact"><p>Every counted item matched the system</p></div>
          : (
            <div className="tablewrap">
              <table className="book counted">
                <thead><tr><th>Item</th><th>Description</th><th className="r">System</th><th className="r">Counted</th><th className="r">Difference</th><th className="r">Value</th></tr></thead>
                <tbody>
                  {differences.map((l) => {
                    const d = variance(l)
                    return (
                      <tr key={l.id}>
                        <td data-label="Item" className="num">{l.item_code}</td>
                        <td data-label="Description">{l.description}</td>
                        <td data-label="System" className="r num">{fmtQty(l.system_qty)}</td>
                        <td data-label="Counted" className="r num">{l.counted}</td>
                        <td data-label="Difference" className="r num"><span className={'chip ' + (d < 0 ? 'bad' : 'warn')}>{fmtDiff(d)}</span></td>
                        <td data-label="Value" className="r num">{money(Math.abs(d) * l.unit_cost)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Close</button>
          {lines.data && differences.length > 0 && <button type="button" className="btn primary" onClick={() => setNav(true)}>Copy for NAV</button>}
        </div>
        {nav && lines.data && <CountNavDialog count={current} lines={lines.data} onChanged={(c) => { setCurrent({ ...current, ...c }); onChanged() }} onClose={() => setNav(false)} />}
      </div>
    </Modal>
  )
}
