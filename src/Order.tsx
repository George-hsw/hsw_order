import { useCallback, useEffect, useMemo, useState } from 'react'
import CopyDialog from './CopyDialog'
import ItemSheet from './ItemSheet'
import Scanner from './Scanner'
import StatusChip from './StatusChip'
import { useToast } from './Toast'
import { api, ConflictError, type Catalogue } from './lib/api'
import { beep, primeAudio } from './lib/beep'
import { SHOW_SALES, findByScan, isStale, itemWarnings, lineCost, money, parseQty, rangeFor, searchItems, syncedLabel, totals, vendorOf, vendorOptions, type Product } from './lib/order'
import { DEMO, type OrderLine, type OrderRow, type OrderSummary, type StoreRow } from './lib/supabase'

interface Props { email: string; multi: boolean; stores: StoreRow[]; names: Record<string, string>; onSaved: () => void }

const STORE_KEY = 'hsw-orders-store'
const PAGE = 100 // rows shown at a time: a vendor can have hundreds of items
type CatLoad = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; cat: Catalogue }
type OrderLoad = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; order: OrderRow }
interface Sheet { product: Product; base: number; focusQty: boolean; conflict?: OrderLine | null }
type Show = 'all' | 'ordered' | 'not'

/**
 * An order is for one vendor, like the NAV purchase order it becomes. Choose the vendor and the whole range the store
 * orders from them is listed: type a quantity beside each item, or scan to jump to one. Each vendor's order saves as you go,
 * so you can leave it on hold and start the next vendor's.
 */
