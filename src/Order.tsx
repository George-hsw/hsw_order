import { useCallback, useEffect, useMemo, useState } from 'react'
import CopyDialog from './CopyDialog'
import ItemSheet from './ItemSheet'
import Scanner from './Scanner'
import StatusChip from './StatusChip'
import { useToast } from './Toast'
import { api, ConflictError, type Catalogue } from './lib/api'
import { beep, primeAudio } from './lib/beep'
import { findByScan, groupByVendor, isStale, itemWarnings, lineCost, money, parseQty, searchItems, syncedLabel, totals, vendorOf, vendorOptions, type Product } from './lib/order'
import { DEMO, type ItemRow, type OrderLine, type OrderRow, type StoreRow } from './lib/supabase'

interface Props { email: string; multi: boolean; stores: StoreRow[]; names: Record<string, string>; onSaved: () => void }

const STORE_KEY = 'hsw-orders-store'
type Load = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; cat: Catalogue; order: OrderRow }
interface Sheet { product: Product; base: number; conflict?: OrderLine | null }

/** The store's current order: scan or search, set a quantity, press Done. The same lines show on every device. */
export default function Order({ email, multi, stores, names, onSaved }: Props) {
  const toast = useToast()
  const [storeId, setStoreId] = useState(() => {
    try { const s = localStorage.getItem(STORE_KEY); if (s && stores.some((x) => x.id === s)) return s } catch { /* ignore */ }
    return stores[0]?.id ?? ''
  })
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [lines, setLines] = useState<OrderLine[]>([])
  const [attempt, setAttempt] = useState(0)
  const [find, setFind] = useState('')
  const [filter, setFilter] = useState<'all' | 'look'>('all')
  const [vendor, setVendor] = useState('') // '' = all vendors. A NAV purchase order is made for one vendor, so this narrows everything below.
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [pending, setPending] = useState(0)

  const who = (e: string | null) => (e ? names[e.toLowerCase()] ?? e : '')

  useEffect(() => {
    if (!storeId) return
    let live = true
    setLoad({ phase: 'loading' })
    Promise.all([api.catalogue(storeId), api.openOrder(storeId, email)])
      .then(([cat, od]) => { if (!live) return; setLines(od.lines); setLoad({ phase: 'ready', cat, order: od.order }) })
      .catch(() => live && setLoad({ phase: 'error' }))
    return () => { live = false }
  }, [storeId, email, attempt])

  const orderId = load.phase === 'ready' ? load.order.id : ''
  useEffect(() => (orderId ? api.subscribe(orderId, setLines) : undefined), [orderId])

  const changeStore = (id: string) => {
    setStoreId(id)
    setVendor('')
    try { localStorage.setItem(STORE_KEY, id) } catch { /* ignore */ }
  }

  const cat = load.phase === 'ready' ? load.cat : null
  const order = load.phase === 'ready' ? load.order : null
  const itemOf = useMemo(() => new Map((cat?.items ?? []).map((i) => [i.code, i])), [cat])
  const stockOf = useMemo(() => new Map((cat?.stock ?? []).map((s) => [s.item_code, s])), [cat])
  const synced = cat?.stock[0]?.synced_at
  const stale = isStale(synced)
  const vendors = useMemo(() => (cat ? vendorOptions(cat.items, cat.stock) : []), [cat])
  const inVendor = (item: ItemRow) => !vendor || vendorOf(item, stockOf.get(item.code)) === vendor
  const matches = useMemo(
    () => (cat ? searchItems(cat.items, find, 200).filter((i) => !vendor || vendorOf(i, stockOf.get(i.code)) === vendor).slice(0, 20) : []),
    [cat, find, vendor, stockOf],
  )

  const productOf = (item: ItemRow): Product => ({ item, stock: stockOf.get(item.code) })
  /** A line whose item has left the catalogue still shows, from what the line itself kept. */
  const itemForLine = (l: OrderLine): ItemRow =>
    itemOf.get(l.item_code) ?? { code: l.item_code, description: l.description, vendor_no: l.vendor_no, vendor_item_no: null, barcode: null, division: null,
      category: null, status: '', price: null, sales_uom: null, base_uom: null, blocked: false, exclude_from_replen: false }

  const open = (item: ItemRow) => {
    setSheet({ product: productOf(item), base: lines.find((l) => l.item_code === item.code)?.revision ?? 0 })
    setFind('')
  }

  /** Done: save one line. Returns true when it saved. */
  const save = async (item: ItemRow, qty: number, base: number): Promise<boolean> => {
    if (!order) return false
    setPending((n) => n + 1)
    try {
      const stock = stockOf.get(item.code)
      const next = await api.saveLine(order.id, email, { item, qty, unitCost: stock?.store_cost ?? 0, vendorNo: vendorOf(item, stock) }, base)
      setLines(next)
      onSaved()
      return true
    } catch (e) {
      if (e instanceof ConflictError) {
        setSheet((s) => (s && s.product.item.code === item.code ? { ...s, base: e.current?.revision ?? 0, conflict: e.current ?? null } : s))
        if (!sheet) toast.error(`${who(e.current?.updated_by ?? null) || 'Someone'} changed ${item.description}. The new quantity is shown.`)
      } else toast.error('That did not save. Check your connection and try again.')
      return false
    } finally {
      setPending((n) => n - 1)
    }
  }

  const sheetDone = async (qty: number) => {
    if (!sheet) return
    const { item } = sheet.product
    if (await save(item, qty, sheet.base)) {
      setScanMsg(qty > 0 ? `Saved ${qty} × ${item.description}` : `Removed ${item.description}`)
      setSheet(null)
      if (!scanning) toast.success(qty > 0 ? `Saved ${qty} × ${item.description}.` : `Removed ${item.description}.`)
    }
  }

  const handleScan = (value: string) => {
    if (sheet || !cat) return // one item at a time: ignore scans while the sheet is open
    const it = findByScan(cat.items, value)
    if (!it) { beep('miss'); setScanMsg(`${value} is not in the item list`); return }
    beep('ok')
    setScanMsg(inVendor(it) ? it.description : `${it.description} is from ${vendorOf(it, stockOf.get(it.code)) ?? 'no vendor'}, not ${vendor}`)
    open(it)
  }

  const onFinderEnter = () => {
    if (!cat) return
    const exact = findByScan(cat.items, find)
    const it = exact ?? matches[0]
    if (it) open(it)
    else if (find.trim()) toast.error('No item matches that.')
  }

  const setQty = async (l: OrderLine, text: string) => {
    const q = parseQty(text)
    if (q === null) return toast.error('Enter a whole number, like 6.')
    if (q === l.qty) return
    await save(itemForLine(l), q, l.revision)
  }

  const removeLine = async (l: OrderLine) => {
    if (await save(itemForLine(l), 0, l.revision)) toast.info(`Removed ${l.description}.`)
  }

  const changeStatus = useCallback(async (status: 'copied' | 'ordered', navRef?: string) => {
    if (!order) return
    try {
      const o = await api.setStatus(order.id, status, navRef)
      if (status === 'ordered') {
        setCopyOpen(false)
        toast.success(`Order ${o.nav_ref ?? ''} marked as ordered. A new order is ready.`)
        setAttempt((a) => a + 1)
      } else setLoad((l) => (l.phase === 'ready' ? { ...l, order: o } : l))
      onSaved()
    } catch { toast.error('Could not update the order. Try again.') }
  }, [order, onSaved, toast])

  // ---- the lines on screen ----
  const scoped = useMemo(() => (vendor ? lines.filter((l) => (l.vendor_no ?? '') === vendor) : lines), [lines, vendor])
  const rows = useMemo(() => {
    const all = [...scoped].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((l) => {
      const item = itemOf.get(l.item_code)
      const warnings = item ? itemWarnings(item, stockOf.get(l.item_code), l.qty) : []
      return { line: l, item, stock: stockOf.get(l.item_code), warnings }
    })
    return filter === 'look' ? all.filter((r) => r.warnings.length > 0) : all
  }, [scoped, itemOf, stockOf, filter])
  const lookCount = useMemo(() => scoped.filter((l) => { const i = itemOf.get(l.item_code); return i && itemWarnings(i, stockOf.get(l.item_code), l.qty).length > 0 }).length, [scoped, itemOf, stockOf])

  const t = totals(scoped)
  const groups = groupByVendor(scoped)
  const editedAfterCopy = !!order?.copied_at && lines.some((l) => l.updated_at > order.copied_at!)
  const storeName = stores.find((s) => s.id === storeId)?.name ?? ''

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
              <select name="vendor" value={vendor} onChange={(e) => setVendor(e.target.value)}>
                <option value="">All vendors</option>
                {vendors.map((v) => <option key={v.vendor} value={v.vendor}>{v.vendor} ({v.items})</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      {load.phase === 'loading' && <div className="skeleton" aria-busy="true" aria-label="Loading the order"><i /><i /><i /><i /></div>}
      {load.phase === 'error' && (
        <div className="state error"><p>The order did not load</p><p className="muted">Check your connection and try again.</p>
          <div className="actions"><button type="button" className="btn" onClick={() => setAttempt((a) => a + 1)}>Try again</button></div></div>
      )}

      {load.phase === 'ready' && cat && order && (
        <>
          {stale && <p className="note bad">This store’s stock has not refreshed since {synced ? new Date(synced).toLocaleDateString('en-AU', { weekday: 'long' }) : 'it was set up'}. Check the figures against NAV before you order.</p>}
          {order.status === 'copied' && !editedAfterCopy && <p className="note">This order has been copied for NAV. Enter the NAV order number when it is done.</p>}
          {editedAfterCopy && <p className="note bad">Lines changed after this order was copied. Copy it again before you use it in NAV.</p>}

          <div className="workspace">
            <div className="sheet">
              <section className="block">
                <h2>Items <small>{t.lines} {t.lines === 1 ? 'line' : 'lines'}{pending > 0 ? ' · Saving…' : ''}</small></h2>
                <div className="finder">
                  <div className="findrow">
                    <input type="search" name="find" aria-label="Find an item" placeholder="Scan, or type a code, barcode or name…" value={find} enterKeyHint="search"
                      autoComplete="off" onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onFinderEnter()} />
                    <button type="button" className="btn" onClick={() => { primeAudio(); setScanMsg(''); setScanning(true) }}>
                      <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M12 8v8M16 8v8" /></svg>
                      Scan
                    </button>
                  </div>
                  {!DEMO && <p className="muted desktop-only">Scan with your phone: sign in on it and tap Scan. Each line you save appears here a moment later.</p>}
                  {matches.length > 0 && (
                    <ul className="results">
                      {matches.map((m) => (
                        <li key={m.code} onClick={() => open(m)}>
                          <b>{m.code}</b> {m.description}
                          <span>{stockOf.get(m.code) ? `${stockOf.get(m.code)!.inventory} in stock` : 'no stock record'}{m.blocked ? ', blocked' : ''}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {scoped.length > 0 && (
                  <div className="filters">
                    <div className="segmented" role="group" aria-label="Show lines">
                      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All ({scoped.length})</button>
                      <button type="button" aria-pressed={filter === 'look'} onClick={() => setFilter('look')}>Needs a look ({lookCount})</button>
                    </div>
                  </div>
                )}

                {scoped.length === 0 ? (
                  <div className="state"><p>{vendor ? `Nothing ordered from ${vendor} yet` : 'No items on this order yet'}</p><p className="muted">Scan a barcode or search for an item, enter a quantity and press Done.</p></div>
                ) : rows.length === 0 ? (
                  <div className="state"><p>Nothing needs a look</p><p className="muted">Every line is in order.</p></div>
                ) : (
                  <div className="tablewrap">
                    <table className="items order">
                      <thead>
                        <tr><th>Item</th><th>Description</th><th className="r">In stock</th><th className="r">On order</th><th className="r">Sold last wk</th><th className="r">MOQ</th><th>Order qty</th><th className="r">Cost</th><th><span className="visually-hidden">Remove</span></th></tr>
                      </thead>
                      <tbody>
                        {rows.map(({ line: l, stock, warnings }) => (
                          <tr key={l.id}>
                            <td data-label="Item" className="num">{l.item_code}</td>
                            <td data-label="Description" className="desc">{l.description}
                              <small>{l.vendor_no ?? 'No vendor'}</small>
                              {warnings.map((w) => <small key={w.text} className={'chk ' + w.level}>{w.text}</small>)}
                            </td>
                            <td data-label="In stock" className="r">{stock?.inventory ?? '–'}</td>
                            <td data-label="On order" className="r">{stock?.qty_on_po ?? '–'}</td>
                            <td data-label="Sold last week" className="r">{stock?.sales_qty ?? '–'}</td>
                            <td data-label="MOQ" className="r">{stock?.moq ?? '–'}</td>
                            <td data-label="Order qty"><QtyCell key={l.id + l.revision} line={l} onCommit={(text) => setQty(l, text)} /></td>
                            <td data-label="Cost" className="r">{money(lineCost(l.qty, l.unit_cost))}</td>
                            <td className="x"><button type="button" className="btn" aria-label={`Remove ${l.description}`} onClick={() => removeLine(l)}>&times;</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <aside className="ledger" aria-label="Totals and actions">
              <div className="ledger-head" role="status">
                <p>{t.lines === 0 ? 'Nothing to order yet' : `${t.lines} ${t.lines === 1 ? 'line' : 'lines'}, ${t.units} units`}</p>
              </div>
              <div className="ledger-body">
                <dl>
                  {groups.map((g) => <div key={g.vendor} className="vendorrow"><dt>{g.vendor}</dt><dd>{money(g.totals.cost)}</dd></div>)}
                  <dt className="total">Cost</dt><dd className="total">{money(t.cost)}</dd>
                </dl>
                <dl className="ledger-meta">
                  <dt>Status</dt><dd><StatusChip status={order.status} /></dd>
                  <dt>Started by</dt><dd>{who(order.created_by) || '–'}</dd>
                  <dt>Stock</dt><dd>{syncedLabel(synced).replace('Stock ', '')}</dd>
                </dl>
                <div className="actions">
                  <button type="button" className={'btn primary wide' + (t.lines ? '' : ' blocked')} aria-disabled={!t.lines} onClick={() => t.lines && setCopyOpen(true)}>Copy for NAV</button>
                </div>
              </div>
            </aside>
          </div>

          <div className="stickybar">
            <div><small>{t.lines} {t.lines === 1 ? 'line' : 'lines'}, {t.units} units</small><b className="num">{money(t.cost)}</b></div>
            <button type="button" className={'btn primary' + (t.lines ? '' : ' blocked')} aria-disabled={!t.lines} onClick={() => t.lines && setCopyOpen(true)}>Copy for NAV</button>
          </div>

          {sheet && (
            <ItemSheet key={sheet.product.item.code} product={sheet.product} outsideVendor={vendor && !inVendor(sheet.product.item) ? vendor : ''} existing={lines.find((l) => l.item_code === sheet.product.item.code)} conflict={sheet.conflict}
              busy={pending > 0} onDone={sheetDone} onClose={() => setSheet(null)}
              onRemove={async () => { if (await save(sheet.product.item, 0, sheet.base)) { setScanMsg(`Removed ${sheet.product.item.description}`); setSheet(null) } }} />
          )}
          {copyOpen && <CopyDialog lines={scoped} wasCopied={order.status === 'copied'} onCopied={() => changeStatus('copied')} onOrdered={(r) => changeStatus('ordered', r)} onClose={() => setCopyOpen(false)} />}
          {scanning && <Scanner onScan={handleScan} onClose={() => setScanning(false)} feedback={scanMsg} />}
        </>
      )}
    </div>
  )
}

/** The quantity in a row. Saves when you leave the box or press Enter; a bad number goes back to what was saved. */
function QtyCell({ line, onCommit }: { line: OrderLine; onCommit: (text: string) => void }) {
  const [text, setText] = useState(String(line.qty))
  const commit = () => { if (text !== String(line.qty)) onCommit(text); if (parseQty(text) === null) setText(String(line.qty)) }
  return (
    <input className="qty" inputMode="numeric" autoComplete="off" aria-label={`Order quantity for ${line.description}`} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur())} />
  )
}
