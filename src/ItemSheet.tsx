import { useEffect, useRef, useState } from 'react'
import { SHOW_SALES, itemWarnings, lineCost, money, parseQty, syncedLabel, vendorOf, type Product } from './lib/order'
import { useEscape } from './lib/useEscape'
import type { OrderLine } from './lib/supabase'

interface Props {
  product: Product
  existing: OrderLine | undefined // the line already on the order, if any
  conflict: OrderLine | null | undefined // someone else changed the line while this was open (null = they removed it)
  busy: boolean
  onDone: (qty: number) => void
  onRemove: () => void
  onClose: () => void
}

const num = (n: number | undefined) => (n === undefined ? '–' : String(n))

/** What the phone shows after a scan: the item, the store's figures, a quantity and Done. */
export default function ItemSheet({ product, existing, conflict, busy, onDone, onRemove, onClose }: Props) {
  const { item, stock } = product
  const vendor = vendorOf(item, stock)
  const [text, setText] = useState(existing ? String(existing.qty) : '')
  const input = useRef<HTMLInputElement>(null)
  useEscape(onClose)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => { if (conflict) setText(String(conflict.qty)) }, [conflict])

  const qty = text.trim() === '' ? 0 : parseQty(text)
  const warnings = itemWarnings(item, stock, qty ?? 0)
  const moq = stock?.moq ?? 1
  const canDone = qty !== null && (qty > 0 || !!existing)
  const step = (d: number) => setText(String(Math.max(0, (qty ?? 0) + d)))

  const submit = (e: React.FormEvent) => { e.preventDefault(); if (canDone && !busy) onDone(qty!) }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div className="modalbox">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="sheet-title">{item.description}</h2>
        <p className="muted">
          <span className="num">{item.code}</span>
          {vendor && <> · {vendor}{item.vendor_item_no ? ` · ${item.vendor_item_no}` : ''}</>}
          {item.status && item.status !== 'ACTIVE' && <> · <span className="chip quote">{item.status}</span></>}
        </p>

        <dl className="facts">
          <div><dt>In stock</dt><dd className="num">{num(stock?.inventory)}</dd></div>
          <div><dt>On order</dt><dd className="num">{num(stock?.qty_on_po)}</dd></div>
          {SHOW_SALES && <div><dt>Sold last week</dt><dd className="num">{num(stock?.sales_qty)}</dd></div>}
          <div><dt>Minimum (MOQ)</dt><dd className="num">{num(stock?.moq)}</dd></div>
          <div><dt>Your cost</dt><dd className="num">{stock ? money(stock.store_cost) : '–'}</dd></div>
          <div><dt>Price</dt><dd className="num">{item.price != null ? money(item.price) : '–'}</dd></div>
        </dl>
        <p className="muted facts-note">{syncedLabel(stock?.synced_at)}</p>

        {conflict !== undefined && (
          <p className="note bad">
            {conflict ? `${conflict.updated_by ?? 'Someone'} changed this line to ${conflict.qty} just now.` : 'Someone removed this line just now.'} Check the quantity and press Done again.
          </p>
        )}
        {existing && conflict === undefined && <p className="note">Already on this order: <b className="num">{existing.qty}</b>{existing.updated_by ? `, saved by ${existing.updated_by}` : ''}.</p>}

        <form onSubmit={submit}>
          <label>Order quantity {moq > 1 && <small>minimum {moq}</small>}
            <div className="stepper">
              <button type="button" className="btn" aria-label="One fewer" onClick={() => step(-1)} disabled={(qty ?? 0) <= 0}>−</button>
              <input ref={input} className="qty" name="qty" inputMode="numeric" autoComplete="off" aria-label="Order quantity" value={text}
                onChange={(e) => setText(e.target.value)} />
              <button type="button" className="btn" aria-label="One more" onClick={() => step(1)}>+</button>
            </div>
          </label>
          {moq > 1 && <div className="actions quick"><button type="button" className="btn" onClick={() => step(moq)}>Add {moq}</button></div>}
          {qty === null && <p className="bad">Enter a whole number, like 6.</p>}
          {warnings.map((w) => <p key={w.text} className={'chk ' + w.level}>{w.text}</p>)}
          {qty !== null && qty > 0 && stock && <p className="muted">Costs <span className="num">{money(lineCost(qty, stock.store_cost))}</span></p>}
          <div className="actions">
            {existing && <button type="button" className="btn danger" onClick={onRemove} disabled={busy}>Remove from order</button>}
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={!canDone || busy}>{busy ? 'Saving…' : 'Done'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