export default function Order({ email, multi, stores, names, onSaved }: Props) {
  const toast = useToast()
  const [storeId, setStoreId] = useState(() => {
    try { const s = localStorage.getItem(STORE_KEY); if (s && stores.some((x) => x.id === s)) return s } catch { /* ignore */ }
    return stores[0]?.id ?? ''
  })
  const [vendor, setVendor] = useState('') // '' = none chosen yet
  const [catLoad, setCatLoad] = useState<CatLoad>({ phase: 'loading' })
  const [drafts, setDrafts] = useState<OrderSummary[]>([])
  const [orderLoad, setOrderLoad] = useState<OrderLoad>({ phase: 'loading' })
  const [lines, setLines] = useState<OrderLine[]>([])
  const [attempt, setAttempt] = useState(0)
  const [orderAttempt, setOrderAttempt] = useState(0)
  const [find, setFind] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [limit, setLimit] = useState(PAGE)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [pending, setPending] = useState(0)

  const who = (e: string | null) => (e ? names[e.toLowerCase()] ?? e : '')
  const refreshDrafts = useCallback(() => { api.drafts(storeId).then(setDrafts).catch(() => { /* the list is a convenience */ }) }, [storeId])

  // The store's items and stock, and what is on hold.
  useEffect(() => {
    if (!storeId) return
    let live = true
    setCatLoad({ phase: 'loading' })
    Promise.all([api.catalogue(storeId), api.drafts(storeId)])
      .then(([cat, d]) => { if (!live) return; setDrafts(d); setCatLoad({ phase: 'ready', cat }) })
      .catch(() => live && setCatLoad({ phase: 'error' }))
    return () => { live = false }
  }, [storeId, attempt])

  // The chosen vendor's order, started if there is none.
  useEffect(() => {
    if (!storeId || !vendor) return
    let live = true
    setOrderLoad({ phase: 'loading' })
    api.openOrder(storeId, vendor, email)
      .then((od) => { if (!live) return; setLines(od.lines); setOrderLoad({ phase: 'ready', order: od.order }) })
      .catch(() => live && setOrderLoad({ phase: 'error' }))
    return () => { live = false }
  }, [storeId, vendor, email, orderAttempt])

  const orderId = orderLoad.phase === 'ready' ? orderLoad.order.id : ''
  useEffect(() => (orderId ? api.subscribe(orderId, setLines) : undefined), [orderId])
  useEffect(() => { setLimit(PAGE) }, [vendor, show, find])

  const chooseVendor = (v: string) => { setVendor(v); setFind(''); setShow('all'); if (!v) refreshDrafts() }
  const changeStore = (id: string) => {
    setStoreId(id)
    setVendor('')
    try { localStorage.setItem(STORE_KEY, id) } catch { /* ignore */ }
  }

  const cat = catLoad.phase === 'ready' ? catLoad.cat : null
  const order = orderLoad.phase === 'ready' && vendor ? orderLoad.order : null
  const stockOf = useMemo(() => new Map((cat?.stock ?? []).map((s) => [s.item_code, s])), [cat])
  const synced = cat?.syncedAt
  const stale = isStale(synced)
  const vendors = useMemo(() => (cat ? vendorOptions(cat.items, cat.stock) : []), [cat])
  const draftOf = useMemo(() => new Map(drafts.map((d) => [d.vendor_no, d])), [drafts])
  const range = useMemo(() => (cat && vendor ? rangeFor(cat.items, cat.stock, vendor) : []), [cat, vendor])
  const lineOf = useMemo(() => new Map(lines.map((l) => [l.item_code, l])), [lines])

  const rows = useMemo(() => {
    const hit = find.trim() ? new Set(searchItems(range.map((p) => p.item), find, 100000).map((i) => i.code)) : null
    return range.filter((p) => {
      if (hit && !hit.has(p.item.code)) return false
      const on = lineOf.has(p.item.code)
      return show === 'all' || (show === 'ordered' ? on : !on)
    })
  }, [range, find, show, lineOf])
  const orderedCount = useMemo(() => range.filter((p) => lineOf.has(p.item.code)).length, [range, lineOf])

  const open = (p: Product, focusQty = false) => { setSheet({ product: p, base: lineOf.get(p.item.code)?.revision ?? 0, focusQty }); setFind('') }

  /** Save one line. Returns true when it saved. */
  const save = async (p: Product, qty: number, base: number): Promise<boolean> => {
    if (!order) return false
    setPending((n) => n + 1)
    try {
      const next = await api.saveLine(order.id, email, { item: p.item, qty, unitCost: p.stock?.store_cost ?? 0, vendorNo: vendor }, base)
      setLines(next)
      onSaved()
      return true
    } catch (e) {
      if (e instanceof ConflictError) {
        setSheet((s) => (s && s.product.item.code === p.item.code ? { ...s, base: e.current?.revision ?? 0, conflict: e.current ?? null } : s))
        if (!sheet) toast.error(`${who(e.current?.updated_by ?? null) || 'Someone'} changed ${p.item.description}. The new quantity is shown.`)
        api.orderLines(order.id).then(setLines).catch(() => { /* live updates will catch up */ })
      } else toast.error('That did not save. Check your connection and try again.')
      return false
    } finally {
      setPending((n) => n - 1)
    }
  }

  const sheetDone = async (qty: number) => {
    if (!sheet) return
    const { item } = sheet.product
    if (await save(sheet.product, qty, sheet.base)) {
      setScanMsg(qty > 0 ? `Saved ${qty} × ${item.description}` : `Removed ${item.description}`)
      setSheet(null)
      if (!scanning) toast.success(qty > 0 ? `Saved ${qty} × ${item.description}.` : `Removed ${item.description}.`)
    }
  }

  const handleScan = (value: string) => {
    if (sheet || !cat) return // one item at a time: ignore scans while the sheet is open
    const it = findByScan(cat.items, value)
    if (!it) { beep('miss'); setScanMsg(`${value} is not in the item list`); return }
    const p: Product = { item: it, stock: stockOf.get(it.code) }
    const v = vendorOf(it, p.stock)
    if (v !== vendor) { beep('miss'); setScanMsg(`${it.description} is from ${v ?? 'no vendor'}, not ${vendor}`); return }
    beep('ok')
    setScanMsg(it.description)
    open(p, true) // after a scan the cursor goes straight to the quantity
  }

  const onFinderEnter = () => {
    if (!cat) return
    const it = findByScan(cat.items, find)
    const p = it && range.find((r) => r.item.code === it.code)
    if (p) open(p)
  }

  const setQty = async (p: Product, text: string) => {
    const line = lineOf.get(p.item.code)
    const q = text.trim() === '' ? 0 : parseQty(text)
    if (q === null) return toast.error('Enter a whole number, like 6.')
    if (q === (line?.qty ?? 0)) return
    await save(p, q, line?.revision ?? 0)
  }

  const changeStatus = useCallback(async (status: 'copied' | 'ordered', navRef?: string) => {
    if (!order) return
    try {
      const o = await api.setStatus(order.id, status, navRef)
      if (status === 'ordered') {
        setCopyOpen(false)
        toast.success(`${vendor} order ${o.nav_ref ?? ''} marked as ordered.`)
        chooseVendor('')
      } else setOrderLoad({ phase: 'ready', order: o })
      onSaved()
    } catch { toast.error('Could not update the order. Try again.') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, vendor, onSaved, toast])

  const deleteCurrent = async () => {
    if (!order) return
    try {
      await api.deleteOrder(order.id)
      setCopyOpen(false)
      toast.success(`${vendor} order deleted.`)
      chooseVendor('')
      onSaved()
    } catch { toast.error('Could not delete the order. Try again.') }
  }

  const holdAndNext = () => {
    toast.info(`${vendor} order saved and on hold. Choose the next vendor.`)
    chooseVendor('')
  }

  const t = totals(lines)
  const editedAfterCopy = !!order?.copied_at && lines.some((l) => l.updated_at > order.copied_at!)
  const storeName = stores.find((s) => s.id === storeId)?.name ?? ''
  const holds = drafts.filter((d) => d.lines > 0 && d.vendor_no !== vendor)

  if (!stores.length) return <div className="state"><p>No stores yet</p><p className="muted">Add a store on the Stores tab first.</p></div>

  return (
    <div className="builder">
      <div className="pagehead">
        <div>
          <h1>Order</h1>
          <p className="muted">{storeName}{cat ? ` · ${syncedLabel(synced)}` : ''}{stale && cat && <> · <span className="chip warn">Out of date</span></>}</p>
        </div>
        <div className="actions">
          {multi && (
            <label className="inline">Store
              <select name="store" value={storeId} onChange={(e) => changeStore(e.target.value)}>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}
          {cat && (
            <label className="inline">Vendor
              <select name="vendor" value={vendor} onChange={(e) => chooseVendor(e.target.value)}>
                <option value="">Choose a vendor…</option>
                {vendors.map((v) => {
                  const d = draftOf.get(v.vendor)
                  return <option key={v.vendor} value={v.vendor}>{v.vendor} ({v.items}){d && d.lines > 0 ? ` · ${d.lines} on order` : ''}</option>
                })}
              </select>
            </label>
          )}
        </div>
      </div>

      {catLoad.phase === 'loading' && <div className="skeleton" aria-busy="true" aria-label="Loading items"><i /><i /><i /><i /></div>}
      {catLoad.phase === 'error' && (
        <div className="state error"><p>The items did not load</p><p className="muted">Check your connection and try again.</p>
          <div className="actions"><button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>Try again</button></div></div>
      )}

      {cat && stale && <p className="note bad">This store’s stock has not refreshed since {synced ? new Date(synced).toLocaleDateString('en-AU', { weekday: 'long' }) : 'it was set up'}. Check the figures against NAV before you order.</p>}

      {cat && !vendor && (
        <>
          <div className="state">
            <p>{vendors.length === 0 ? 'No items for this store yet' : 'Choose a vendor to start an order'}</p>
            <p className="muted">{vendors.length === 0 ? 'Stock appears here after the nightly sync from NAV.' : 'A purchase order is made for one vendor. Pick one above and its whole range for this store is listed.'}</p>
          </div>
          {drafts.some((d) => d.lines > 0) && (
            <section className="block">
              <h2>Orders in progress</h2>
              <ul className="people">
                {drafts.filter((d) => d.lines > 0).map((d) => (
                  <li key={d.id}>
                    <div className="who-line">
                      <b>{d.vendor_no}</b>
                      <span className="muted">{d.lines} {d.lines === 1 ? 'line' : 'lines'}, {d.units} units, {money(d.cost)}</span>
                      <StatusChip status={d.status} />
                    </div>
                    <div className="person-actions"><button type="button" className="btn" onClick={() => chooseVendor(d.vendor_no)}>Resume</button></div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {cat && vendor && orderLoad.phase === 'loading' && <div className="skeleton" aria-busy="true" aria-label="Loading the order"><i /><i /><i /><i /></div>}
      {cat && vendor && orderLoad.phase === 'error' && (
        <div className="state error"><p>The order did not load</p><p className="muted">Check your connection and try again.</p>
          <div className="actions"><button type="button" className="btn" onClick={() => setOrderAttempt((a) => a + 1)}>Try again</button></div></div>
      )}

      {cat && order && (
        <>
          {order.status === 'copied' && !editedAfterCopy && <p className="note">This order has been copied for NAV. Enter the NAV order number when it is done.</p>}
          {editedAfterCopy && <p className="note bad">Lines changed after this order was copied. Copy it again before you use it in NAV.</p>}

          <div className="workspace">
            <div className="sheet">
              <section className="block">
                <h2>{vendor} <small>{range.length} items · {orderedCount} on order{pending > 0 ? ' · Saving…' : ''}</small></h2>
                <div className="finder">
                  <div className="findrow">
                    <input type="search" name="find" aria-label={`Find an item from ${vendor}`} placeholder="Search this vendor, or scan…" value={find} enterKeyHint="search"
                      autoComplete="off" onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onFinderEnter()} />
                    <button type="button" className="btn" onClick={() => { primeAudio(); setScanMsg(''); setScanning(true) }}>
                      <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M12 8v8M16 8v8" /></svg>
                      Scan
                    </button>
                  </div>
                  {!DEMO && <p className="muted desktop-only">Scan with your phone: sign in on it, choose the same vendor and tap Scan. Quantities you save appear here a moment later.</p>}
                </div>

                <div className="filters">
                  <div className="segmented" role="group" aria-label="Show items">
                    <button type="button" aria-pressed={show === 'all'} onClick={() => setShow('all')}>All ({range.length})</button>
                    <button type="button" aria-pressed={show === 'ordered'} onClick={() => setShow('ordered')}>On order ({orderedCount})</button>
                    <button type="button" aria-pressed={show === 'not'} onClick={() => setShow('not')}>Not ordered ({range.length - orderedCount})</button>
                  </div>
                </div>

                {range.length === 0 ? (
                  <div className="state"><p>No items for {vendor}</p><p className="muted">This store has no stock records with that vendor.</p></div>
                ) : rows.length === 0 ? (
                  <div className="state"><p>Nothing to show</p><p className="muted">Try another search or filter.</p></div>
                ) : (
                  <div className="tablewrap">
                    <table className="book range">
                      <thead>
                        <tr><th>Item</th><th>Description</th><th className="r">In stock</th><th className="r">On order</th>{SHOW_SALES && <th className="r">Sold last wk</th>}<th className="r">MOQ</th><th className="r">Order qty</th><th className="r">Cost</th><th><span className="visually-hidden">Details</span></th></tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, limit).map((p) => {
                          const l = lineOf.get(p.item.code)
                          const warnings = itemWarnings(p.item, p.stock, l?.qty ?? 0)
                          return (
                            <tr key={p.item.code} className={l ? 'ordering' : undefined}>
                              <td data-label="Item" className="num">{p.item.code}</td>
                              <td data-label="Description" className="desc">
                                {p.item.description}
                                {warnings.map((w) => <small key={w.text} className={'chk ' + w.level}>{w.text}</small>)}
                              </td>
                              <td data-label="In stock" className="r">{p.stock?.inventory ?? '–'}</td>
                              <td data-label="On order" className="r">{p.stock?.qty_on_po ?? '–'}</td>
                              {SHOW_SALES && <td data-label="Sold last week" className="r">{p.stock?.sales_qty ?? '–'}</td>}
                              <td data-label="MOQ" className="r">{p.stock?.moq ?? '–'}</td>
                              <td data-label="Order qty" className="r"><QtyCell key={p.item.code + (l?.revision ?? 0)} item={p.item.description} qty={l?.qty} onCommit={(text) => setQty(p, text)} /></td>
                              <td data-label="Cost" className="r">{l ? money(lineCost(l.qty, l.unit_cost)) : ''}</td>
                              <td className="rowactions"><button type="button" className="btn" aria-label={`Details for ${p.item.description}`} onClick={() => open(p)}>Details</button></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {rows.length > limit && (
                      <div className="actions"><button type="button" className="btn" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more of {rows.length - limit}</button></div>
                    )}
                  </div>
                )}
              </section>
            </div>

            <aside className="ledger orderledger" aria-label="Totals and actions">
              <div className="ledger-head" role="status">
                <p>{t.lines === 0 ? `Nothing ordered from ${vendor} yet` : `${t.lines} ${t.lines === 1 ? 'line' : 'lines'}, ${t.units} units`}</p>
              </div>
              <div className="ledger-body">
                <dl>
                  <dt className="total">Cost</dt><dd className="total">{money(t.cost)}</dd>
                </dl>
                <dl className="ledger-meta">
                  <dt>Vendor</dt><dd>{vendor}</dd>
                  <dt>Status</dt><dd><StatusChip status={order.status} /></dd>
                  <dt>Started by</dt><dd>{who(order.created_by) || '–'}</dd>
                  <dt>Stock</dt><dd>{syncedLabel(synced).replace('Stock ', '')}</dd>
                </dl>
                <div className="actions">
                  <button type="button" className={'btn primary wide' + (t.lines ? '' : ' blocked')} aria-disabled={!t.lines} onClick={() => t.lines && setCopyOpen(true)}>Copy for NAV</button>
                  <button type="button" className="btn wide" onClick={holdAndNext}>Save and start another order</button>
                </div>
                {holds.length > 0 && (
                  <div className="onhold">
                    <small>On hold</small>
                    {holds.map((d) => <button key={d.id} type="button" className="quiet" onClick={() => chooseVendor(d.vendor_no)}>{d.vendor_no} · {d.lines} {d.lines === 1 ? 'line' : 'lines'}</button>)}
                  </div>
                )}
              </div>
            </aside>
          </div>

          <div className="stickybar">
            <div><small>{vendor} · {t.lines} {t.lines === 1 ? 'line' : 'lines'}, {t.units} units</small><b className="num">{money(t.cost)}</b></div>
            <button type="button" className={'btn primary' + (t.lines ? '' : ' blocked')} aria-disabled={!t.lines} onClick={() => t.lines && setCopyOpen(true)}>Copy for NAV</button>
          </div>

          {sheet && (
            <ItemSheet key={sheet.product.item.code} product={sheet.product} focusQty={sheet.focusQty} existing={lineOf.get(sheet.product.item.code)} conflict={sheet.conflict}
              busy={pending > 0} onDone={sheetDone} onClose={() => setSheet(null)}
              onRemove={async () => { if (await save(sheet.product, 0, sheet.base)) { setScanMsg(`Removed ${sheet.product.item.description}`); setSheet(null) } }} />
          )}
          {copyOpen && <CopyDialog lines={lines} wasCopied={order.status === 'copied'} onCopied={() => changeStatus('copied')} onOrdered={(r) => changeStatus('ordered', r)} onDelete={deleteCurrent} onClose={() => setCopyOpen(false)} />}
          {scanning && <Scanner onScan={handleScan} onClose={() => setScanning(false)} feedback={scanMsg} />}
        </>
      )}
    </div>
  )
}

/** The quantity in a row. Saves when you leave the box or press Enter; a bad number goes back to what was saved. Empty = not ordered. */
function QtyCell({ item, qty, onCommit }: { item: string; qty: number | undefined; onCommit: (text: string) => void }) {
  const saved = qty === undefined ? '' : String(qty)
  const [text, setText] = useState(saved)
  const commit = () => {
    if (text.trim() !== '' && parseQty(text) === null) { onCommit(text); setText(saved); return }
    if (text !== saved) onCommit(text)
  }
  return (
    <input className="qty" inputMode="numeric" autoComplete="off" placeholder="0" aria-label={`Order quantity for ${item}`} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
  )
}
