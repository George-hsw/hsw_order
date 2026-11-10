import { supabase, type StoreRow } from '../supabase'
import { RATE_WEEKS, ratesFrom } from '../insights'
import type { ItemInfo, SalesApi, SavedSource, UploadRecord } from './api'
import { dailyRows, dedupeItems, detailedRows, indexStores, weeklyRows } from './import'
import type { ChainWeek, ItemSale, ItemWeek, RankMetric, StoreDay, StoreWeek, WeekDates } from './model'

const db = () => {
  if (!supabase) throw new Error('No Supabase connection')
  return supabase
}
const PAGE = 1000
const KEEP_WEEKS = 60 // item rows are kept for each week, for more than a year, so an item's sales build up week by week
/** Throws the database's own error. A gateway or timeout error can come back with an empty message, so every part it gave is shown. */
const fail = (e: { message: string; details?: string | null; hint?: string | null; code?: string | null } | null) => {
  if (!e) return
  const parts = [e.message, e.details, e.hint, e.code ? `code ${e.code}` : ''].filter((x): x is string => !!x && x.trim() !== '')
  throw new Error(parts.length ? parts.join('. ') : 'The database stopped the request without giving a reason. This usually means it timed out; try again.')
}
/** Names the step an error happened in, so the screen can say exactly what failed. */
async function stage<T>(label: string, f: () => PromiseLike<T> | T): Promise<T> {
  try { return await f() } catch (e) { throw new Error(`${label}: ${e instanceof Error && e.message ? e.message : 'no message was given'}`) }
}

/** Supabase returns at most 1,000 rows a request, so read in pages until one comes back short. */
async function pages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    fail(error)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

/** Writes rows in batches, telling the caller how far it got. */
async function writeBatches<T extends object>(table: string, rows: T[], conflict: string, size: number, onProgress?: (done: number) => void) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db().from(table).upsert(rows.slice(i, i + size), { onConflict: conflict })
    fail(error)
    onProgress?.(Math.min(i + size, rows.length))
  }
}

/** After a write, count what the database now holds for the week. A difference means something did not save, so the import fails loudly. */
async function verifyCount(table: string, match: Record<string, number>, expected: number, what: string) {
  let q = db().from(table).select('*', { count: 'exact', head: true })
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v)
  const { count, error } = await q
  fail(error)
  if (count !== expected) throw new Error(`${what}: ${expected} rows were sent but the database holds ${count}. Run the import again.`)
}

const log = async (kind: UploadRecord['kind'], fy: number, week: number, row_count: number, by: string) => {
  const { error } = await db().from('report_uploads').insert({ kind, fy, week, row_count, uploaded_by: by })
  fail(error)
}

const WEEK_COLUMNS = 'fy,week,store_id,store_name,co_fran,state,region,centre_type,retail_sqm,ty_sales,ly_sales,ty_trans,ly_trans,member_sales,member_trans,stock,sys_sales,gp_ty,gp_ly,qty_sold,basket,l4l_adjust'

