// Order insights: how fast an item sells at a store, how long its stock lasts, and what to order to reach the store's cover
// target. Plain arithmetic over the weeks of item sales that have been loaded, so every figure can be checked by hand.

/** Insights wait for this many weeks of item sales: one or two weeks say too little about a rate. */
export const MIN_WEEKS = 4
/** How many recent weeks the rate is worked over. */
export const RATE_WEEKS = 13
/** Weeks of stock a store aims to hold when it has not chosen its own target. */
export const DEFAULT_COVER = 4
export const COVER_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 12]

/** Units sold a week at one store, per item, over the weeks loaded. A week with no row for an item counts as nothing sold. */
export interface Rates { weeks: number; perWeek: Map<string, number> }

/** Work out the weekly rates from item-week rows. `weeks` is the number of weeks the rows cover for this store. */
export function ratesFrom(rows: { item_code: string; qty: number; wk: number }[]): Rates {
  const weeks = new Set(rows.map((r) => r.wk)).size
  const total = new Map<string, number>()
  for (const r of rows) total.set(r.item_code, (total.get(r.item_code) ?? 0) + Math.max(0, Number(r.qty) || 0))
  const perWeek = new Map<string, number>()
  if (weeks > 0) for (const [code, qty] of total) perWeek.set(code, qty / weeks)
  return { weeks, perWeek }
}

export interface StockInsight {
  rate: number // units a week
  have: number // in stock + on order + on its way in a transfer
  cover: number | null // weeks the stock lasts at this rate; null when it does not sell
  low: boolean // lasts less than the target
  suggest: number // what would bring it up to the target, in multiples of the MOQ; 0 = nothing needed
}

/** One item at one store. Never fills in a quantity: the store decides. */
// inOrder: what is already in this store's open order for the item, so the suggestion does not ask for it twice.
export function stockInsight(stock: { inventory: number; qty_on_po: number; transfer_in?: number } | undefined, rate: number, target: number, moq: number, inOrder = 0): StockInsight {
  const have = Math.max(0, stock?.inventory ?? 0) + Math.max(0, stock?.qty_on_po ?? 0) + Math.max(0, stock?.transfer_in ?? 0) + Math.max(0, inOrder)
  const r = Math.max(0, rate)
  const cover = r > 0 ? have / r : null
  const step = Math.max(1, Math.round(moq || 1))
  const need = target * r - have
  const suggest = need > 0 ? Math.ceil(need / step) * step : 0
  return { rate: r, have, cover, low: cover !== null && cover < target, suggest }
}

/** "about 2.5 a week" style numbers: whole numbers stay whole, small ones keep one decimal. */
export const perWeekText = (n: number) => (n >= 10 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1))
export const coverText = (weeks: number | null) => (weeks === null ? 'not selling' : weeks === 0 ? 'no stock left' : weeks >= 52 ? 'over a year of stock' : `${weeks < 10 ? weeks.toFixed(1) : Math.round(weeks)} weeks of stock`)

