import { ConflictError, type Catalogue, type OrderData, type OrdersApi } from './api'
import { supabase, type ItemRow, type OrderLine, type OrderRow, type OrderSummary, type StockRow, type SyncRun } from './supabase'

const db = () => {
  if (!supabase) throw new Error('No Supabase connection')
  return supabase
}

const PAGE = 1000 // Supabase returns at most 1,000 rows a request

/** Reads every row of a query, a page at a time. The list can be ordered by `order` so pages never overlap. */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

const ITEM_COLUMNS = 'code,description,vendor_no,vendor_item_no,barcode,division,category,status,price,sales_uom,base_uom,blocked,exclude_from_replen'
const STOCK_COLUMNS = 'store_id,item_code,inventory,qty_on_po,transfer_in,unavailable,moq,store_cost,sales_qty,vendor_no,po_blocked,synced_at'

// The item list is the same for every store and changes once a day, so a session keeps one copy.
let itemCache: { at: number; items: ItemRow[] } | null = null
const ITEM_TTL = 30 * 60 * 1000

const linesOf = async (orderId: string): Promise<OrderLine[]> =>
  readAll<OrderLine>((from, to) =>
    db().from('order_lines').select('*').eq('order_id', orderId).order('updated_at', { ascending: false }).order('id').range(from, to))

export const supabaseApi: OrdersApi = {
  async catalogue(storeId): Promise<Catalogue> {
    const itemsPromise = itemCache && Date.now() - itemCache.at < ITEM_TTL
      ? Promise.resolve(itemCache.items)
      : readAll<ItemRow>((from, to) => db().from('items').select(ITEM_COLUMNS).order('code').range(from, to))
          .then((items) => { itemCache = { at: Date.now(), items }; return items })
    const stockPromise = readAll<StockRow>((from, to) =>
      db().from('store_stock').select(STOCK_COLUMNS).eq('store_id', storeId).order('item_code').range(from, to))
    const syncPromise = db().from('sync_runs').select('finished_at').eq('store_id', storeId).eq('ok', true).not('finished_at', 'is', null)
      .order('finished_at', { ascending: false }).limit(1)
    const [items, stock, sync] = await Promise.all([itemsPromise, stockPromise, syncPromise])
    return { items, stock, syncedAt: (sync.data?.[0] as { finished_at: string } | undefined)?.finished_at }
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
    return ((data ?? []) as (OrderSummary & { store_name: string })[]).map((r) => ({ ...r, stores: { name: r.store_name } }))
  },

  async saveLine(orderId, _email, input, baseRevision) {
    const { data, error } = await db().rpc('save_line', {
      p_order: orderId, p_item: input.item.code, p_qty: input.qty, p_base: baseRevision, p_unit_cost: input.unitCost,
      p_division: input.item.division, p_description: input.item.description, // the line's vendor is its order's vendor, set in the database
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

  async listOrders(storeIds): Promise<OrderSummary[]> {
    if (!storeIds.length) return []
    const rows = await readAll<OrderSummary & { store_name: string }>((from, to) =>
      db().from('order_summaries').select('*').in('store_id', storeIds).order('created_at', { ascending: false }).order('id').range(from, to))
    return rows.map((r) => ({ ...r, stores: { name: r.store_name } }))
  },

  orderLines: linesOf,

  async reportLines(storeIds) {
    if (!storeIds.length) return []
    const orders = await readAll<OrderRow>((from, to) => db().from('orders').select('*').in('store_id', storeIds).order('created_at', { ascending: false }).order('id').range(from, to))
    const lines = await readAll<OrderLine>((from, to) => db().from('order_lines').select('*').in('store_id', storeIds).order('id').range(from, to))
    const byOrder = new Map<string, OrderLine[]>()
    for (const l of lines) byOrder.set(l.order_id, [...(byOrder.get(l.order_id) ?? []), l])
    return orders.map((order) => ({ order, lines: byOrder.get(order.id) ?? [] }))
  },

  async syncRuns(): Promise<SyncRun[]> {
    const { data, error } = await db().from('sync_runs').select('store_id,finished_at,ok,rows,message').not('store_id', 'is', null)
      .not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(500)
    if (error) throw new Error(error.message)
    const latest = new Map<string, SyncRun>() // newest first, so the first one seen per store is its latest
    for (const r of (data ?? []) as SyncRun[]) if (!latest.has(r.store_id)) latest.set(r.store_id, r)
    return [...latest.values()]
  },
}
