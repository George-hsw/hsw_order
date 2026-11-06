// Made-up sales for `npm run demo`: 23 stores, 10 weeks, a few dozen items. Nothing here is real HSW data.
import { demoStores } from '../demo'
import type { SalesApi, UploadRecord } from './api'
import { avgSale, memberShare, weekKey, type ChainWeek, type ItemSale, type RankMetric, type RankRow, type StoreDay, type StoreWeek, type WeekDates, type WeekRef } from './model'

const FY = 2027
const WEEKS = 10
const WEEK1 = Date.UTC(2026, 5, 29) // Monday 29 June 2026
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const DATES: WeekDates[] = Array.from({ length: WEEKS }, (_, i) => ({ fy: FY, week: WEEKS - i, week_start: iso(WEEK1 + (WEEKS - i - 1) * 7 * 864e5), week_end: iso(WEEK1 + ((WEEKS - i - 1) * 7 + 6) * 864e5) }))

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)

const STATES: Record<string, string> = { '1': 'NSW', '4': 'QLD', '2': 'ACT', '3': 'VIC', '5': 'SA', '6': 'WA', '7': 'TAS' }
const stores = () => demoStores()

function storeWeek(s: { id: string; name: string; code: string }, week: number): StoreWeek {
  const r = rng(hash(s.id) * 31 + week)
  const size = 0.7 + ((hash(s.name) % 100) / 100) * 0.9 // each store has its own size
  const season = 1 + Math.sin(week / 2) * 0.08
  const ly = Math.round(26000 * size * (0.9 + r() * 0.2))
  const ty = Math.round(ly * (0.9 + r() * 0.2) * season)
  const trans = Math.round(ty / (68 + r() * 22))
  const state = STATES[s.code[0]] ?? 'NSW'
  return {
    fy: FY, week, store_id: s.id, store_name: s.name, co_fran: hash(s.name) % 2 ? 'Company' : 'Franchised', state, region: state === 'NSW' ? 'NSW & ACT' : state === 'QLD' ? 'Northern Region' : 'Southern Region',
    centre_type: 'Homemaker Centre', retail_sqm: Math.round(280 + size * 160), ty_sales: ty, ly_sales: ly, ty_trans: trans, ly_trans: Math.round(trans * (0.92 + r() * 0.14)),
    member_sales: Math.round(ty * (0.5 + r() * 0.25)), member_trans: Math.round(trans * 0.55), stock: Math.round(200000 * size), sys_sales: Math.round(ty * 0.1),
    gp_ty: 0.42 + r() * 0.07, gp_ly: 0.43 + r() * 0.06, qty_sold: Math.round(trans * 2.6), basket: 2.3 + r() * 0.8, l4l_adjust: 0,
  }
}
const allWeeks = (): StoreWeek[] => stores().flatMap((s) => Array.from({ length: WEEKS }, (_, i) => storeWeek(s, i + 1)))

const SHARE = [0.11, 0.12, 0.13, 0.15, 0.17, 0.22, 0.10] // Mon..Sun
function days(storeId: string, w: WeekRef): StoreDay[] {
  const s = stores().find((x) => x.id === storeId)
  if (!s) return []
  const t = storeWeek(s, w.week)
  const r = rng(hash(storeId) + w.week * 7)
  return SHARE.map((p, i) => ({ fy: w.fy, week: w.week, store_id: storeId, weekday: i + 1, ty: Math.round(t.ty_sales * p * (0.85 + r() * 0.3)), ly: Math.round(t.ly_sales * p * (0.85 + r() * 0.3)) }))
}

