import { codeLines, type CustomerOrderNeed, type Fulfilment } from './customerOrders'
import { DEFAULT_COVER, stockInsight } from './insights'
import { salesApi } from './sales/api'
import type { Counted } from './notifications'
import type { OrderData, OrdersApi } from './api'
import { ConflictError } from './api'
import { demoDocs, demoItems, demoLines, demoOrder, demoStock, demoStores } from './demo'
import { applyLine, findByScan, rangeFor, searchItems, totals, vendorOptions } from './order'
import type { OrderLine, OrderRow, OrderSummary, SyncRun } from './supabase'

// In-memory stand-in for the back end. Resets when the page reloads.
const hoursAgo = (n: number) => new Date(Date.now() - n * 36e5).toISOString()
const orders: OrderRow[] = [
  demoOrder(),
  { id: 'o2', store_id: 'demo-0', vendor_no: 'ANAS001', status: 'ordered', nav_ref: 'PO-004512', created_by: 'priya@hsw.com.au', created_at: hoursAgo(170), copied_at: hoursAgo(168), ordered_at: hoursAgo(167), stores: { name: 'Artarmon' } },
  { id: 'o3', store_id: 'demo-1', vendor_no: 'ANAS001', status: 'copied', nav_ref: null, created_by: 'lee@hsw.com.au', created_at: hoursAgo(80), copied_at: hoursAgo(75), ordered_at: null, stores: { name: 'Aspley' } },
]
const lines = new Map<string, OrderLine[]>([
  ['o1', demoLines()],
  ['o2', demoLines().map((l, i) => ({ ...l, id: `p${i}`, order_id: 'o2', qty: l.qty * 2 }))],
  ['o3', demoLines().slice(0, 1).map((l) => ({ ...l, id: 'q0', order_id: 'o3' }))],
])
const subs = new Map<string, Set<(l: OrderLine[]) => void>>()
const covers = new Map<string, number>()
const hiddenNotices = new Map<string, string>() // notices hidden this session in the demo
const fulfilled = new Map<string, Fulfilment>() // demo customer orders moved on this session
const storeName = (id: string) => demoStores().find((s) => s.id === id)?.name ?? ''
const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120))

