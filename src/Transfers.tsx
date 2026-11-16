import { useEffect, useMemo, useRef, useState } from 'react'
import { copyText } from './CopyDialog'
import { useConfirm } from './Confirm'
import Loading from './Loading'
import Modal from './Modal'
import { useToast } from './Toast'
import { closuresApi, type RequestLineRow, type RequestRow } from './lib/closures/api'
import { REQUEST_CHIP, REQUEST_LABEL, awaitingAnswer, transferNavText } from './lib/closures/status'
import { money } from './lib/order'
import { useLoad } from './lib/useLoad'
import type { StoreRow } from './lib/supabase'

interface Props { stores: StoreRow[]; multi: boolean; names: Record<string, string> }

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const whole = (text: string) => { const n = Math.floor(Number(text.replace(/[^\d]/g, ''))); return Number.isFinite(n) ? n : 0 }

/** Stock a closing store is offering to this person's stores: answer each request, copy it into NAV, and mark it received. */
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
          <h1>Transfers</h1>
          <p className="muted">Stock offered by stores that are closing, and items operations asks you to order. Answer each one: accept it, lower the quantities, or decline it. Then copy it into NAV, and mark it received when it arrives.{waiting > 0 ? ` ${waiting} ${waiting === 1 ? 'is' : 'are'} waiting for you.` : ''}</p>
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
        <div className="state error" role="alert"><p>Your transfers did not load</p><p className="muted">Check your connection and try again.</p><div className="actions"><button type="button" className="btn" onClick={data.retry}>Try again</button></div></div>
      ) : shown.length === 0 ? (
        <div className="state"><p>No transfers waiting</p><p className="muted">When a store closes, operations may offer you some of its stock, or ask you to order some items. It shows here, and in the bell, as soon as it is sent.</p></div>
      ) : (
        <div className="tablewrap">
          <table className="book transfers">
            <thead><tr><th>From</th>{multi && <th>To</th>}<th>Status</th><th className="r">Offered</th><th>Sent</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className={awaitingAnswer(r) ? 'ordering' : undefined}>
                <td data-label="From"><b>{r.from_store_name || 'Operations'}</b>{r.round > 1 && <small className="sub">Offered again</small>}</td>
                {multi && <td data-label="To">{storeName(r.to_store_id)}</td>}
                <td data-label="Status"><span className={REQUEST_CHIP[r.status]}>{awaitingAnswer(r) ? 'Needs your answer' : REQUEST_LABEL[r.status]}</span></td>
                <td data-label="Offered" className="r">{units(r.id)} {units(r.id) === 1 ? 'unit' : 'units'}<small className="sub">{money(value(r.id))} at cost</small></td>
                <td data-label="Sent">{dateText(r.sent_at)}</td>
                <td className="rowactions"><button type="button" className={'btn' + (awaitingAnswer(r) ? ' primary' : '')} aria-label={`Open the request from ${r.from_store_name}`} onClick={() => setOpenId(r.id)}>{awaitingAnswer(r) ? 'Answer' : 'Open'}</button></td>
              </tr>
            ))}</tbody>
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
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.item_code, String(l.qty_requested)])))
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const waiting = awaitingAnswer(req)
  const person = (e: string | null) => (e ? names[e.toLowerCase()] ?? e : '')
  const accepted = lines.reduce((n, l) => n + (waiting ? Math.min(whole(qty[l.item_code] ?? ''), l.qty_requested) : l.qty_accepted ?? 0), 0)
  const asked = lines.reduce((n, l) => n + l.qty_requested, 0)
  const lowered = waiting && lines.some((l) => whole(qty[l.item_code] ?? '') < l.qty_requested)

  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true)
    try { await fn(); toast.success(done); onChanged() } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save that. Try again.') } finally { setBusy(false) }
  }

  const accept = async () => {
    if (accepted === 0) { setDeclining(true); return toast.info('You have taken none of it. Say why, and decline it.') }
    await run(() => closuresApi.respond(req.id, true, lines.map((l) => ({ item_code: l.item_code, qty_accepted: Math.min(whole(qty[l.item_code] ?? ''), l.qty_requested) })), ''), 'Accepted. Copy it for NAV when you are ready.')
  }
  const decline = async () => {
    if (!reason.trim()) return toast.error('Say why it is declined.')
    if (!(await ask({ title: 'Decline this request?', body: <p>Operations is told, and the stock is offered to other stores. You cannot change your answer afterwards.</p>, confirmLabel: 'Decline it', danger: true }))) return
    await run(() => closuresApi.respond(req.id, false, null, reason.trim()), 'Declined. Operations has been told.')
  }
  const ordering = !req.from_store_name // no sending store: operations asks this store to order the items
  const copyForNav = async () => {
    const text = transferNavText(lines)
    if (!(await copyText(text))) return toast.error('Could not copy. Select the lines and copy them by hand.')
    await closuresApi.markCopied(req.id).catch(() => undefined)
    toast.success(`Copied ${lines.filter((l) => (l.qty_accepted ?? 0) > 0).length} lines. ${ordering ? 'Paste them into a NAV purchase order.' : 'Paste them into a NAV transfer order. The transfer’s from and to are entered by hand.'}`)
    onChanged()
  }
  const received = async () => {
    if (!(await ask({ title: ordering ? 'Mark it done?' : 'Mark it received?', body: <p>{ordering ? 'Do this once the items are ordered in NAV. It ends the request.' : 'Do this once the stock has arrived and the transfer is done in NAV. It ends the request.'}</p>, confirmLabel: ordering ? 'Mark done' : 'Mark received' }))) return
    await run(() => closuresApi.markReceived(req.id), 'Marked received.')
  }

  return (
    <Modal labelledBy="transfer-title" onClose={() => { if (!busy) onClose() }}>
      <div className="modalbox wide panel">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose} disabled={busy}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
        <h2 id="transfer-title">{ordering ? 'Operations asks you to order these' : `Stock from ${req.from_store_name}`}</h2>
        <p className="muted">{multi ? `For ${storeName}. ` : ''}Sent {dateText(req.sent_at)}{req.sent_by ? ` by ${person(req.sent_by)}` : ''}. <span className={REQUEST_CHIP[req.status]}>{REQUEST_LABEL[req.status]}</span></p>

        <div className="tablewrap">
          <table className="book tlines">
            <thead><tr><th>Item</th><th className="r">Offered</th><th className="r">{waiting ? 'You take' : 'Accepted'}</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.item_code}>
                <td data-label="Item"><b className="num">{l.item_code}</b><small className="sub">{l.description}</small></td>
                <td data-label="Offered" className="r">{l.qty_requested}</td>
                <td data-label={waiting ? 'You take' : 'Accepted'} className="r">
                  {waiting
                    ? <input className="qty" inputMode="numeric" autoComplete="off" aria-label={`Units of ${l.item_code} you take`} value={qty[l.item_code] ?? ''} disabled={busy} onFocus={(e) => e.target.select()} onChange={(e) => setQty((q) => ({ ...q, [l.item_code]: String(Math.min(whole(e.target.value), l.qty_requested)) }))} />
                    : l.qty_accepted ?? 0}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="muted">{waiting ? `You are taking ${accepted} of ${asked} units.${lowered ? ' You can lower a quantity, but not raise it.' : ''}` : `${accepted} of ${asked} units accepted.`}</p>

        {req.status === 'declined' && <p className="note">Declined{req.decline_reason ? `: ${req.decline_reason}` : ''}. {person(req.responded_by)} {dateText(req.responded_at)}</p>}
        {req.status === 'cancelled' && <p className="note">Operations took this request back.</p>}
        {req.status === 'received' && <p className="note">Received {dateText(req.received_at)}.</p>}

        {waiting && declining && (
          <label>Why is it declined?
            <textarea name="declineReason" rows={3} maxLength={500} data-autofocus="" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: no room until the new shelving is in" />
          </label>
        )}

        <div className="actions">
          {waiting && !declining && (<>
            <button type="button" className="btn" onClick={() => setDeclining(true)} disabled={busy}>Decline</button>
            <button type="button" className="btn primary" onClick={() => void accept()} disabled={busy}>{lowered ? 'Accept with changes' : 'Accept it all'}</button>
          </>)}
          {waiting && declining && (<>
            <button type="button" className="btn" onClick={() => setDeclining(false)} disabled={busy}>Back</button>
            <button type="button" className="btn danger" onClick={() => void decline()} disabled={busy}>Decline it</button>
          </>)}
          {req.status === 'accepted' && (<>
            <button type="button" className="btn" onClick={() => void copyForNav()} disabled={busy}>{req.copied_at ? 'Copy for NAV again' : 'Copy for NAV'}</button>
            <button type="button" className="btn primary" onClick={() => void received()} disabled={busy}>{ordering ? 'Mark done' : 'Mark received'}</button>
          </>)}
        </div>
        {req.status === 'accepted' && <p className="muted">Copy for NAV gives the item numbers and quantities. {ordering ? 'In NAV, order these items for ' + storeName + ', then paste the lines.' : `In NAV, make the transfer order from ${req.from_store_name} to ${storeName}, then paste the lines.`}{req.copied_at ? ` Copied ${dateText(req.copied_at)}.` : ''}</p>}
      </div>
      {confirmDialog}
    </Modal>
  )
}