const metric = (m: RankMetric, w: StoreWeek): number | null => {
  switch (m) {
    case 'sales': return w.ty_sales
    case 'growth': return w.ly_sales > 0 ? w.ty_sales / w.ly_sales - 1 : null
    case 'sqm': return w.retail_sqm > 0 ? w.ty_sales / w.retail_sqm : null
    case 'avg_sale': return avgSale(w) || null
    case 'basket': return w.basket || null
    case 'member_share': return memberShare(w)
    case 'gp': return w.gp_ty || null
  }
}
const METRICS: RankMetric[] = ['sales', 'growth', 'sqm', 'avg_sale', 'basket', 'member_share', 'gp']

function ranks(storeId: string, w: WeekRef): RankRow[] {
  const league = allWeeks().filter((x) => x.week === w.week)
  const mine = league.find((x) => x.store_id === storeId)
  if (!mine) return []
  return METRICS.flatMap((m) => {
    const vals = league.map((x) => metric(m, x)).filter((v): v is number => v !== null)
    const v = metric(m, mine)
    return v === null ? [] : [{ metric: m, rank: 1 + vals.filter((x) => x > v).length, of: vals.length }]
  })
}

const NAMES = ['HUSH SOAP DISPENSER WHT', 'HUSH SOAP DISH WHT', 'HUSH TUMBLER WHT', 'HUSH TOILET BRUSH WHT', 'HUSH ROLL CANISTER WHT', 'TOWEL TO GO BALI ANTHRACITE', 'LAUNDRY HAMPER GREY LARGE',
  'STORAGE BOX CLEAR 32L', 'STORAGE BOX CLEAR 64L', 'SHOE RACK 3 TIER', 'DRAWER ORGANISER SET 4', 'WIRE BASKET CHROME', 'HANGER VELVET BLACK 20PK', 'HANGER TIMBER 5PK', 'CLOTHES AIRER FOLDING',
  'IRONING BOARD COVER', 'BROOM SOFT BRISTLE', 'MOP BUCKET SET', 'BIN PEDAL 30L WHT', 'BIN SENSOR 40L SLV', 'SPICE RACK 2 TIER', 'CUTLERY TRAY BAMBOO', 'CANISTER SET 3 BLACK', 'LUNCH BOX BENTO 2L',
  'WATER BOTTLE STEEL 750ML', 'PLACEMAT CORK 4PK', 'TEA TOWEL STRIPE 3PK', 'SHOWER CADDY CORNER', 'TOILET ROLL HOLDER STAND', 'BATH MAT MICROFIBRE GREY', 'COAT HOOK RAIL 5', 'MIRROR OVAL BLACK 60CM',
  'CURTAIN HOOKS 40PK', 'PEG BASKET 50PK', 'VACUUM BAG JUMBO 4PK', 'SHELF LINER NON SLIP', 'UNDERBED CONTAINER WHEELED', 'TROLLEY 3 TIER MINT', 'PLANT POT CERAMIC WHT', 'CANDLE JAR VANILLA',
  'PHOTO FRAME 5X7 BLK', 'WALL SHELF FLOATING OAK', 'DOORMAT COIR 40X70', 'LAUNDRY BASKET FOLDING', 'SOAP PUMP GLASS', 'JAR AIRTIGHT 1.2L', 'KITCHEN ROLL HOLDER', 'DISH RACK 2 TIER', 'SINK MAT SILICONE', 'CHOPPING BOARD ACACIA']
const VENDORS = ['ANAS001', 'MYHO001', 'KESR001', 'JOSE001']
const DIVS = ['BATHROOM', 'LAUNDRY', 'STORAGE', 'KITCHEN', 'HOME_DECOR']

