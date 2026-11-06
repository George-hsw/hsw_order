import { supabase, type StoreRow } from '../supabase'
import type { SalesApi, UploadRecord } from './api'
import { dailyRows, detailedRows, indexStores, weeklyRows } from './import'
import type { ChainWeek, ItemSale, ItemWeek, RankMetric, StoreDay, StoreWeek, WeekDates } from './model'

const db = () => {
  if (!supabase) throw new Error('No Supabase connection')
  return supabase
}
const PAGE = 1000
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message) }

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

  async importWeekly(r, stores: StoreRow[], by) {
    const { rows, preview } = weeklyRows(r, indexStores(stores))
    await writeBatches('sales_weeks', r.weeks.filter((w) => w.week_start).map((w) => ({ fy: w.fy, week: w.week, week_start: w.week_start, week_end: w.week_end })), 'fy,week', 200)
    // Weeks that came with no date still need a row so they can be picked.
    const undated = r.weeks.filter((w) => !w.week_start)
    if (undated.length) {
      const { error } = await db().from('sales_weeks').upsert(undated.map((w) => ({ fy: w.fy, week: w.week })), { onConflict: 'fy,week', ignoreDuplicates: true })
      fail(error)
    }
    await writeBatches('store_week', rows, 'fy,week,store_name,co_fran', 500)
    await log('weekly', r.current.fy, r.current.week, rows.length, by)
    return { rows: rows.length, unmatched: preview.unmatched }
  },
  async importDetailed(r, stores, by, onProgress) {
    const { rows: all, preview } = detailedRows(r, indexStores(stores))
    const rows = [...new Map(all.map((x) => [x.store_id + "|" + x.item_code, x])).values()] // one row per store and item, whatever the sheet repeats
    // The week's old rows go first, so a corrected file replaces the earlier one instead of leaving stale items behind.
    const { error } = await db().from('sales_item_week').delete().eq('fy', r.week.fy).eq('week', r.week.week)
    fail(error)
    await writeBatches('sales_item_week', rows.map((x) => ({ fy: x.fy, week: x.week, store_id: x.store_id, item_code: x.item_code, description: x.description, vendor_no: x.vendor_no, division: x.division,
      qty: x.qty, net_sales: x.net_sales, store_rank: x.store_rank, group_qty: x.group_qty, group_net: x.group_net, stores_stocking: x.stores_stocking, business_rank: x.business_rank,
      potential_sales: x.potential_sales, potential_loss: x.potential_loss, moq: x.moq })), 'fy,week,store_id,item_code', 1000, (done) => onProgress(done, rows.length))
    const keep = await db().rpc('sales_prune', { p_keep_weeks: 26 })
    fail(keep.error)
    await log('detailed', r.week.fy, r.week.week, rows.length, by)
    return { rows: rows.length, unmatched: preview.unmatched }
  },
  async importDaily(r, stores, by) {
    const { rows, preview } = dailyRows(r, indexStores(stores))
    await writeBatches('sales_weeks', [{ fy: r.dates.fy, week: r.dates.week, week_start: r.dates.week_start, week_end: r.dates.week_end }], 'fy,week', 10)
    await writeBatches('store_day', rows.map((d) => ({ fy: d.fy, week: d.week, store_id: d.store_id, weekday: d.weekday, ty: d.ty, ly: d.ly })), 'fy,week,store_id,weekday', 500)
    await log('daily', r.week.fy, r.week.week, rows.length, by)
    return { rows: rows.length, unmatched: preview.unmatched }
  },
}
