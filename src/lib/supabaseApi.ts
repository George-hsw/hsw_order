import { ConflictError, type OrderData, type OrdersApi, type VendorList } from './api'
import type { Product } from './order'
import { supabase, type ItemRow, type OrderLine, type OrderRow, type OrderSummary, type StockRow, type SyncRun } from './supabase'

const db = () => {
  if (!supabase) throw new Error('No Supabase connection')
  return supabase
}

const PAGE = 1000 // Supabase returns at most 1,000 rows a request

type Page = { data: unknown; error: { message: string } | null; count?: number | null }

/**
 * Reads every row of a query. The first page also asks for the total, then every remaining page is requested at once, so a
 * 4,400-row list takes about two round trips instead of five in a row. The query must be ordered so pages never overlap.
 */
async function readAll<T>(build: (from: number, to: number, count: boolean) => PromiseLike<Page>): Promise<T[]> {
  const first = await build(0, PAGE - 1, true)
  if (first.error) throw new Error(first.error.message)
  const rows = (first.data ?? []) as T[]
  const total = first.count ?? rows.length
  if (rows.length < PAGE || total <= PAGE) return rows
  const starts = Array.from({ length: Math.ceil((total - PAGE) / PAGE) }, (_, i) => PAGE * (i + 1))
  const rest = await Promise.all(starts.map((from) => build(from, from + PAGE - 1, false)))
  for (const r of rest) {
    if (r.error) throw new Error(r.error.message)
    rows.push(...((r.data ?? []) as T[]))
  }
  return rows
}
const countOpt = (count: boolean) => (count ? { count: 'exact' as const } : {})

const ITEM_COLUMNS = 'code,description,vendor_no,vendor_item_no,barcode,division,category,status,price,sales_uom,base_uom,blocked,exclude_from_replen'
const STOCK_COLUMNS = 'store_id,item_code,inventory,qty_on_po,transfer_in,unavailable,moq,store_cost,sales_qty,vendor_no,po_blocked,synced_at'

// A vendor's range changes only when the nightly sync runs, so switching back to a vendor within a few minutes reuses what was loaded.
const rangeCache = new Map<string, { at: number; products: Product[] }>()
const RANGE_TTL = 10 * 60 * 1000

const linesOf = async (orderId: string): Promise<OrderLine[]> =>
  readAll<OrderLine>((from, to, count) =>
    db().from('order_lines').select('*', countOpt(count)).eq('order_id', orderId).order('updated_at', { ascending: false }).order('id').range(from, to))