function items(storeId: string, w: WeekRef): ItemSale[] {
  const r = rng(hash(storeId) * 13 + w.week)
  const size = 0.6 + (hash(storeId) % 100) / 100
  return NAMES.map((name, i) => {
    const popularity = 1 / (1 + i * 0.22) // the early items sell more
    const group_stores = 14 + Math.floor(r() * 9)
    const avg = Math.max(0.4, 14 * popularity * (0.6 + r() * 0.8))
    const group_qty = Math.round(avg * group_stores)
    const price = 8 + ((i * 7) % 40) + 0.95
    const qty = r() < 0.12 ? 0 : Math.max(0, Math.round(avg * size * (0.2 + r() * 1.6)))
    const inventory = r() < 0.14 ? 0 : Math.round(r() * 16)
    const stocked = qty > 0 || inventory > 0
    return {
      item_code: `DEM${String(1000 + i)}`, description: name, vendor_no: VENDORS[i % 4], division: DIVS[i % 5], qty, net_sales: Math.round(qty * price * 100) / 100,
      store_rank: qty > 0 ? 1 + Math.floor(r() * 400) + i * 12 : 0, group_qty, group_net: Math.round(group_qty * price * 100) / 100, stores_stocking: group_stores,
      business_rank: 10 + i * 31, potential_sales: Math.round(avg * price * 100) / 100, potential_loss: inventory === 0 && stocked ? Math.round(avg * 0.5 * price * 100) / 100 : 0, inventory, moq: i % 3 === 0 ? 6 : 1,
    }
  }).sort((a, b) => b.net_sales - a.net_sales).map((x, i) => (x.qty > 0 ? { ...x, store_rank: i + 1 } : x))
}

const chain = (w: WeekRef): ChainWeek => {
  const league = allWeeks().filter((x) => x.week === w.week)
  const sum = (f: (x: StoreWeek) => number) => league.reduce((a, x) => a + f(x), 0)
  return { stores: league.length, ty_sales: sum((x) => x.ty_sales), ly_sales: sum((x) => x.ly_sales), avg_store_sales: sum((x) => x.ty_sales) / league.length, avg_gp: sum((x) => x.gp_ty) / league.length, avg_basket: sum((x) => x.basket) / league.length }
}

const wait = <T,>(v: T) => new Promise<T>((res) => setTimeout(() => res(v), 120))
const uploads: UploadRecord[] = [
  { id: 3, kind: 'daily', fy: FY, week: WEEKS, row_count: 161, uploaded_by: 'george.mridun@hsw.com.au', uploaded_at: new Date(Date.now() - 864e5).toISOString() },
  { id: 2, kind: 'weekly', fy: FY, week: WEEKS, row_count: 267, uploaded_by: 'george.mridun@hsw.com.au', uploaded_at: new Date(Date.now() - 864e5).toISOString() },
  { id: 1, kind: 'detailed', fy: FY, week: WEEKS, row_count: 28700, uploaded_by: 'george.mridun@hsw.com.au', uploaded_at: new Date(Date.now() - 864e5).toISOString() },
]

export const demoSalesApi: SalesApi = {
  weeks: () => wait(DATES),
  history: (storeId) => wait(allWeeks().filter((x) => x.store_id === storeId).sort((a, b) => weekKey(a) - weekKey(b))),
  days: (storeId, w) => wait(days(storeId, w)),
  ranks: (storeId, w) => wait(ranks(storeId, w)),
  chain: (w) => wait(chain(w)),
  items: (storeId, w) => wait(items(storeId, w)),
  itemHistory: (storeId, code) => wait(Array.from({ length: WEEKS }, (_, i) => WEEKS - i).flatMap((week) => { const it = items(storeId, { fy: FY, week }).find((x) => x.item_code === code); return it && (it.qty > 0 || it.potential_loss > 0) ? [{ fy: FY, week, qty: it.qty, net_sales: it.net_sales, store_rank: it.store_rank, group_qty: it.group_qty, stores_stocking: it.stores_stocking, potential_loss: it.potential_loss }] : [] })),
  league: (w) => wait(allWeeks().filter((x) => x.week === w.week)),
  uploads: () => wait(uploads),
  importWeekly: async () => { throw new Error('Demo mode: nothing is saved.') },
  importDetailed: async () => { throw new Error('Demo mode: nothing is saved.') },
  importDaily: async () => { throw new Error('Demo mode: nothing is saved.') },
}
