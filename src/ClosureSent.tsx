import { useMemo, useState } from 'react'
import { StatTile } from './Charts'
import { useConfirm } from './Confirm'
import Modal from './Modal'
import { useToast } from './Toast'
import type { OpsStore } from './ClosureUpload'
import { closuresApi, type ClosureDetail } from './lib/closures/api'
import { allocate } from './lib/closures/allocate'
import { REQUEST_CHIP, REQUEST_LABEL, canTakeBack, closureProgress, heldBy, leftOverAfter } from './lib/closures/status'
import { money } from './lib/order'

const whenText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')

/** A closure that has been sent: how each store answered, what is left, and a way to offer the left over to other stores. */
export default function ClosureSent({ d, stores, names, onBack, reload }: { d: ClosureDetail; stores: OpsStore[]; names: Record<string, string>; onBack: () => void; reload: () => void }) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [offering, setOffering] = useState(false)
  const storeName = (sid: string) => stores.find((s) => s.id === sid)?.name ?? 'A store'
  const person = (e: string | null) => (e ? names[e.toLowerCase()] ?? e : '')
  const closingStore = stores.find((s) => s.id === d.closure.closing_store_id)
  const progress = closureProgress(d.requests)
  const left = useMemo(() => leftOverAfter(d.lines, d.requests, d.requestLines), [d])
  const leftItems = d.lines.filter((l) => (left.get(l.item_code) ?? 0) > 0)
  const leftUnits = leftItems.reduce((n, l) => n + (left.get(l.item_code) ?? 0), 0)
  const unitsOf = (rid: string, field: 'qty_requested' | 'qty_accepted') => d.requestLines.filter((l) => l.request_id === rid).reduce((n, l) => n + (field === 'qty_requested' ? l.qty_requested : l.qty_accepted ?? 0), 0)
  const valueOf = (rid: string) => d.requestLines.filter((l) => l.request_id === rid).reduce((n, l) => n + (l.qty_accepted ?? l.qty_requested) * l.unit_cost, 0)
  const requests = [...d.requests].sort((a, b) => storeName(a.to_store_id).localeCompare(storeName(b.to_store_id)) || a.round - b.round)

  const takeBack = async (id: string, store: string) => {
    if (!(await ask({ title: `Take back the request to ${store}?`, body: <p>The store will no longer see it, and its stock goes back to what is left over.</p>, confirmLabel: 'Take it back', danger: true }))) return
    try { await closuresApi.cancelRequest(id); toast.success('Request taken back.'); reload() } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not take it back.') }
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{d.closure.name || (d.closure.kind === 'push' ? 'Push to stores' : `${closingStore?.name ?? 'Store'} closure`)}</h1>
          <p className="muted">{closingStore?.name ?? (d.closure.kind === 'push' ? 'No sending store, so stores were asked to order' : 'Closing store')}, sent {whenText(d.closure.sent_at)}{d.closure.created_by ? ` by ${person(d.closure.created_by)}` : ''}. <span className="chip paid">Sent</span></p>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={onBack}>All closures</button><button type="button" className="btn" onClick={reload}>Refresh</button></div>
      </div>

      <div className="viz-stack">
        <div className="kpis">
          <StatTile label="Waiting for an answer" value={String(progress.waiting)} ly={`of ${progress.total} ${progress.total === 1 ? 'request' : 'requests'}`} />
          <StatTile label="Accepted" value={String(progress.accepted + progress.received)} ly={`${progress.received} received`} />
          <StatTile label="Declined" value={String(progress.declined)} />
          <StatTile label="Left over" value={leftUnits.toLocaleString('en-AU')} ly={`${leftItems.length} ${leftItems.length === 1 ? 'item' : 'items'}`} />
        </div>

        <section className="sheet viz-card">
          <div className="viz-head"><div><h2>How each store answered</h2><p className="muted">Stores are told the moment a request is sent. This list updates when you refresh.</p></div></div>
          <div className="tablewrap">
            <table className="book sentreq">
              <thead><tr><th>Store</th><th>Status</th><th className="r">Asked</th><th className="r">Accepted</th><th>Answer</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>{requests.map((r) => (
                <tr key={r.id}>
                  <td data-label="Store"><b>{storeName(r.to_store_id)}</b>{r.round > 1 && <small className="sub">Offered again, round {r.round}</small>}</td>
                  <td data-label="Status"><span className={REQUEST_CHIP[r.status]}>{REQUEST_LABEL[r.status]}</span></td>
                  <td data-label="Asked" className="r">{unitsOf(r.id, 'qty_requested')} <small>({money(d.requestLines.filter((l) => l.request_id === r.id).reduce((n, l) => n + l.qty_requested * l.unit_cost, 0))})</small></td>
                  <td data-label="Accepted" className="r">{r.status === 'sent' || r.status === 'cancelled' ? '–' : <>{unitsOf(r.id, 'qty_accepted')} <small>({money(valueOf(r.id))})</small></>}</td>
                  <td data-label="Answer">{r.status === 'declined' ? <>{r.decline_reason}<small className="sub">{person(r.responded_by)}, {whenText(r.responded_at)}</small></> : r.responded_at ? <small>{person(r.responded_by)}, {whenText(r.responded_at)}{r.received_at ? `. Received ${whenText(r.received_at)}` : r.copied_at ? '. Copied for NAV' : ''}</small> : <span className="muted">Not yet</span>}</td>
                  <td className="rowactions">{canTakeBack(r) && <button type="button" className="btn" onClick={() => void takeBack(r.id, storeName(r.to_store_id))}>Take back</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        <section className="sheet viz-card">
          <div className="viz-head"><div><h2>Left over</h2><p className="muted">What no live request holds: stock declined, lowered or taken back, and anything nobody needed.</p></div></div>
          {leftItems.length === 0 ? <p className="muted">Everything on the sheet is with a store.</p> : (
            <>
              <div className="tablewrap">
                <table className="book leftover">
                  <thead><tr><th>Item</th><th className="r">On the sheet</th><th className="r">With stores</th><th className="r">Left over</th></tr></thead>
                  <tbody>{leftItems.slice(0, 30).map((l) => (
                    <tr key={l.item_code}>
                      <td data-label="Item"><b className="num">{l.item_code}</b><small className="sub">{l.description}</small></td>
                      <td data-label="On the sheet" className="r">{l.qty}</td>
                      <td data-label="With stores" className="r">{l.qty - (left.get(l.item_code) ?? 0)}</td>
                      <td data-label="Left over" className="r"><span className="chip warn">{left.get(l.item_code)}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {leftItems.length > 30 && <p className="muted">The first 30 of {leftItems.length} items are shown.</p>}
              <div className="actions"><button type="button" className="btn primary" onClick={() => setOffering(true)}>Offer the left over to other stores</button></div>
            </>
          )}
        </section>
      </div>

      {offering && <Reoffer d={d} stores={stores} left={left} storeName={storeName} onClose={() => setOffering(false)} onDone={() => { setOffering(false); reload() }} />}
      {confirmDialog}
    </>
  )
}

/** Choose stores for the left over, see the suggested split, and send it as new requests (the next round). */
function Reoffer({ d, stores, left, storeName, onClose, onDone }: { d: ClosureDetail; stores: OpsStore[]; left: Map<string, number>; storeName: (id: string) => string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const asked = new Set(d.requests.filter((r) => r.status !== 'cancelled').map((r) => r.to_store_id))
  const declined = new Set(d.requests.filter((r) => r.status === 'declined').map((r) => r.to_store_id))
  const candidates = stores.filter((s) => s.active && s.id !== d.closure.closing_store_id).sort((a, b) => a.name.localeCompare(b.name))
  // A store that has not been asked yet is offered first; one that declined is left out unless chosen.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.filter((s) => !asked.has(s.id)).map((s) => s.id)))
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<{ store_id: string; item_code: string; qty: number }[] | null>(null)
  const codes = d.lines.filter((l) => (left.get(l.item_code) ?? 0) > 0).map((l) => l.item_code)

  const work = async () => {
    if (!picked.size) return toast.error('Choose at least one store.')
    setBusy(true)
    try {
      const stores2 = [...picked]
      const need = await closuresApi.need(stores2, codes, d.closure.id)
      const res = allocate(codes.map((c) => ({ code: c, qty: left.get(c) ?? 0 })), need.map((n) => ({ store: n.store_id, code: n.item_code, shortfall: n.shortfall })), stores2)
      const rows = [...res.alloc].flatMap(([store_id, m]) => [...m].filter(([, q]) => q > 0).map(([item_code, qty]) => ({ store_id, item_code, qty })))
      setPlan(rows)
      if (!rows.length) toast.info('None of the chosen stores falls short of what is left. Choose more stores.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not work it out. Try again.') } finally { setBusy(false) }
  }

  const send = async () => {
    if (!plan?.length) return
    setBusy(true)
    try { await closuresApi.reoffer(d.closure.id, plan); toast.success(`Offered to ${new Set(plan.map((p) => p.store_id)).size} stores.`); onDone() } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not send. Try again.') } finally { setBusy(false) }
  }

  const perStore = plan ? [...new Set(plan.map((p) => p.store_id))].map((s) => ({ s, units: plan.filter((p) => p.store_id === s).reduce((n, p) => n + p.qty, 0), lines: plan.filter((p) => p.store_id === s).length })) : []
  const unplaced = plan ? codes.reduce((n, c) => n + (left.get(c) ?? 0) - plan.filter((p) => p.item_code === c).reduce((x, p) => x + p.qty, 0), 0) : 0

  return (
    <Modal labelledBy="reoffer-title" onClose={() => { if (!busy) onClose() }}>
      <div className="modalbox wide panel">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose} disabled={busy}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
        <h2 id="reoffer-title">Offer the left over</h2>
        <p className="muted">Choose the stores to offer it to. The app suggests a split from what each store needs. A store that declined is not ticked, and one you have already asked is only ticked if you choose it.</p>
        <div className="storepick" role="group" aria-label="Stores to offer to">
          {candidates.map((s) => (
            <label key={s.id} className="inline"><input type="checkbox" name={`offer-${s.id}`} checked={picked.has(s.id)} onChange={(e) => { setPlan(null); setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n }) }} /> {s.name}{declined.has(s.id) ? ' (declined)' : asked.has(s.id) ? ' (asked)' : ''}</label>
          ))}
        </div>
        {plan && (
          <>
            {perStore.length === 0 ? <p className="note">Nothing would go to these stores.</p> : <ul className="people">{perStore.map((p) => <li key={p.s}><div className="who-line"><b>{storeName(p.s)}</b><span className="muted">{p.lines} {p.lines === 1 ? 'item' : 'items'}, {p.units} {p.units === 1 ? 'unit' : 'units'}</span></div></li>)}</ul>}
            {unplaced > 0 && <p className="muted">{unplaced} units would still be left over.</p>}
          </>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={() => void work()} disabled={busy || picked.size === 0}>{busy ? 'Working…' : plan ? 'Work it out again' : 'Work out the split'}</button>
          <button type="button" className="btn primary" onClick={() => void send()} disabled={busy || !plan?.length}>Send to {perStore.length || ''} {perStore.length === 1 ? 'store' : 'stores'}</button>
        </div>
      </div>
    </Modal>
  )
}