export const supabaseSalesApi: SalesApi = {
  async weeks() {
    const { data, error } = await db().from('sales_weeks').select('fy,week,week_start,week_end').order('fy', { ascending: false }).order('week', { ascending: false })
    fail(error)
    return (data ?? []) as WeekDates[]
  },
  async history(storeId) {
    const { data, error } = await db().from('store_week').select(WEEK_COLUMNS).eq('store_id', storeId).order('fy').order('week')
    fail(error)
    return (data ?? []) as StoreWeek[]
  },
  async days(storeId, w) {
    const { data, error } = await db().from('store_day').select('fy,week,store_id,weekday,ty,ly').eq('store_id', storeId).eq('fy', w.fy).eq('week', w.week).order('weekday')
    fail(error)
    return (data ?? []) as StoreDay[]
  },
  async ranks(storeId, w) {
    const { data, error } = await db().rpc('store_ranks', { p_store: storeId, p_fy: w.fy, p_week: w.week })
    fail(error)
    return ((data ?? []) as { metric: RankMetric; rank: number; of: number }[]).map((r) => ({ metric: r.metric, rank: r.rank, of: r.of }))
  },
  async chain(w) {
    const { data, error } = await db().rpc('chain_week', { p_fy: w.fy, p_week: w.week })
    fail(error)
    const r = ((data ?? []) as Record<string, number>[])[0]
    return r ? ({ stores: r.stores, ty_sales: Number(r.ty_sales), ly_sales: Number(r.ly_sales), avg_store_sales: Number(r.avg_store_sales), avg_gp: Number(r.avg_gp), avg_basket: Number(r.avg_basket) } satisfies ChainWeek) : null
  },
  async items(storeId, w) {
    const rows = await pages<ItemSale>((from, to) => db().rpc('store_item_sales', { p_store: storeId, p_fy: w.fy, p_week: w.week }).range(from, to))
    return rows.map((r) => ({ ...r, qty: Number(r.qty), net_sales: Number(r.net_sales), group_qty: Number(r.group_qty), group_net: Number(r.group_net), potential_sales: Number(r.potential_sales), potential_loss: Number(r.potential_loss), inventory: Number(r.inventory), moq: Number(r.moq) }))
  },
  async itemHistory(storeId, itemCode) {
    const { data, error } = await db().from('sales_item_week').select('fy,week,qty,net_sales,store_rank,group_qty,stores_stocking,potential_loss').eq('store_id', storeId).eq('item_code', itemCode).order('fy', { ascending: false }).order('week', { ascending: false }).limit(26)
    fail(error)
    return ((data ?? []) as ItemWeek[]).map((r) => ({ ...r, qty: Number(r.qty), net_sales: Number(r.net_sales), group_qty: Number(r.group_qty), potential_loss: Number(r.potential_loss) }))
  },
  async itemRates(storeId) {
    const weeks = (await supabaseSalesApi.weeks()).slice(0, RATE_WEEKS) // newest first
    if (!weeks.length) return { weeks: 0, perWeek: new Map() }
    const oldest = weeks[weeks.length - 1]
    const rows = await pages<{ item_code: string; qty: number; wk: number }>((from, to) => db().from('sales_item_week').select('item_code,qty,wk')
      .eq('store_id', storeId).gte('wk', oldest.fy * 100 + oldest.week).order('wk').order('item_code').range(from, to))
    return ratesFrom(rows.map((r) => ({ ...r, qty: Number(r.qty) })))
  },
  async lookupItem(storeId, query): Promise<ItemInfo | null> {
    const q = query.trim()
    if (!q) return null
    // A barcode can arrive with or without leading zeros, so try the plain number and a few padded forms as well as the text itself.
    const digits = /^\d+$/.test(q) ? q.replace(/^0+/, '') : ''
    const forms = new Set<string>([q, q.toUpperCase()])
    if (digits) for (const pad of [0, 1, 2, 3, 4, 5]) forms.add('0'.repeat(pad) + digits)
    const list = [...forms].map((f) => f.replace(/[,()"]/g, ''))
    const { data, error } = await db().from('items').select('code,description,vendor_no,division,barcode')
      .or(list.map((f) => `barcode.eq.${f}`).concat(list.map((f) => `code.eq.${f}`)).join(',')).limit(1)
    fail(error)
    const item = (data ?? [])[0] as { code: string; description: string; vendor_no: string | null; division: string | null; barcode: string | null } | undefined
    if (!item) return null
    const stock = await db().from('store_stock').select('inventory,moq,vendor_no').eq('store_id', storeId).eq('item_code', item.code).maybeSingle()
    fail(stock.error)
    const s = stock.data as { inventory: number; moq: number; vendor_no: string | null } | null
    return { ...item, vendor_no: s?.vendor_no ?? item.vendor_no, inventory: Number(s?.inventory ?? 0), moq: Number(s?.moq ?? 1) }
  },
  async league(w) {
    const { data, error } = await db().from('store_week').select(WEEK_COLUMNS).eq('fy', w.fy).eq('week', w.week).order('store_name')
    fail(error)
    return (data ?? []) as StoreWeek[]
  },
  async uploads() {
    const { data, error } = await db().from('report_uploads').select('*').order('uploaded_at', { ascending: false }).limit(30)
    fail(error)
    return (data ?? []) as UploadRecord[]
  },

  async yearTotals(fy) {
    const { data, error } = await db().rpc('sales_year_totals', { p_fy: fy })
    fail(error)
    return ((data ?? []) as { week: number; source: SavedSource; row_count: number | string; a: number | string; b: number | string }[]).map((x) => ({ week: x.week, source: x.source, rows: Number(x.row_count), a: Number(x.a), b: Number(x.b) }))
  },

  async importWeekly(r, stores: StoreRow[], by) {
    const { rows, preview } = weeklyRows(r, indexStores(stores))
    await writeBatches('sales_weeks', r.weeks.filter((w) => w.week_start).map((w) => ({ fy: w.fy, week: w.week, week_start: w.week_start, week_end: w.week_end })), 'fy,week', 200)
    // Weeks that came with no date still need a row so they can be picked.
    const undated = r.weeks.filter((w) => !w.week_start)
    if (undated.length) {
      const { error } = await db().from('sales_weeks').upsert(undated.map((w) => ({ fy: w.fy, week: w.week })), { onConflict: 'fy,week', ignoreDuplicates: true })
      fail(error)
    }
    // The file holds every week of the year so far, so it replaces what is saved for them instead of adding beside it.
    for (const wk of [...new Set(rows.map((x) => x.week))]) { const del = await db().from('store_week').delete().eq('fy', r.current.fy).eq('week', wk); fail(del.error) }
    await writeBatches('store_week', rows, 'fy,week,store_name,co_fran', 500)
    for (const wk of [...new Set(rows.map((x) => x.week))]) await verifyCount('store_week', { fy: r.current.fy, week: wk }, rows.filter((x) => x.week === wk).length, `Weekly sales, week ${wk}`)
    await log('weekly', r.current.fy, r.current.week, rows.length, by)
    return { rows: rows.length, unmatched: preview.unmatched }
  },
  async importDetailed(r, stores, by, onProgress) {
    const { rows: all, preview } = detailedRows(r, indexStores(stores))
    const rows = dedupeItems(all) // one row per store and item, whatever the sheet repeats
    // The week's old rows go first, so a corrected file replaces the earlier one instead of leaving stale items behind.
    await stage('Clearing this week’s old item rows', async () => {
      const { error } = await db().rpc('sales_week_clear', { p_fy: r.week.fy, p_week: r.week.week }) // one step in the database: a week can be 80,000+ rows
      fail(error)
    })
    await stage('Saving the item rows', () => writeBatches('sales_item_week', rows.map((x) => ({ fy: x.fy, week: x.week, store_id: x.store_id, item_code: x.item_code, description: x.description, vendor_no: x.vendor_no, division: x.division,
      qty: x.qty, net_sales: x.net_sales, store_rank: x.store_rank, group_qty: x.group_qty, group_net: x.group_net, stores_stocking: x.stores_stocking, business_rank: x.business_rank,
      potential_sales: x.potential_sales, potential_loss: x.potential_loss, moq: x.moq })), 'fy,week,store_id,item_code', 1000, (done) => onProgress(done, rows.length)))
    await stage('Counting what was saved', async () => {
      const { data, error } = await db().rpc('sales_week_count', { p_fy: r.week.fy, p_week: r.week.week })
      fail(error)
      if (Number(data) !== rows.length) throw new Error(`Detailed sales: ${rows.length} rows were sent but the database holds ${data}. Run the import again.`)
    })
    await stage('Recording the upload', () => log('detailed', r.week.fy, r.week.week, rows.length, by))
    // Housekeeping only, after everything above has been saved and counted: it must never fail an import. It keeps a year of weeks.
    let note: string | undefined
    try { const keep = await db().rpc('sales_prune', { p_keep_weeks: KEEP_WEEKS }); fail(keep.error) } catch (e) { note = `The item rows are saved. Clearing weeks older than ${KEEP_WEEKS} did not run: ${e instanceof Error ? e.message : String(e)}` }
    return { rows: rows.length, unmatched: preview.unmatched, note }
  },
  async importDaily(r, stores, by) {
    const { rows, preview } = dailyRows(r, indexStores(stores))
    await writeBatches('sales_weeks', [{ fy: r.dates.fy, week: r.dates.week, week_start: r.dates.week_start, week_end: r.dates.week_end }], 'fy,week', 10)
    await writeBatches('store_day', rows.map((d) => ({ fy: d.fy, week: d.week, store_id: d.store_id, weekday: d.weekday, ty: d.ty, ly: d.ly })), 'fy,week,store_id,weekday', 500)
    await verifyCount('store_day', { fy: r.week.fy, week: r.week.week }, rows.length, 'Daily sales')
    await log('daily', r.week.fy, r.week.week, rows.length, by)
    return { rows: rows.length, unmatched: preview.unmatched }
  },
}
