import { useEffect, useMemo, useRef, useState } from 'react'
import { copyText } from './CopyDialog'
import { useConfirm } from './Confirm'
import Loading from './Loading'
import Modal from './Modal'
import { useToast } from './Toast'
import { closuresApi, type RequestLineRow, type RequestRow } from './lib/closures/api'
import { awaitingAnswer, storeStatus, transferJournalText, transferNavText } from './lib/closures/status'
import { money } from './lib/order'
import { useLoad } from './lib/useLoad'
import type { StoreRow } from './lib/supabase'

interface Props { stores: StoreRow[]; multi: boolean; names: Record<string, string> }

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')

/** Stock sent to this person's stores by management: copy each stock adjustment into NAV, then mark it done. */
export default function Transfers({ stores, multi, names }: Props) {
  const ids = useMemo(() => stores.map((s) => s.id), [stores])
  const data = useLoad(() => closuresApi.incoming(ids), [ids.join(',')])
  const [filter, setFilter] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const reload = useRef(data.retry)
  reload.current = data.retry
  // A store's screen follows its requests: any change reloads the list.
  useEffect(() => closuresApi.subscribe(() => reload.current()), [])

  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? 'A store'
  const all = data.data?.requests ?? []
  const lines = data.data?.lines ?? []
  const shown = useMemo(() => all
    .filter((r) => !filter || r.to_store_id === filter)
    .sort((a, b) => Number(awaitingAnswer(b)) - Number(awaitingAnswer(a)) || (a.sent_at < b.sent_at ? 1 : -1)), [all, filter])
  const linesOf = (id: string) => lines.filter((l) => l.request_id === id)
  const units = (id: string) => linesOf(id).reduce((n, l) => n + (l.qty_accepted ?? l.qty_requested), 0)
  const value = (id: string) => linesOf(id).reduce((n, l) => n + (l.qty_accepted ?? l.qty_requested) * l.unit_cost, 0)
  const open = openId ? all.find((r) => r.id === openId) ?? null : null
  const waiting = all.filter(awaitingAnswer).length

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Stock transfers</h1>
          <p className="muted">Stock sent to your store by management. Open each one, copy the adjustment into NAV, then mark it done. If your store cannot take it, decline it and say why.{waiting > 0 ? ` ${waiting} ${waiting === 1 ? 'is' : 'are'} waiting to be copied.` : ''}</p>
        </div>
        {multi && (
          <div className="actions">
            <label className="inline">Store
              <select name="transferStore" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">All my stores</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      {data.loading && !data.data ? <Loading /> : data.failed && !data.data ? (
        <div className="state error" role="alert"><p>Your stock transfers did not load</p><p className="muted">Check your connection and try again.</p><div className="actions"><button type="button" className="btn" onClick={data.retry}>Try again</button></div></div>
      ) : shown.length === 0 ? (
        <div className="state"><p>No stock transfers</p><p className="muted">When management sends stock to your store, it shows here, and in the bell, as soon as it is sent.</p></div>
      ) : (
        <div className="tablewrap">
          <table className="book transfers">
            <thead><tr><th>From</th>{multi && <th>To</th>}<th>Status</th><th className="r">Quantity</th><th>Sent</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>{shown.map((r) => {
              const status = storeStatus(r)
              return (
                <tr key={r.id} className={awaitingAnswer(r) ? 'ordering' : undefined}>
                  <td data-label="From"><b>{r.from_store_name || 'Management'}</b>{r.round > 1 && <small className="sub">Sent again</small>}</td>
                  {multi && <td data-label="To">{storeName(r.to_store_id)}</td>}
                  <td data-label="Status"><span className={status.chip}>{status.label}</span></td>
                  <td data-label="Quantity" className="r">{units(r.id)} {units(r.id) === 1 ? 'unit' : 'units'}<small className="sub">{money(value(r.id))} at cost</small></td>
                  <td data-label="Sent">{dateText(r.sent_at)}</td>
                  <td className="rowactions"><button type="button" className={'btn' + (awaitingAnswer(r) ? ' primary' : '')} aria-label={`Open the transfer from ${r.from_store_name || 'management'}`} onClick={() => setOpenId(r.id)}>{awaitingAnswer(r) ? 'Copy' : 'Open'}</button></td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}

      {open && <RequestModal req={open} lines={linesOf(open.id)} storeName={storeName(open.to_store_id)} multi={multi} names={names} onClose={() => setOpenId(null)} onChanged={data.retry} />}
    </>
  )
}

function RequestModal({ req, lines, storeName, multi, names, onClose, onChanged }: { req: RequestRow; lines: RequestLineRow[]; storeName: string; multi: boolean; names: Record<string, string>; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [busy, setBusy] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const person = (e: string | null) => (e ? names[e.toLowerCase()] ?? e : '')
  const ordering = !req.from_store_name // no sending store: management asks this store to order the items
  const status = storeStatus(req)
  const total = lines.reduce((n, l) => n + (l.qty_accepted ?? l.qty_requested), 0)
  const open = req.status === 'sent' || req.status === 'accepted'

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try { await fn(); toast.success(done); onChanged() } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save that. Try again.') } finally { setBusy(false) }
  }

  // Copying is how a store takes the transfer: the first copy accepts all of it, so management sees it has been taken.
  const copyForNav = async () => {
    const text = ordering ? transferNavText(lines) : transferJournalText(lines)
    setBusy(true)
    try {
      if (req.status === 'sent') await closuresApi.respond(req.id, true, null, '')
      if (!(await copyText(text))) { onChanged(); return toast.error('Could not copy. Select the lines and copy them by hand.') }
      await closuresApi.markCopied(req.id).catch(() => undefined)
      toast.success(`Copied ${lines.filter((l) => (l.qty_accepted ?? l.qty_requested) > 0).length} lines. ${ordering ? 'Paste them into a NAV purchase order.' : 'Paste them into a NAV item journal.'}`)
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not copy it. Try again.') } finally { setBusy(false) }
  }
  // A store that cannot take it says why. Management is told, and can offer the stock to another store.
  const decline = async () => {
    if (!reason.trim()) return toast.error('Say why it is declined.')
    if (!(await ask({ title: 'Decline this transfer?', body: <p>Management is told, and the stock is offered to other stores. You cannot change your answer afterwards.</p>, confirmLabel: 'Decline it', danger: true }))) return
    await run(() => closuresApi.respond(req.id, false, null, reason.trim()), 'Declined. Management has been told.')
  }
  const done = async () => {
    if (!(await ask({ title: 'Mark it done?', body: <p>{ordering ? 'Do this once the items are ordered in NAV.' : 'Do this once the adjustment is posted in NAV.'} It ends the transfer.</p>, confirmLabel: 'Mark done' }))) return
    await run(() => closuresApi.markReceived(req.id), 'Marked done.')
  }

  return (
    <Modal labelledBy="transfer-title" onClose={() => { if (!busy) onClose() }}>
      <div className="modalbox wide panel">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose} disabled={busy}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
        <h2 id="transfer-title">{ordering ? 'Order request from management' : `Stock transfer from ${req.from_store_name}`}</h2>
        <p className="muted">{multi ? `For ${storeName}. ` : ''}Sent {dateText(req.sent_at)}{req.sent_by ? ` by ${person(req.sent_by)}` : ''}. <span className={status.chip}>{status.label}</span></p>

        <div className="tablewrap">
          <table className="book tlines">
            <thead><tr><th>Item</th><th className="r">Quantity</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.item_code}>
                <td data-label="Item"><b className="num">{l.item_code}</b><small className="sub">{l.description}</small></td>
                <td data-label="Quantity" className="r">{l.qty_accepted ?? l.qty_requested}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="muted">{total} {total === 1 ? 'unit' : 'units'} in all.</p>

        {req.status === 'declined' && <p className="note">Declined{req.decline_reason ? `: ${req.decline_reason}` : ''}. {person(req.responded_by)} {dateText(req.responded_at)}</p>}
        {req.status === 'cancelled' && <p className="note">Management took this transfer back.</p>}
        {req.status === 'received' && <p className="note">Done {dateText(req.received_at)}.</p>}

        {req.status === 'sent' && declining && (
          <label>Why is it declined?
            <textarea name="declineReason" rows={3} maxLength={500} data-autofocus="" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: no room until the new shelving is in" />
          </label>
        )}

        {open && !declining && (
          <div className="actions">
            {req.status === 'sent' && <button type="button" className="btn" onClick={() => setDeclining(true)} disabled={busy}>Decline</button>}
            <button type="button" className={'btn' + (req.status === 'sent' ? ' primary' : '')} onClick={() => void copyForNav()} disabled={busy}>{req.copied_at ? 'Copy for NAV again' : 'Copy for NAV'}</button>
            {req.status === 'accepted' && <button type="button" className="btn primary" onClick={() => void done()} disabled={busy}>Mark done</button>}
          </div>
        )}
        {req.status === 'sent' && declining && (
          <div className="actions">
            <button type="button" className="btn" onClick={() => setDeclining(false)} disabled={busy}>Back</button>
            <button type="button" className="btn danger" onClick={() => void decline()} disabled={busy}>Decline it</button>
          </div>
        )}
        {open && !declining && <p className="muted">{ordering
          ? `Copy for NAV gives the item numbers and quantities. In NAV, order these items for ${storeName}, then paste the lines.`
          : `Copy for NAV gives the stock adjustment in the same columns as a stock take. In NAV, open an item journal for ${storeName}, paste the lines and post it.`}{req.copied_at ? ` Copied ${dateText(req.copied_at)}.` : ''}</p>}
      </div>
      {confirmDialog}
    </Modal>
  )
}