export const supabaseApi: OrdersApi = {
  async vendors(storeId): Promise<VendorList> {
    // Two tiny requests at once: the vendors with their item counts, and when this store last synced.
    const [vendorRes, syncRes] = await Promise.all([
      db().rpc('store_vendors', { p_store: storeId }),
      db().from('sync_runs').select('finished_at').eq('store_id', storeId).eq('ok', true).not('finished_at', 'is', null)
        .order('finished_at', { ascending: false }).limit(1),
    ])
    if (vendorRes.error) throw new Error(vendorRes.error.message)
    const options = ((vendorRes.data ?? []) as { vendor_no: string; items: number | string }[]).map((r) => ({ vendor: r.vendor_no, items: Number(r.items) }))
    return { options, syncedAt: (syncRes.data?.[0] as { finished_at: string } | undefined)?.finished_at }
  },

  async range(storeId, vendor): Promise<Product[]> {
    const key = storeId + '|' + vendor
    const hit = rangeCache.get(key)
    if (hit && Date.now() - hit.at < RANGE_TTL) return hit.products
    type Row = StockRow & { items: ItemRow }
    const rows = await readAll<Row>((from, to, count) =>
      db().from('store_stock').select(STOCK_COLUMNS + ',items!inner(' + ITEM_COLUMNS + ')', countOpt(count))
        .eq('store_id', storeId).eq('vendor_no', vendor).order('item_code').range(from, to))
    const products = rows.map(({ items, ...stock }) => ({ item: items, stock }))
    rangeCache.set(key, { at: Date.now(), products })
    return products
  },

  async findOrder(storeId, vendor): Promise<OrderData | null> {
    const { data, error } = await db().from('orders').select('*').eq('store_id', storeId).eq('vendor_no', vendor).neq('status', 'ordered').maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    const order = data as OrderRow
    return { order, lines: await linesOf(order.id) }
  },

  async openOrder(storeId, vendor): Promise<OrderData> {
    const { data, error } = await db().rpc('open_order', { p_store: storeId, p_vendor: vendor })
    if (error) throw new Error(error.message)
    const order = data as OrderRow
    return { order, lines: await linesOf(order.id) }
  },

  async drafts(storeId): Promise<OrderSummary[]> {
    const { data, error } = await db().from('order_summaries').select('*').eq('store_id', storeId).neq('status', 'ordered').order('vendor_no')
    if (error) throw new Error(error.message)
    // An order with no lines is not an order yet (an earlier version created one on opening a vendor), so it is not listed.
    return ((data ?? []) as (OrderSummary & { store_name: string })[]).filter((r) => r.lines > 0).map((r) => ({ ...r, stores: { name: r.store_name } }))
  },

  async saveLine(orderId, _email, input, baseRevision) {
    const { data, error } = await db().rpc('save_line', {
      p_order: orderId, p_item: input.item.code, p_qty: input.qty, p_base: baseRevision, p_unit_cost: input.unitCost,
      p_division: input.item.division, p_description: input.item.description, // the line's vendor is its order's vendor, set in the database
      p_vendor_item: input.item.vendor_item_no, p_uom: input.item.base_uom ?? input.item.sales_uom,
    })
    if (error) throw new Error(error.message)
    const result = data as { status: 'ok' | 'conflict'; current?: OrderLine | null }
    if (result.status === 'conflict') throw new ConflictError(result.current ?? undefined)
    return linesOf(orderId)
  },

  subscribe(orderId, onLines) {
    // Any change to this order's lines (from any device) reloads the whole set, so the screen never shows a half-applied state.
    // Reloading also covers a dropped connection: when the channel re-joins, the lines are fetched again.
    const reload = () => { linesOf(orderId).then(onLines).catch(() => { /* the next change or reconnect tries again */ }) }
    const channel = db()
      .channel(`order-lines-${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_lines', filter: `order_id=eq.${orderId}` }, reload)
      .subscribe((status) => { if (status === 'SUBSCRIBED') reload() })
    return () => { void db().removeChannel(channel) }
  },

  async setStatus(orderId, status, navRef) {
    const { data, error } = await db().rpc('set_order_status', { p_order: orderId, p_status: status, p_nav_ref: navRef ?? null })
    if (error) throw new Error(error.message)
    return data as OrderRow
  },

  async deleteOrder(orderId) {
    const { error } = await db().rpc('delete_order', { p_order: orderId })
    if (error) throw new Error(error.message)
  },

  async listOrders(storeIds): Promise<OrderSummary[]> {
    if (!storeIds.length) return []
    const rows = await readAll<OrderSummary & { store_name: string }>((from, to, count) =>
      db().from('order_summaries').select('*', countOpt(count)).in('store_id', storeIds).order('created_at', { ascending: false }).order('id').range(from, to))
    return rows.filter((r) => r.status !== 'open' || r.lines > 0).map((r) => ({ ...r, stores: { name: r.store_name } }))
  },

  orderLines: linesOf,

  async syncRuns(): Promise<SyncRun[]> {
    const { data, error } = await db().from('sync_runs').select('store_id,finished_at,ok,rows,message').not('store_id', 'is', null)
      .not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(500)
    if (error) throw new Error(error.message)
    const latest = new Map<string, SyncRun>() // newest first, so the first one seen per store is its latest
    for (const r of (data ?? []) as SyncRun[]) if (!latest.has(r.store_id)) latest.set(r.store_id, r)
    return [...latest.values()]
  },
}
