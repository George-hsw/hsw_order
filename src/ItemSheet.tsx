import { useEffect, useRef, useState } from 'react'
import Loading from './Loading'
import { SHOW_SALES, itemWarnings, lineCost, money, parseQty, syncedLabel, vendorOf, type Product } from './lib/order'
import { useEscape } from './lib/useEscape'
import { useLoad } from './lib/useLoad'
import { salesApi } from './lib/sales/api'
import { money2, ordinal, weekLabel } from './lib/sales/model'
import type { OrderLine } from './lib/supabase'

interface Props {
  storeId: string
  product: Product
  existing: OrderLine | undefined // the line already on the order, if any
  conflict: OrderLine | null | undefined // someone else changed the line while this was open (null = they removed it)
  busy: boolean
  focusQty: boolean // after a scan the cursor goes straight to the quantity; from the list it does not, so the keyboard does not cover the facts
  onDone: (qty: number) => void
  onRemove: () => void
  onClose: () => void
}

const num = (n: number | undefined) => (n === undefined ? '–' : String(n))

/**
 * Item details: what the store holds, what is coming, what the item is, and then the quantity to add to the order.
 * Opened from a row's Details button or by scanning. Typing a quantity in the row itself never needs this.
 */
export default function ItemSheet({ storeId, product, existing, conflict, busy, focusQty, onDone, onRemove, onClose }: Props) {
  const { item, stock } = product
  const vendor = vendorOf(item, stock)
  const sales = useLoad(() => salesApi.itemHistory(storeId, product.item.code), [storeId, product.item.code])
  const [text, setText] = useState(existing ? String(existing.qty) : '')
  const input = useRef<HTMLInputElement>(null)
  useEscape(onClose)
  useEffect(() => { if (focusQty) { input.current?.focus(); input.current?.select() } }, [focusQty])
  useEffect(() => { if (conflict) setText(String(conflict.qty)) }, [conflict])

  const qty = text.trim() === '' ? 0 : parseQty(text)
  const warnings = itemWarnings(item, stock, qty ?? 0)
  const moq = stock?.moq ?? 1
  const canDone = qty !== null && (qty > 0 || !!existing)
  const step = (d: number) => setText(String(Math.max(0, (qty ?? 0) + d)))

  const submit = (e: React.FormEvent) => { e.preventDefault(); if (canDone && !busy) onDone(qty!) }

  const about: [string, string | null | undefined][] = [
    ['Barcode', item.barcode], ['Vendor item no.', item.vendor_item_no], ['Division', item.division], ['Category', item.category],
    ['Status', item.status], ['Unit of measure', item.sales_uom ?? item.base_uom],
  ]

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div className="modalbox">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="sheet-title">{item.description}</h2>
        <p className="muted">
          <span className="num">{item.code}</span>
          {vendor && <> · {vendor}</>}
          {item.status && item.status !== 'ACTIVE' && <> · <span className="chip quote">{item.status}</span></>}
        </p>

        <dl className="facts">
          <div><dt>In stock</dt><dd className="num">{num(stock?.inventory)}</dd></div>
          <div><dt>On order</dt><dd className="num">{num(stock?.qty_on_po)}</dd></div>
          <div><dt>Transfer in</dt><dd className="num">{num(stock?.transfer_in)}</dd></div>
          {(stock?.unavailable ?? 0) > 0 && <div><dt>Unavailable</dt><dd className="num">{stock!.unavailable}</dd></div>}
          {SHOW_SALES && <div><dt>Sold last week</dt><dd className="num">{num(stock?.sales_qty)}</dd></div>}
          <div><dt>MOQ</dt><dd className="num">{num(stock?.moq)}</dd></div>
          <div><dt>Cost ex GST</dt><dd className="num">{stock ? money(stock.store_cost) : '–'}</dd></div>
          <div><dt>Price inc GST</dt><dd className="num">{item.price != null ? money(item.price) : '–'}</dd></div>
        </dl>
        <p className="muted facts-note">{syncedLabel(stock?.synced_at)}</p>

        <div className="itemsales">
          <h3>Sales at this store</h3>
          {sales.loading ? <Loading /> : sales.failed ? <p className="muted">Sales are not available right now.</p> : !sales.data?.length ? (
            <p className="muted">No sales recorded for this item in the weeks loaded. The weekly report lists an item only when it sold, was ranked or lost sales.</p>
          ) : (
            <>
              <p>{weekLabel(sales.data[0])}: sold <b className="num">{sales.data[0].qty}</b> ({money2(sales.data[0].net_sales)}){sales.data[0].store_rank ? `, ${ordinal(sales.data[0].store_rank)} in this store` : ''}{sales.data[0].business_rank ? `, ${ordinal(sales.data[0].business_rank)} in the business` : ''}.
                {sales.data[0].stores_stocking > 0 && <> The average store that stocks it sold {(sales.data[0].group_qty / sales.data[0].stores_stocking).toFixed(1)}.</>}
                {sales.data[0].potential_loss > 0 && <> Estimated sales lost while out of stock: {money2(sales.data[0].potential_loss)}.</>}</p>
              <table className="salesmini">
                <thead><tr><th>Week</th><th className="r">Sold</th><th className="r">Sales</th><th className="r">Lost</th></tr></thead>
                <tbody>{sales.data.slice(0, 6).map((w) => <tr key={w.fy * 100 + w.week}><td>{weekLabel(w)}</td><td className="r">{w.qty}</td><td className="r">{money2(w.net_sales)}</td><td className="r">{w.potential_loss > 0 ? money2(w.potential_loss) : '–'}</td></tr>)}</tbody>
              </table>
              <p className="muted">Item sales are before GST. A week that is missing had no sale, rank or lost sales recorded.</p>
            </>
          )}
        </div>

        <details className="storedetails itemabout">
          <summary>More about this item</summary>
          <dl className="aboutlist">
            {about.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === 'Barcode' ? 'num' : undefined}>{v}</dd></div>)}
          </dl>
        </details>

        {conflict !== undefined && (
          <p className="note bad">
            {conflict ? `${conflict.updated_by ?? 'Someone'} changed this line to ${conflict.qty} just now.` : 'Someone removed this line just now.'} Check the quantity and press {existing ? 'Update order' : 'Add to order'} again.
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
            <button type="submit" className="btn primary" disabled={!canDone || busy}>{busy ? 'Saving…' : existing ? 'Update order' : 'Add to order'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