export const demoApi: OrdersApi = {
  vendors: (storeId) => wait({ options: vendorOptions(demoItems(), demoStock(storeId)), syncedAt: demoStock(storeId)[0]?.synced_at }),
  range: (storeId, vendor) => wait(rangeFor(demoItems(), demoStock(storeId), vendor)),

  async findOrder(storeId, vendor) {
    const order = orders.find((o) => o.store_id === storeId && o.vendor_no === vendor && o.status !== 'ordered')
    return wait(order ? { order, lines: [...(lines.get(order.id) ?? [])] } : null)
  },

  async openOrder(storeId, vendor, email): Promise<OrderData> {
    let order = orders.find((o) => o.store_id === storeId && o.vendor_no === vendor && o.status !== 'ordered')
    if (!order) {
      order = { id: 'o' + (orders.length + 1) + '-' + Date.now(), store_id: storeId, vendor_no: vendor, status: 'open', nav_ref: null, created_by: email,
        created_at: new Date().toISOString(), copied_at: null, ordered_at: null, stores: { name: storeName(storeId) } }
      orders.push(order)
      lines.set(order.id, [])
    }
    return wait({ order, lines: [...(lines.get(order.id) ?? [])] })
  },

  async drafts(storeId) {
    return wait(orders.filter((o) => o.store_id === storeId && o.status !== 'ordered').map((o) => ({ ...o, ...totals(lines.get(o.id) ?? []) })))
  },

  async saveLine(orderId, email, input, baseRevision) {
    const cur = lines.get(orderId) ?? []
    const existing = cur.find((l) => l.item_code === input.item.code)
    if ((existing?.revision ?? 0) !== baseRevision) throw new ConflictError(existing)
    const vendor = orders.find((o) => o.id === orderId)?.vendor_no ?? null
    const next = applyLine(cur, orderId, email, { ...input, vendorNo: vendor }) // a line's vendor is its order's vendor
    lines.set(orderId, next)
    subs.get(orderId)?.forEach((cb) => cb(next))
    return wait(next)
  },

  subscribe(orderId, cb) {
    const set = subs.get(orderId) ?? new Set()
    set.add(cb)
    subs.set(orderId, set)
    return () => { set.delete(cb) }
  },

  async setStatus(orderId, status, navRef) {
    const o = orders.find((x) => x.id === orderId)!
    o.status = status
    const now = new Date().toISOString()
    if (status === 'copied') o.copied_at = now
    if (status === 'ordered') { o.ordered_at = now; o.nav_ref = navRef?.trim() || o.nav_ref }
    if (status === 'open') { o.copied_at = null; o.ordered_at = null }
    return wait({ ...o })
  },

  async deleteOrder(orderId) {
    const i = orders.findIndex((o) => o.id === orderId)
    if (i < 0) throw new Error('No such order')
    if (orders[i].status === 'ordered') throw new Error('An order ordered in NAV is kept as a record')
    orders.splice(i, 1)
    lines.delete(orderId)
    return wait(undefined)
  },

  async listOrders(storeIds) {
    const out: OrderSummary[] = orders.filter((o) => storeIds.includes(o.store_id)).map((o) => ({ ...o, ...totals(lines.get(o.id) ?? []) }))
    return wait(out.sort((a, b) => b.created_at.localeCompare(a.created_at)))
  },

  orderLines: (orderId) => wait([...(lines.get(orderId) ?? [])]),


  findItems(storeId, query) {
    const items = demoItems()
    const exact = findByScan(items, query)
    const hits = exact ? [exact] : searchItems(items, query, 30)
    const stock = demoStock(storeId)
    return wait(hits.map((item) => ({ item, stock: stock.find((s) => s.item_code === item.code) })))
  },
  customerOrders(storeIds) {
    const items = demoItems()
    const out: CustomerOrderNeed[] = demoDocs()
      .filter((d) => d.doc_type === 'Customer Order' && (fulfilled.get(d.id) ?? d.fulfilment) === 'to_order' && storeIds.includes(d.store_id))
      .map((d) => ({ id: d.id, store_id: d.store_id, doc_number: d.doc_number, customer_name: d.customer_name, created_at: d.created_at,
        lines: codeLines(d.payload).map((w) => { const it = items.find((i) => i.code === w.code); return { ...w, description: it?.description ?? w.code, vendor: demoStock(d.store_id).find((s) => s.item_code === w.code)?.vendor_no ?? it?.vendor_no ?? null } }) }))
    return wait(out)
  },
  async setFulfilment(docId, to) { fulfilled.set(docId, to); await wait(null) },
  async lowStock(storeIds) {
    const items = demoItems()
    const out: Counted[] = []
    for (const store_id of storeIds) {
      const rates = await salesApi.itemRates(store_id)
      const per = new Map<string, number>()
      for (const s of demoStock(store_id)) {
        const it = items.find((i) => i.code === s.item_code)
        if (!it || it.blocked || it.exclude_from_replen || s.po_blocked || !s.vendor_no) continue
        if (stockInsight(s, rates.perWeek.get(s.item_code) ?? 0, covers.get(store_id) ?? DEFAULT_COVER, s.moq).low) per.set(s.vendor_no, (per.get(s.vendor_no) ?? 0) + 1)
      }
      for (const [vendor_no, n] of per) out.push({ store_id, vendor_no, items: n })
    }
    return wait(out)
  },
  newItems(storeIds) {
    const items = demoItems().filter((i) => i.status.trim().toUpperCase() === 'NEW')
    const out: Counted[] = []
    for (const store_id of storeIds) {
      const per = new Map<string, number>()
      for (const s of demoStock(store_id)) if (items.some((i) => i.code === s.item_code) && s.vendor_no) per.set(s.vendor_no, (per.get(s.vendor_no) ?? 0) + 1)
      for (const [vendor_no, n] of per) out.push({ store_id, vendor_no, items: n })
    }
    return wait(out)
  },
  overdueInvoices(storeIds) {
    const today = new Date().toLocaleDateString('en-CA')
    return wait(demoDocs().filter((d) => d.doc_type === 'Tax Invoice' && d.status !== 'paid' && d.status !== 'void' && !!d.due_date && d.due_date < today && storeIds.includes(d.store_id))
      .map((d) => ({ store_id: d.store_id, doc_number: d.doc_number, customer_name: d.customer_name, due_date: d.due_date!, balance_cents: d.total_cents - d.payments.reduce((a, p) => a + p.amount_cents, 0) })))
  },
  dismissals: () => wait(new Map([...hiddenNotices].filter(([, u]) => u > new Date().toISOString()))),
  async dismiss(keys, until) { for (const k of keys) hiddenNotices.set(k, until); await wait(null) },
  coverTarget: (storeId) => wait(covers.get(storeId) ?? DEFAULT_COVER),
  async setCoverTarget(storeId, weeks) { covers.set(storeId, weeks); await wait(null) },

  async syncRuns() {
    const runs: SyncRun[] = demoStores().map((s, i) => ({
      store_id: s.id, finished_at: new Date(Date.now() - (i === 3 ? 60 : 3) * 36e5).toISOString(), ok: i !== 3, rows: 1950 + i * 11,
      message: i === 3 ? 'The feed came back empty, so the previous data was kept.' : null,
    }))
    return wait(runs)
  },
}
