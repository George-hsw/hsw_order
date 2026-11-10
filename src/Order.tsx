import { useCallback, useEffect, useMemo, useState } from 'react'
import CopyDialog from './CopyDialog'
import ItemSheet from './ItemSheet'
import Scanner from './Scanner'
import StatusChip from './StatusChip'
import Loading from './Loading'
import PreparedOrder, { type PrepLine } from './PreparedOrder'
import { useToast } from './Toast'
import { api, ConflictError } from './lib/api'
import { suggestLine, type OrderNeed, type Suggestion } from './lib/suggest'
import { movCheck } from './lib/mov'
import MovFlag from './MovFlag'
import { COVER_CHOICES, DEFAULT_COVER, MIN_WEEKS, coverText, perWeekText, stockInsight, type Rates, type StockInsight } from './lib/insights'
import { salesApi } from './lib/sales/api'
import { needsByItem, type CustomerOrderNeed } from './lib/customerOrders'
import { track, trackError } from './lib/analytics/track'
import { beep, primeAudio } from './lib/beep'
import { SHOW_SALES, SORT_LABEL, findByScan, isStale, itemWarnings, moqNote, lineCost, money, parseQty, searchItems, sortProducts, stockBelow, syncedLabel, totals, type Product, type SortBy, type VendorOption } from './lib/order'
import { DEMO, type OrderLine, type OrderRow, type OrderSummary, type StoreRow } from './lib/supabase'

interface Props { email: string; multi: boolean; stores: StoreRow[]; names: Record<string, string>; onSaved: () => void; jump?: { storeId: string; vendor: string; item: string; show?: 'low' | 'new' } | null }

const STORE_KEY = 'hsw-orders-store'
const PAGE = 100 // rows shown at a time: a vendor can have hundreds of items
type CatLoad = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; vendors: VendorOption[]; syncedAt?: string }
type OrderLoad = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; order: OrderRow | null } // null: nothing saved yet, so no order exists
interface Sheet { product: Product; base: number; focusQty: boolean; conflict?: OrderLine | null }
type Show = 'all' | 'ordered' | 'not' | 'low' | 'new'

/**
 * An order is for one vendor, like the NAV purchase order it becomes. Choose the vendor and the whole range the store
 * orders from them is listed: type a quantity beside each item, or scan to jump to one. Each vendor's order saves as you go,
 * so you can leave it on hold and start the next vendor's.
 */
