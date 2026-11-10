import { useEffect, useRef, useState, type FormEvent } from 'react'
import Scanner from './Scanner'
import { api } from './lib/api'
import { trackError, track } from './lib/analytics/track'
import { beep, primeAudio } from './lib/beep'
import { perWeekText, salesSummary, type SalesSummary } from './lib/insights'
import { money, type Product } from './lib/order'
import { salesApi } from './lib/sales/api'
import { divisionLabel } from './lib/sales/model'
import type { StoreRow } from './lib/supabase'
import type { OrderJump } from './Sales'

const STORE_KEY = 'hsw-orders-store' // the same store the Order tab last used


/**
 * Scan a barcode or type an item number or name, and see the price, the stock at this store and how it has sold here.
 * A price label can be printed from the phone or computer through the device's own print dialog (AirPrint, Mopria or a
 * desktop printer), so any printer on the same Wi-Fi works without setting anything up in the app.
 */
export default function PriceCheck({ stores, multi, onOrder }: { stores: StoreRow[]; multi: boolean; onOrder: (j: OrderJump) => void }) {
  const [storeId, setStoreId] = useState(() => { try { const s = localStorage.getItem(STORE_KEY); if (s && stores.some((x) => x.id === s)) return s } catch { /* ignore */ } return stores[0]?.id ?? '' })
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'looking' | 'none' | 'error'>('idle')
  const [results, setResults] = useState<Product[]>([])
  const [picked, setPicked] = useState<Product | null>(null)
  const [sales, setSales] = useState<SalesSummary | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const asked = useRef('')

  const store = stores.find((s) => s.id === storeId)

  const find = async (q: string, fromScan = false): Promise<boolean> => {
    const v = q.trim()
    if (!v || !storeId) return false
    asked.current = v
    setState('looking'); setPicked(null)
    try {
      const found = await api.findItems(storeId, v)
      if (asked.current !== v) return false // a newer search has started
      setResults(found)
      setState(found.length ? 'idle' : 'none')
      if (found.length === 1 || (fromScan && found.length)) setPicked(found[0])
      track('price_check', { found: found.length }, storeId)
      return found.length > 0
    } catch (e) { trackError('price check', e); setState('error'); return false }
  }

  // The item's sales at this store, once one is chosen.
  useEffect(() => {
    setSales(null)
    if (!picked) return
    let live = true
    Promise.all([salesApi.itemHistory(storeId, picked.item.code), salesApi.weeks()])
      .then(([h, w]) => live && setSales(salesSummary(h, w)))
      .catch((e) => trackError('price check sales', e))
    return () => { live = false }
  }, [picked, storeId])

  const submit = (e: FormEvent) => { e.preventDefault(); void find(text) }
  const openScanner = () => { primeAudio(); setScanMsg(''); (document.activeElement as HTMLElement | null)?.blur?.(); setScanning(true) }
  const onScan = async (value: string) => {
    setText(value)
    if (await find(value, true)) { beep('ok'); setScanning(false) } else { beep('miss'); setScanMsg(`${value} is not an item we know`) }
  }
  const changeStore = (id: string) => { setStoreId(id); setPicked(null); setResults([]); try { localStorage.setItem(STORE_KEY, id) } catch { /* ignore */ } }

  const p = picked
  const it = p?.item
  const st = p?.stock
  const price = it?.price ?? null
  const status = it?.status.trim().toUpperCase() ?? ''

  return (
    <div className="pricecheck">
      <div className="pagehead">
        <div>
          <h1>Price check</h1>
          <p className="muted">{store?.name ?? ''}. Scan a barcode, or type an item number or name.</p>
        </div>
        {multi && (
          <div className="actions">
            <label className="inline">Store
              <select name="store" value={storeId} onChange={(e) => changeStore(e.target.value)}>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      <section className="sheet viz-card">
        <form className="findrow" onSubmit={submit}>
          <input type="search" name="priceFind" aria-label="Item number, barcode or name" placeholder="Item number, barcode or name" value={text} enterKeyHint="search" autoComplete="off" onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn" disabled={state === 'looking'}>Find</button>
          <button type="button" className="btn primary scanbtn" onPointerDown={openScanner} onClick={openScanner}>
            <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M12 8v8M16 8v8" /></svg>
            Scan
          </button>
        </form>
        {state === 'looking' && <p className="muted viz-pick">Looking…</p>}
        {state === 'none' && <p className="note bad" role="alert">No item matches “{asked.current}”. Check the number or try part of the name.</p>}
        {state === 'error' && <p className="note bad" role="alert">Could not look that up. Check your connection and try again.</p>}
        {!p && results.length > 1 && (
          <ul className="pricehits">
            {results.map((r) => (
              <li key={r.item.code}>
                <button type="button" className="linkish" onClick={() => setPicked(r)}>
                  <b>{r.item.description || r.item.code}</b>
                  <small>{r.item.code}{r.item.price !== null ? `, ${money(r.item.price)}` : ''}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {p && it && (
        <section className="sheet viz-card priceitem">
          <div className="viz-head">
            <div>
              <h2>{it.description || it.code}</h2>
              <p className="muted">{it.code}{it.barcode ? `, barcode ${it.barcode}` : ''}</p>
            </div>
            {results.length > 1 && <button type="button" className="btn" onClick={() => setPicked(null)}>Back to the list</button>}
          </div>

          <div className="bigprice">
            <b className="num">{price !== null ? money(price) : 'No price'}</b>
            <small className="muted">{price !== null ? 'Price including GST, from NAV' : 'This item has no price in NAV'}</small>
          </div>
          {(status && status !== 'ACTIVE') || it.blocked ? (
            <p className="note">{status && status !== 'ACTIVE' && <span className="chip">{status === 'NEW' ? 'New item' : status}</span>} {it.blocked && <span className="chip warn">Blocked in NAV</span>}</p>
          ) : null}

          <dl className="facts">
            <div><dt>In stock here</dt><dd className="num">{st ? st.inventory : 'No stock record'}</dd></div>
            <div><dt>On order</dt><dd className="num">{st ? st.qty_on_po : '–'}</dd></div>
            {!!st?.transfer_in && <div><dt>On its way (transfer)</dt><dd className="num">{st.transfer_in}</dd></div>}
            <div><dt>Order in multiples of</dt><dd className="num">{st?.moq ?? 1}</dd></div>
            <div><dt>Vendor</dt><dd>{st?.vendor_no ?? it.vendor_no ?? '–'}{it.vendor_item_no ? ` (${it.vendor_item_no})` : ''}</dd></div>
            <div><dt>Category</dt><dd>{it.division ? divisionLabel(it.division) : '–'}{it.category ? `, ${it.category}` : ''}</dd></div>
          </dl>

          <h3 className="pricesub">Sales at this store</h3>
          {!sales ? <p className="muted">Loading…</p> : sales.weeks === 0 ? <p className="muted">No weekly sales have been loaded yet.</p> : (
            <dl className="facts">
              <div><dt>Last week loaded</dt><dd className="num">{sales.last} units</dd></div>
              <div><dt>Last {Math.min(4, sales.weeks)} weeks</dt><dd className="num">{sales.four} units</dd></div>
              <div><dt>Last {sales.weeks} weeks</dt><dd className="num">{sales.thirteen} units, about {perWeekText(sales.thirteen / sales.weeks)} a week</dd></div>
            </dl>
          )}

          <div className="actions">
            <button type="button" className="btn" onClick={() => { track('price_label_print', {}, storeId); window.print() }}>Print price label</button>
            {(st?.vendor_no ?? it.vendor_no) && <button type="button" className="btn primary" onClick={() => onOrder({ storeId, vendor: (st?.vendor_no ?? it.vendor_no)!, item: it.code })}>Order this item</button>}
          </div>
          <p className="muted viz-foot">Printing uses this device’s print dialog: choose a printer on the same Wi-Fi (AirPrint on iPhone, the print service on Android).</p>

          {/* What the printer gets: only this label, nothing else on the page. */}
          <div className="printlabel" aria-hidden="true">
            <p className="pl-name">{it.description}</p>
            <p className="pl-price">{price !== null ? money(price) : ''}</p>
            <p className="pl-code">{it.code}{it.barcode ? `  ${it.barcode}` : ''}</p>
            <p className="pl-store">{store?.name ?? ''}</p>
          </div>
        </section>
      )}

      {scanning && <Scanner onScan={onScan} onClose={() => setScanning(false)} feedback={scanMsg} />}
    </div>
  )
}
