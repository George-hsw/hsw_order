// What the Sales tab shows, and the plain rules behind it. No network here, so it is all unit-tested.

export interface WeekRef { fy: number; week: number } // fy is the financial year's end year: 2027 is FY27
export const weekKey = (w: WeekRef) => w.fy * 100 + w.week
export const sameWeek = (a: WeekRef | null | undefined, b: WeekRef | null | undefined) => !!a && !!b && weekKey(a) === weekKey(b)
export const weekLabel = (w: WeekRef) => `FY${String(w.fy).slice(-2)} week ${w.week}`

/** One store's results for one week, this year beside the same week last year. */
export interface StoreWeek extends WeekRef {
  store_id: string | null // null for the eShop and for stores that have closed: only head office sees those rows
  store_name: string
  co_fran: string // Company, Franchised, Closed
  state: string
  region: string
  centre_type: string
  retail_sqm: number
  ty_sales: number
  ly_sales: number
  ty_trans: number
  ly_trans: number
  member_sales: number
  member_trans: number
  stock: number
  sys_sales: number // shelving systems sales
  gp_ty: number // margin as a fraction
  gp_ly: number
  qty_sold: number
  basket: number // items per sale
  l4l_adjust: number
}

export interface StoreDay extends WeekRef { store_id: string; weekday: number; ty: number; ly: number } // weekday 1 = Monday ... 7 = Sunday

export interface WeekDates extends WeekRef { week_start: string; week_end: string } // yyyy-mm-dd

/** One item at one store for one week, with the chain's figures beside it and today's stock. */
export interface ItemSale {
  item_code: string
  description: string
  vendor_no: string | null
  division: string | null
  qty: number
  net_sales: number
  store_rank: number // 1 is the best seller in the store; 0 means unranked
  group_qty: number // the whole chain's units for the week
  group_net: number
  stores_stocking: number
  business_rank: number // company-wide rank
  potential_sales: number // what the chain could sell if every store stocked it at the average
  potential_loss: number // the report's estimate of sales lost while the item was out of stock
  inventory: number // today's stock at this store, from NAV
  moq: number
}

export type RankMetric = 'sales' | 'growth' | 'sqm' | 'avg_sale' | 'basket' | 'member_share' | 'gp'
export const RANK_METRICS: RankMetric[] = ['sales', 'growth', 'sqm', 'avg_sale', 'basket', 'member_share', 'gp']
export const RANK_LABEL: Record<RankMetric, string> = {
  sales: 'Sales', growth: 'Growth on last year', sqm: 'Sales per square metre', avg_sale: 'Average sale', basket: 'Items per sale', member_share: 'Member share of sales', gp: 'Margin',
}
/** A store's position in a league of stores: the position and how many are in it, never anyone else's figures. */
export interface RankRow { metric: RankMetric; rank: number; of: number }

/** The chain's totals for a week. Only given when enough stores are in it that no single store can be read out of it. */
export interface ChainWeek { stores: number; ty_sales: number; ly_sales: number; avg_store_sales: number; avg_gp: number; avg_basket: number }
export const MIN_GROUP = 3

// ---------- numbers and wording ----------

/** Change from last year as a fraction: 0.05 is up 5%. Null when there is no last-year figure to compare with. */
export function change(ty: number, ly: number): number | null {
  return ly > 0 ? (ty - ly) / ly : null
}

export function pctText(f: number | null, digits = 1): string {
  if (f === null || !Number.isFinite(f)) return 'no comparison'
  const s = (Math.abs(f) * 100).toFixed(digits)
  return `${f > 0 ? '+' : f < 0 ? '−' : ''}${s}%`
}

