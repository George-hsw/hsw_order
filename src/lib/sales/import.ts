// Turns parsed reports into database rows: matches report names and codes to this app's stores. Pure, so it is unit-tested.
import type { StoreRow } from '../supabase'
import type { ItemSale, StoreWeek } from './model'
import { storeKey, type DailyResult, type DetailedResult, type WeeklyResult } from './parse'
import { toStoreDays } from './parse'

export interface StoreIndex { byName: Map<string, StoreRow>; byCode: Map<string, StoreRow> }
export function indexStores(stores: StoreRow[]): StoreIndex {
  return { byName: new Map(stores.map((s) => [storeKey(s.name), s])), byCode: new Map(stores.map((s) => [s.code.toUpperCase(), s])) }
}
/** The code with a trailing C or F dropped is how NAV writes some locations (12113C, 3006C): try the exact code, then the name. */
export function findStore(ix: StoreIndex, name: string, code?: string): StoreRow | undefined {
  return (name ? ix.byName.get(storeKey(name)) : undefined) ?? (code ? ix.byCode.get(code.toUpperCase()) : undefined)
}

export interface Preview { label: string; matched: number; total: number; unmatched: string[]; note?: string }

export function weeklyRows(r: WeeklyResult, ix: StoreIndex): { rows: StoreWeek[]; preview: Preview } {
  const unmatched = new Set<string>()
  const rows = r.rows.map((w) => {
    const s = w.co_fran === 'Closed' || w.co_fran === 'eShop' ? undefined : findStore(ix, w.store_name)
    if (!s && w.co_fran !== 'Closed' && w.co_fran !== 'eShop') unmatched.add(w.store_name)
    return { ...w, store_id: s?.id ?? null }
  })
  const trading = rows.filter((w) => w.co_fran !== 'Closed' && w.co_fran !== 'eShop')
  return { rows, preview: { label: 'Weekly sales', matched: trading.filter((w) => w.store_id).length, total: trading.length, unmatched: [...unmatched] } }
}

export function detailedRows(r: DetailedResult, ix: StoreIndex): { rows: (Omit<ItemSale, 'inventory'> & { store_id: string; fy: number; week: number })[]; preview: Preview } {
  const unmatched: string[] = []
  const rows: (Omit<ItemSale, 'inventory'> & { store_id: string; fy: number; week: number })[] = []
  let matched = 0
  for (const s of r.sheets) {
    const st = s.store_name ? findStore(ix, s.store_name) : undefined
    if (!st) { unmatched.push(s.store_name ?? s.tab); continue }
    matched++
    for (const i of s.items) rows.push({ ...i, store_id: st.id, fy: r.week.fy, week: r.week.week })
  }
  return { rows, preview: { label: 'Detailed sales', matched, total: r.sheets.length, unmatched, note: `${rows.length.toLocaleString('en-AU')} item rows` } }
}

export function dailyRows(r: DailyResult, ix: StoreIndex) {
  const { rows, unmatched } = toStoreDays(r.week, r.days, (loc, name) => findStore(ix, name, loc)?.id)
  const stores = new Set(r.days.map((d) => d.location)).size
  return { rows, preview: { label: 'Daily sales', matched: stores - unmatched.length, total: stores, unmatched } satisfies Preview }
}