export default function Order({ email, multi, stores, names, onSaved, jump }: Props) {
  const toast = useToast()
  const [storeId, setStoreId] = useState(() => {
    if (jump && stores.some((x) => x.id === jump.storeId)) return jump.storeId // arriving from the Sales tab
    try { const s = localStorage.getItem(STORE_KEY); if (s && stores.some((x) => x.id === s)) return s } catch { /* ignore */ }
    return stores[0]?.id ?? ''
  })
  const [vendor, setVendor] = useState(jump && stores.some((x) => x.id === jump.storeId) ? jump.vendor : '') // '' = none chosen yet
  const [catLoad, setCatLoad] = useState<CatLoad>({ phase: 'loading' })
  const [drafts, setDrafts] = useState<OrderSummary[]>([])
  const [orderLoad, setOrderLoad] = useState<OrderLoad>({ phase: 'loading' })
  const [lines, setLines] = useState<OrderLine[]>([])
  const [rangeList, setRangeList] = useState<Product[]>([]) // the chosen vendor's items at this store
  const [attempt, setAttempt] = useState(0)
  const [orderAttempt, setOrderAttempt] = useState(0)
  const [find, setFind] = useState(jump && stores.some((x) => x.id === jump.storeId) ? jump.item : '')
  const [show, setShow] = useState<Show>(jump?.show ?? 'all')
  const [below, setBelow] = useState('') // show only items with less than this much in stock ('' = no limit)
  const [sortBy, setSortBy] = useState<SortBy>('code')
  const [limit, setLimit] = useState(PAGE)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [pending, setPending] = useState(0)
  const [rates, setRates] = useState<Rates | null>(null) // weekly sales per item at this store, from the loaded Sales weeks
  const [target, setTarget] = useState(DEFAULT_COVER) // weeks of stock this store aims to hold
  const [needs, setNeeds] = useState<CustomerOrderNeed[]>([]) // customer orders still to order
  const [needsAttempt, setNeedsAttempt] = useState(0)
  const [filling, setFilling] = useState(false) // the suggested quantities are being filled in or taken out
  const [filled, setFilled] = useState<{ code: string; qty: number }[]>([]) // what the last Add put in, so it can be undone
  const [pane, setPane] = useState<'suggested' | 'items' | null>(null) // null: choose by what there is to show
  const [needList, setNeedList] = useState<OrderNeed[] | null>(null) // what each vendor needs ordering, shown before a vendor is chosen

  const who = (e: string | null) => (e ? names[e.toLowerCase()] ?? e : '')
  const refreshDrafts = useCallback(() => { api.drafts(storeId).then(setDrafts).catch(() => { /* the list is a convenience */ }) }, [storeId])

  // The vendors (a few dozen rows, so the picker shows at once) and what is on hold. A vendor's items load when it is chosen.
  useEffect(() => {
    if (!storeId) return
    let live = true
    setCatLoad({ phase: 'loading' })
    Promise.all([api.vendors(storeId), api.drafts(storeId)])
      .then(([v, d]) => { if (!live) return; setDrafts(d); setCatLoad({ phase: 'ready', vendors: v.options, syncedAt: v.syncedAt }) })
      .catch(() => live && setCatLoad({ phase: 'error' }))
    return () => { live = false }
  }, [storeId, attempt])

  // The chosen vendor's order if one was already started, and its items. Opening a vendor creates nothing: the order starts when the first quantity is saved.
  useEffect(() => {
    if (!storeId || !vendor) return
    let live = true
    setOrderLoad({ phase: 'loading' })
    Promise.all([api.findOrder(storeId, vendor), api.range(storeId, vendor)])
      .then(([od, products]) => { if (!live) return; setLines(od?.lines ?? []); setRangeList(products); setOrderLoad({ phase: 'ready', order: od?.order ?? null }) })
      .catch(() => live && setOrderLoad({ phase: 'error' }))
    return () => { live = false }
  }, [storeId, vendor, email, orderAttempt])

  // How fast each item sells here, and the store's cover target. Both are extras: if they fail, ordering still works.
  useEffect(() => {
    if (!storeId) return
    let live = true
    setRates(null)
    salesApi.itemRates(storeId).then((r) => live && setRates(r)).catch((e) => { trackError('item rates', e) })
    api.coverTarget(storeId).then((w) => live && setTarget(w)).catch(() => live && setTarget(DEFAULT_COVER))
    return () => { live = false }
  }, [storeId])

  // Customer orders waiting to be ordered: warned about on the vendor that supplies them.
  useEffect(() => {
    if (!storeId) return
    let live = true
    api.customerOrders([storeId]).then((n) => live && setNeeds(n)).catch((e) => { trackError('customer orders', e); if (live) setNeeds([]) })
    return () => { live = false }
  }, [storeId, needsAttempt])
  const markOrdered = async (n: CustomerOrderNeed) => {
    try {
      await api.setFulfilment(n.id, 'ordered')
      track('customer_order_step', { to: 'ordered' }, storeId)
      toast.success(`${n.doc_number} for ${n.customer_name} marked as ordered.`)
      setNeedsAttempt((a) => a + 1)
    } catch (e) { trackError('customer order', e); toast.error('Could not update the customer order. Try again.') }
  }

  useEffect(() => { setPane(null) }, [vendor])
  // Which vendors need ordering at this store, for the list shown before one is chosen.
  useEffect(() => {
    if (!storeId || vendor) return
    let live = true
    setNeedList(null)
    api.orderNeeds([storeId]).then((n) => live && setNeedList(n)).catch((e) => { trackError('order needs', e); if (live) setNeedList([]) })
    return () => { live = false }
  }, [storeId, vendor, attempt])

  const orderId = orderLoad.phase === 'ready' ? orderLoad.order?.id ?? '' : ''
  useEffect(() => (orderId ? api.subscribe(orderId, setLines) : undefined), [orderId])
  useEffect(() => { setLimit(PAGE) }, [vendor, show, find, below, sortBy])

  const openScanner = () => { primeAudio(); setScanMsg(''); (document.activeElement as HTMLElement | null)?.blur?.(); setScanning(true) }
  useEffect(() => { if (!window.BarcodeDetector) void import('@zxing/browser') }, []) // warm the scanner code on iPhones so the camera starts at once
  // An order that never got a line is not kept: leaving it (or an old empty one) removes it quietly.
  const dropIfEmpty = () => { if (order && order.status === 'open' && lines.length === 0 && pending === 0) void api.deleteOrder(order.id).then(onSaved).catch(() => undefined) }
  const chooseVendor = (v: string) => { dropIfEmpty(); setFilled([]); setVendor(v); setFind(''); setShow('all'); setBelow(''); setSortBy('code'); if (!v) refreshDrafts() }
  const changeStore = (id: string) => {
    setStoreId(id)
    setVendor('')
    try { localStorage.setItem(STORE_KEY, id) } catch { /* ignore */ }
  }

  const cat = catLoad.phase === 'ready' ? catLoad : null
  const ready = orderLoad.phase === 'ready' && !!vendor
  const order = orderLoad.phase === 'ready' && vendor ? orderLoad.order : null
  const synced = cat?.syncedAt
  const stale = isStale(synced)
  const vendors = cat?.vendors ?? []
  const draftOf = useMemo(() => new Map(drafts.map((d) => [d.vendor_no, d])), [drafts])
  const range = vendor ? rangeList : []
  const lineOf = useMemo(() => new Map(lines.map((l) => [l.item_code, l])), [lines])
  const enough = !!rates && rates.weeks >= MIN_WEEKS
  const insightOf = useMemo(() => {
    const m = new Map<string, StockInsight>()
    if (enough) for (const p of range) m.set(p.item.code, stockInsight(p.stock, rates!.perWeek.get(p.item.code) ?? 0, target, p.stock?.moq ?? 1, lineOf.get(p.item.code)?.qty ?? 0))
    return m
  }, [range, rates, enough, target, lineOf])
  const waiting = useMemo(() => needsByItem(needs, storeId), [needs, storeId])
  const vendorNeeds = useMemo(() => needs.filter((n) => n.lines.some((l) => l.vendor === vendor || range.some((p) => p.item.code === l.code))), [needs, vendor, range])
  const isNew = (p: Product) => p.item.status.trim().toUpperCase() === 'NEW'
  // Items that cannot be ordered (blocked, excluded, PO-blocked) are not flagged low: the same rule as the bell.
  const orderable = (p: Product) => !p.item.blocked && !p.item.exclude_from_replen && !p.stock?.po_blocked
  const isLow = (p: Product) => orderable(p) && !!insightOf.get(p.item.code)?.low
  const lowCount = useMemo(() => range.filter(isLow).length, [range, insightOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const newCount = useMemo(() => range.filter(isNew).length, [range]) // eslint-disable-line react-hooks/exhaustive-deps

  // The suggested order: the rules in lib/suggest.ts over each orderable item's weekly sales, stock, what is on order and what customers are waiting for.
  const suggestions = useMemo(() => {
    const m = new Map<string, Suggestion>()
    if (!enough || !rates?.series || !rates.storeUnits) return m
    const none: number[] = Array(rates.weeks).fill(0)
    for (const p of range) {
      if (!orderable(p)) continue
      const code = p.item.code
      m.set(code, suggestLine({
        series: rates.series.get(code) ?? none, storeUnits: rates.storeUnits, inventory: p.stock?.inventory ?? 0, onOrder: p.stock?.qty_on_po ?? 0, transferIn: p.stock?.transfer_in ?? 0,
        inOrder: lineOf.get(code)?.qty ?? 0, waiting: (waiting.get(code) ?? []).reduce((a, w) => a + w.qty, 0), moq: p.stock?.moq ?? 1, weeks: target,
      }))
    }
    return m
  }, [range, rates, enough, target, lineOf, waiting]) // eslint-disable-line react-hooks/exhaustive-deps
  // The prepared order: every item the rules say to order that is not already in the order, the ones to decide last.
  const prepLines = useMemo<PrepLine[]>(() => range.flatMap((p) => {
    const sg = suggestions.get(p.item.code)
    return sg && sg.qty > 0 && !lineOf.has(p.item.code) ? [{ code: p.item.code, description: p.item.description, qty: sg.qty, cost: p.stock?.store_cost ?? 0, why: sg.why, brief: sg.brief, hold: sg.hold !== null, stock: p.stock?.inventory ?? 0, moq: p.stock?.moq ?? 1 }] : []
  }).sort((x, y) => Number(x.hold) - Number(y.hold) || y.qty * y.cost - x.qty * x.cost), [range, suggestions, lineOf])
  const activePane = !enough ? 'items' : pane ?? (show !== 'all' || find.trim() ? 'items' : prepLines.length > 0 ? 'suggested' : 'items')
  const stillFilled = filled.filter((f) => lineOf.get(f.code)?.qty === f.qty) // quantities the person has since changed are theirs, and are left alone

  const rows = useMemo(() => {
    const hit = find.trim() ? new Set(searchItems(range.map((p) => p.item), find, 100000).map((i) => i.code)) : null
    const shown = range.filter((p) => {
      if (hit && !hit.has(p.item.code)) return false
      const on = lineOf.has(p.item.code)
      if (show === 'low') return isLow(p)
      if (show === 'new') return isNew(p)
      return show === 'all' || (show === 'ordered' ? on : !on)
    })
    return sortProducts(stockBelow(shown, below.trim() === '' ? null : parseQty(below)), sortBy)
  }, [range, find, show, below, sortBy, lineOf, insightOf]) // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = find.trim() !== '' || show !== 'all' || below.trim() !== ''
  const orderedCount = useMemo(() => range.filter((p) => lineOf.has(p.item.code)).length, [range, lineOf])

  const open = (p: Product, focusQty = false) => { setSheet({ product: p, base: lineOf.get(p.item.code)?.revision ?? 0, focusQty }); setFind('') }

  /** Save one line. Returns true when it saved. */
  const save = async (p: Product, qty: number, base: number): Promise<boolean> => {
    if (!ready) return false
    setPending((n) => n + 1)
    let made: OrderRow | null = null
    try {
      // The first quantity is what starts the order.
      let target = order
      if (!target) {
        const od = await api.openOrder(storeId, vendor, email)
        target = od.order; made = od.order
        setOrderLoad({ phase: 'ready', order: od.order })
        track('order_started', { vendor }, storeId)
      }
      const next = await api.saveLine(target.id, email, { item: p.item, qty, unitCost: p.stock?.store_cost ?? 0, vendorNo: vendor }, base)
      setLines(next)
      onSaved()
      return true
    } catch (e) {
      if (e instanceof ConflictError) {
        setSheet((s) => (s && s.product.item.code === p.item.code ? { ...s, base: e.current?.revision ?? 0, conflict: e.current ?? null } : s))
        if (!sheet) toast.error(`${who(e.current?.updated_by ?? null) || 'Someone'} changed ${p.item.description}. The new quantity is shown.`)
        if (order ?? made) api.orderLines((order ?? made)!.id).then(setLines).catch(() => { /* live updates will catch up */ })
      } else toast.error('That did not save. Check your connection and try again.')
      return false
    } finally {
      setPending((n) => n - 1)
    }
  }

  /** Puts the suggested quantities into the order as ordinary lines. Only items with no quantity yet; every one can be changed afterwards. */
  const fillSuggested = async (entries: { code: string; qty: number }[]) => {
    const want = new Map(entries.map((e) => [e.code, e.qty]))
    const todo = range.filter((p) => want.has(p.item.code) && !lineOf.has(p.item.code))
    if (!todo.length || !ready || filling) return
    setFilling(true)
    const done: { code: string; qty: number }[] = []
    let od = order
    try {
      if (!od) {
        const o = await api.openOrder(storeId, vendor, email)
        od = o.order
        setOrderLoad({ phase: 'ready', order: o.order })
        track('order_started', { vendor }, storeId)
      }
      let latest: OrderLine[] | null = null
      for (const p of todo) {
        const qty = want.get(p.item.code)!
        try { latest = await api.saveLine(od.id, email, { item: p.item, qty, unitCost: p.stock?.store_cost ?? 0, vendorNo: vendor }, 0); done.push({ code: p.item.code, qty }) } catch (e) { if (!(e instanceof ConflictError)) throw e }
      }
      if (latest) setLines(latest)
      setFilled(done)
      onSaved()
      track('suggested_fill', { lines: done.length }, storeId)
      toast.success(`Added ${done.length} ${done.length === 1 ? 'line' : 'lines'} to the order. Change any quantity in All items.`)
      setPane('items'); setShow('ordered')
    } catch (e) {
      trackError('suggested fill', e)
      toast.error('Could not add all of the lines. Check your connection and try again.')
      if (done.length) setFilled(done)
      if (od) api.orderLines(od.id).then(setLines).catch(() => { /* live updates will catch up */ })
    } finally { setFilling(false) }
  }

  /** Takes out what the last Fill put in, but not a quantity the person has changed since. */
  const undoFilled = async () => {
    if (!order || !stillFilled.length || filling) return
    setFilling(true)
    try {
      let latest: OrderLine[] | null = null
      for (const f of stillFilled) {
        const l = lineOf.get(f.code); const p = range.find((r) => r.item.code === f.code)
        if (l && p) latest = await api.saveLine(order.id, email, { item: p.item, qty: 0, unitCost: p.stock?.store_cost ?? 0, vendorNo: vendor }, l.revision)
      }
      if (latest) setLines(latest)
      setFilled([])
      onSaved()
      toast.success('Took out the suggested quantities.')
    } catch (e) { trackError('suggested undo', e); toast.error('Could not take them all out. Check your connection and try again.') } finally { setFilling(false) }
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
    const it = findByScan(range.map((r) => r.item), value)
    const p = it && range.find((r) => r.item.code === it.code)
    if (!it || !p) { beep('miss'); setScanMsg(`${value} is not in the ${vendor} range`); return }
    beep('ok')
    setScanMsg(it.description)
    open(p, true) // after a scan the cursor goes straight to the quantity
  }

  const onFinderEnter = () => {
    if (!cat) return
    const it = findByScan(range.map((r) => r.item), find)
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
      track(status === 'copied' ? 'order_copied' : 'order_ordered', { vendor }, storeId)
      onSaved()
    } catch (e) { trackError('order', e); toast.error('Could not update the order. Try again.') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, vendor, onSaved, toast])

  const deleteCurrent = async () => {
    if (!order) return
    try {
      await api.deleteOrder(order.id)
      setCopyOpen(false)
      toast.success(`${vendor} order deleted.`)
      track('order_deleted', { vendor }, storeId)
      chooseVendor('')
      onSaved()
    } catch (e) { trackError('order', e); toast.error('Could not delete the order. Try again.') }
  }

  const holdAndNext = () => {
    if (lines.length > 0) toast.info(`${vendor} order saved and on hold. Choose the next vendor.`)
    chooseVendor('')
  }

  const t = totals(lines)
  const mov = t.lines > 0 ? movCheck(vendor, t.cost) : null // the vendor's minimum order value, once there is something on the order
  const moqShort = range.filter((p) => { const l = lineOf.get(p.item.code); return !!l && moqNote(l.qty, p.stock?.moq ?? 1) !== null }).length // lines that do not meet their MOQ
  const editedAfterCopy = !!order?.copied_at && lines.some((l) => l.updated_at > order.copied_at!)
  const storeName = stores.find((s) => s.id === storeId)?.name ?? ''
  const holds = drafts.filter((d) => d.lines > 0 && d.vendor_no !== vendor)
  const changeTarget = (w: number) => {
    setTarget(w)
    api.setCoverTarget(storeId, w, email)
      .then(() => toast.success(`${storeName} now aims to hold ${w} ${w === 1 ? 'week' : 'weeks'} of stock.`))
      .catch((e) => { trackError('cover target', e); toast.error('That did not save. The target applies on this screen only until it does.') })
  }

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
          {vendors.length > 0 && (
            <section className="block needs">
              <h2>Needs ordering</h2>
              {needList === null ? <Loading rows={3} /> : (() => {
                const list = [...needList].filter((n) => vendors.some((v) => v.vendor === n.vendor_no)).sort((a, b) => b.cost - a.cost)
                return list.length === 0 ? <p className="muted">Nothing needs ordering right now. Choose a vendor above to order anything yourself.</p> : (
                  <ul className="people">
                    {list.map((n) => (
                      <li key={n.vendor_no}>
                        <div className="who-line">
                          <b>{n.vendor_no}</b>
                          <span className="muted">{n.items} {n.items === 1 ? 'item' : 'items'}, {n.units.toLocaleString('en-AU')} units, about {money(n.cost)}</span>
                          {n.customers > 0 && <span className="chip bad">{n.customers} for waiting customers</span>}
                          {(() => { const open = drafts.find((d) => d.vendor_no === n.vendor_no && d.status === 'open'); const m = movCheck(n.vendor_no, n.cost + (open?.cost ?? 0)); return m && !m.met ? <span className="chip warn">Review: below {money(m.mov)} minimum</span> : null })()}
                          {n.held > 0 && <span className="chip warn">{n.held} for you to decide</span>}
                        </div>
                        <div className="person-actions"><button type="button" className="btn primary" onClick={() => chooseVendor(n.vendor_no)}>Review the order</button></div>
                      </li>
                    ))}
                  </ul>
                )
              })()}
            </section>
          )}
          <div className={vendors.length > 0 && needList && needList.length > 0 ? 'state compact' : 'state'}>
            <p>{vendors.length === 0 ? 'No items for this store yet' : 'Choose a vendor to start an order'}</p>
            <p className="muted">{vendors.length === 0 ? 'Stock appears here after the nightly sync from NAV.' : 'A purchase order is made for one vendor. Pick one above and its whole range for this store is listed.'}</p>
          </div>
          {needs.length > 0 && (
            <section className="block">
              <h2>Customer orders to order</h2>
              <ul className="people">
                {needs.map((n) => (
                  <li key={n.id}>
                    <div className="who-line">
                      <b>{n.doc_number}</b>
                      <span className="muted">{n.customer_name}: {n.lines.map((l) => `${l.qty} × ${l.description}`).join(', ')}</span>
                    </div>
                    <div className="person-actions">
                      {[...new Set(n.lines.map((l) => l.vendor).filter((v): v is string => !!v && vendors.some((x) => x.vendor === v)))].map((v) => (
                        <button key={v} type="button" className="btn" onClick={() => chooseVendor(v)}>Open {v}</button>
                      ))}
                      <button type="button" className="btn" onClick={() => void markOrdered(n)}>Mark ordered</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
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

      {cat && ready && (
        <>
          {vendorNeeds.length > 0 && (
            <div className="note bad custneeds" role="status">
              <p><b>{vendorNeeds.length === 1 ? 'A customer is' : `${vendorNeeds.length} customers are`} waiting on {vendor} items.</b> Add them to this order, then mark the customer order as ordered.</p>
              <ul>
                {vendorNeeds.map((n) => (
                  <li key={n.id}>
                    <span>{n.doc_number}, {n.customer_name}: {n.lines.map((l) => `${l.qty} × ${l.description}`).join(', ')}</span>
                    <button type="button" className="btn" onClick={() => void markOrdered(n)}>Mark ordered</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {order?.status === 'copied' && !editedAfterCopy && <p className="note">This order has been copied for NAV. Enter the NAV order number when it is done.</p>}
          {editedAfterCopy && <p className="note bad">Lines changed after this order was copied. Copy it again before you use it in NAV.</p>}

          <div className="workspace">
            <div className="sheet">
              <section className="block">
                <h2>{vendor} <small>{range.length} items · {orderedCount} on order{pending > 0 ? ' · Saving…' : ''}</small></h2>
                {enough && range.length > 0 && (
                  <div className="segmented vendortabs" role="group" aria-label="What to show">
                    <button type="button" aria-pressed={activePane === 'suggested'} onClick={() => setPane('suggested')}>Suggested order ({prepLines.filter((l) => !l.hold).length})</button>
                    <button type="button" aria-pressed={activePane === 'items'} onClick={() => setPane('items')}>All items ({range.length})</button>
                  </div>
                )}
                {enough && range.length > 0 && activePane === 'suggested' && <PreparedOrder vendor={vendor} weeks={target} orderCost={t.cost} lines={prepLines} loading={rates === null} busy={filling} added={stillFilled.length} onAdd={(e) => void fillSuggested(e)} onUndo={() => void undoFilled()} />}

                {activePane === 'items' && (<>
                <div className="orderbar">
                  <div className="findrow">
                    <input type="search" name="find" aria-label={`Find an item from ${vendor}`} placeholder="Search this vendor, or scan…" value={find} enterKeyHint="search"
                      autoComplete="off" onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onFinderEnter()} />
                    {/* Opens on the touch itself, not on the click that follows: when the keyboard is up, the first tap only closes it and the button moves, so the click never lands. */}
                    <button type="button" className="btn scanbtn" onPointerDown={openScanner} onClick={openScanner}>
                      <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M12 8v8M16 8v8" /></svg>
                      Scan
                    </button>
                  </div>
                  <div className="filters">
                    <div className="segmented" role="group" aria-label="Show items">
                      <button type="button" aria-pressed={show === 'all'} onClick={() => setShow('all')}>All ({range.length})</button>
                      <button type="button" aria-pressed={show === 'ordered'} onClick={() => setShow('ordered')}>On order ({orderedCount})</button>
                      <button type="button" aria-pressed={show === 'not'} onClick={() => setShow('not')}>Not ordered ({range.length - orderedCount})</button>
                      {enough && <button type="button" aria-pressed={show === 'low'} onClick={() => setShow('low')}>Low stock ({lowCount})</button>}
                      {newCount > 0 && <button type="button" aria-pressed={show === 'new'} onClick={() => setShow('new')}>New ({newCount})</button>}
                    </div>
                    <label className="inline">In stock below
                      <input className="qty" name="below" inputMode="numeric" autoComplete="off" placeholder="any" value={below} onChange={(e) => setBelow(e.target.value)} />
                    </label>
                    {enough && (
                      <label className="inline">Hold
                        <select name="cover" value={target} onChange={(e) => changeTarget(Number(e.target.value))} aria-describedby="cover-help">
                          {COVER_CHOICES.map((w) => <option key={w} value={w}>{w} {w === 1 ? 'week' : 'weeks'}</option>)}
                        </select>
                      </label>
                    )}
                    <label className="inline">Sort by
                      <select name="sort" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                        {(Object.keys(SORT_LABEL) as SortBy[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
                      </select>
                    </label>
                  </div>
                  {(filtered || sortBy !== 'code') && range.length > 0 && (
                    <p className="muted listcount">
                      Showing {rows.length} of {range.length} items.{' '}
                      <button type="button" className="quiet" onClick={() => { setFind(''); setShow('all'); setBelow(''); setSortBy('code') }}>Clear filters</button>
                    </p>
                  )}
                  <details className="orderhelp">
                    <summary>How suggestions and scanning work</summary>
                    {enough
                      ? <p className="muted" id="cover-help">Low stock and suggested quantities use this store’s sales over the last {rates!.weeks} weeks loaded, against a target of {target} {target === 1 ? 'week' : 'weeks'} of stock (in stock, on order and on its way). Suggested quantities are only filled in when you press Fill.</p>
                      : rates && <p className="muted" id="cover-help">Low stock warnings and suggested quantities start once {MIN_WEEKS} weeks of item sales are loaded in Sales ({rates.weeks} so far).</p>}
                    {!DEMO && <p className="muted desktop-only">Scan with your phone: sign in on it, choose the same vendor and tap Scan. Quantities you save appear here a moment later.</p>}
                  </details>
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
                          const ins = insightOf.get(p.item.code)
                          return (
                            <tr key={p.item.code} className={l ? 'ordering' : undefined}>
                              <td data-label="Item" className="num">{p.item.code}</td>
                              <td data-label="Description" className="desc">
                                {p.item.description}
                                {isNew(p) && <small className="chk ok">New item</small>}
                                {(waiting.get(p.item.code) ?? []).map((w) => <small key={w.id} className="chk error">Customer order: {w.qty} for {w.customer_name} ({w.doc_number})</small>)}
                                {ins && ins.rate > 0 && <small className="muted">Sells about {perWeekText(ins.rate)} a week, {coverText(ins.cover)}{l ? ' with this order' : ''}</small>}
                                {(() => { const sg = suggestions.get(p.item.code); if (sg && sg.qty > 0) return <small className="chk warn" title={sg.why}>{sg.hold ? `Your call: ${sg.qty}, a long time of sales` : `Suggested ${sg.qty}`}{ins?.low ? ', low stock' : ''}</small>; return ins?.low && orderable(p) ? <small className="chk warn">Low stock</small> : null })()}
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
                </>)}
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
                {moqShort > 0 && <p className="chk error" role="alert">MOQ not met on {moqShort} {moqShort === 1 ? 'line' : 'lines'}. Check before you copy.</p>}
                {mov && !mov.met && <MovFlag check={mov} total={t.cost} />}
                <dl className="ledger-meta">
                  <dt>Vendor</dt><dd>{vendor}</dd>
                  <dt>Status</dt><dd>{order ? <StatusChip status={order.status} /> : 'Not started'}</dd>
                  <dt>Started by</dt><dd>{order ? who(order.created_by) || '–' : 'Starts when you add a quantity'}</dd>
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
            <div><small>{vendor} · {t.lines} {t.lines === 1 ? 'line' : 'lines'}, {t.units} units</small><b className="num">{money(t.cost)}</b>{moqShort > 0 && <small className="chk error">MOQ not met on {moqShort}</small>}{mov && !mov.met && <MovFlag check={mov} total={t.cost} float />}</div>
            <button type="button" className={'btn primary' + (t.lines ? '' : ' blocked')} aria-disabled={!t.lines} onClick={() => t.lines && setCopyOpen(true)}>Copy for NAV</button>
          </div>

          {sheet && (
            <ItemSheet key={sheet.product.item.code} storeId={storeId} product={sheet.product} focusQty={sheet.focusQty} existing={lineOf.get(sheet.product.item.code)} conflict={sheet.conflict}
              busy={pending > 0} onDone={sheetDone} onClose={() => setSheet(null)}
              onRemove={async () => { if (await save(sheet.product, 0, sheet.base)) { setScanMsg(`Removed ${sheet.product.item.description}`); setSheet(null) } }} />
          )}
          {copyOpen && order && <CopyDialog lines={lines} wasCopied={order.status === 'copied'} onCopied={() => changeStatus('copied')} onOrdered={(r) => changeStatus('ordered', r)} onDelete={deleteCurrent} onClose={() => setCopyOpen(false)} />}
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