/** Dollars and cents, never rounded to the dollar: 243.68 stays $243.68. */
export const money2 = (n: number) => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 12,900 as 12.9K and 1,250,000 as 1.25M, for chart axes. */
export function compact(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (a >= 1e4) return (n / 1e3).toFixed(0) + 'K'
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

export function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return n + 'th'
  return n + (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
}
export const rankText = (r: RankRow) => `${ordinal(r.rank)} of ${r.of}`

export const memberShare = (w: StoreWeek) => (w.ty_sales > 0 ? w.member_sales / w.ty_sales : 0)
export const avgSale = (w: StoreWeek) => (w.ty_trans > 0 ? w.ty_sales / w.ty_trans : 0)
export const avgSaleLy = (w: StoreWeek) => (w.ly_trans > 0 ? w.ly_sales / w.ly_trans : 0)

/** "31 Aug to 6 Sep" from two yyyy-mm-dd dates. */
export function rangeText(start: string, end: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const f = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`
  return `${f(start)} to ${f(end)}`
}
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ---------- item flags: where to act ----------

export type ItemFlag = 'out' | 'not_selling' | 'below' | 'above' | 'ok'
export const FLAG_LABEL: Record<ItemFlag, string> = {
  out: 'Out of stock, losing sales', not_selling: 'In stock, not selling', below: 'Selling below the chain average', above: 'Selling above the chain average', ok: 'No flag',
}
export const FLAG_HELP: Record<ItemFlag, string> = {
  out: 'No stock here, and the chain or this store sells it. Consider ordering now.',
  not_selling: 'Stock on hand, nothing sold this week, while the chain sells it. Think twice before reordering.',
  below: 'Sold, but less than the average store that stocks it. Check display, price and range.',
  above: 'Selling faster than the average store that stocks it. Check you have enough cover.',
  ok: '',
}
export const FLAGS: ItemFlag[] = ['out', 'not_selling', 'below', 'above']

/** Units the average store that stocks this item sold in the week. */
export const chainAvg = (i: ItemSale) => (i.stores_stocking > 0 ? i.group_qty / i.stores_stocking : 0)

/**
 * One flag per item, first rule that applies. These are plain, visible rules for the store to weigh, not a verdict: the numbers
 * always sit beside them. With a single week of data "not selling" is weak, so the screen says how many weeks it rests on.
 */
export function itemFlag(i: ItemSale): ItemFlag {
  const avg = chainAvg(i)
  if (i.inventory <= 0 && (i.qty > 0 || i.potential_loss > 0 || avg > 0)) return 'out'
  if (i.inventory > 0 && i.qty <= 0 && i.group_qty > 0) return 'not_selling'
  if (avg >= 1 && i.qty > 0 && i.qty < avg) return 'below'
  if (avg > 0 && i.qty > avg) return 'above'
  return 'ok'
}

export function flagCounts(items: ItemSale[]): Record<ItemFlag, number> {
  const out: Record<ItemFlag, number> = { out: 0, not_selling: 0, below: 0, above: 0, ok: 0 }
  for (const i of items) out[itemFlag(i)]++
  return out
}

/** The `n` items with the biggest value of `key`, biggest first, ignoring zeros. */
export function topBy(items: ItemSale[], key: 'qty' | 'net_sales' | 'potential_loss', n: number): ItemSale[] {
  return items.filter((i) => i[key] > 0).sort((a, b) => b[key] - a[key] || a.item_code.localeCompare(b.item_code)).slice(0, n)
}

// ---------- weeks ----------

/** One item at one store in one week: what the report recorded. A week with no row means nothing sold, was ranked or lost. */
export interface ItemWeek extends WeekRef { qty: number; net_sales: number; store_rank: number; group_qty: number; stores_stocking: number; potential_loss: number }

/** Distinct weeks in the rows, newest first. */
export function weeksOf(rows: WeekRef[]): WeekRef[] {
  const seen = new Map<number, WeekRef>()
  for (const r of rows) seen.set(weekKey(r), { fy: r.fy, week: r.week })
  return [...seen.values()].sort((a, b) => weekKey(b) - weekKey(a))
}

// ---------- one item over the weeks ----------

export interface ItemTrendWeek extends WeekRef { qty: number; net_sales: number; chain_avg: number; store_rank: number; potential_loss: number }
export interface ItemTrend {
  weeks: ItemTrendWeek[] // oldest first, only weeks the report recorded the item in
  total_qty: number
  total_sales: number
  total_lost: number
  last: ItemTrendWeek | null
  /** Units in the last four recorded weeks against the four before, as a fraction; null when there is nothing to compare. */
  growth4: number | null
  /** Latest recorded week against the one before it. */
  growth1: number | null
  best: ItemTrendWeek | null
}

/** Weekly figures for one item, with the average store that stocks it beside it, and how the item is trending. Pure: no network. */
export function itemTrend(history: ItemWeek[]): ItemTrend {
  const weeks: ItemTrendWeek[] = [...history].sort((a, b) => weekKey(a) - weekKey(b)).map((h) => ({
    fy: h.fy, week: h.week, qty: h.qty, net_sales: h.net_sales, chain_avg: h.stores_stocking > 0 ? h.group_qty / h.stores_stocking : 0, store_rank: h.store_rank, potential_loss: h.potential_loss,
  }))
  const sum = (xs: ItemTrendWeek[], f: (w: ItemTrendWeek) => number) => xs.reduce((a, w) => a + f(w), 0)
  const recent = weeks.slice(-4), before = weeks.slice(-8, -4)
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null
  const last = weeks.length ? weeks[weeks.length - 1] : null
  return {
    weeks, total_qty: sum(weeks, (w) => w.qty), total_sales: sum(weeks, (w) => w.net_sales), total_lost: sum(weeks, (w) => w.potential_loss), last,
    growth4: before.length && sum(before, (w) => w.qty) > 0 ? change(sum(recent, (w) => w.qty), sum(before, (w) => w.qty)) : null,
    growth1: last && prev && prev.qty > 0 ? change(last.qty, prev.qty) : null,
    best: weeks.reduce<ItemTrendWeek | null>((b, w) => (!b || w.qty > b.qty ? w : b), null),
  }
}
