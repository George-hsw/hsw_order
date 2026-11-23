// Order insights: how fast an item sells at a store, how long its stock lasts, and what to order to reach the store's cover
// target. Plain arithmetic over the weeks of item sales that have been loaded, so every figure can be checked by hand.

/** Insights wait for this many weeks of item sales: one or two weeks say too little about a rate. */
export const MIN_WEEKS = 4
/** How many recent weeks the rate is worked over. */
export const RATE_WEEKS = 13
/** Weeks of stock a store aims to hold when it has not chosen its own target. */
export const DEFAULT_COVER = 4
export const COVER_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 12]

/**
 * Units sold a week at one store, per item, over the weeks loaded. A week with no row for an item counts as nothing sold.
 * `series` is each item's units in every loaded week, oldest first, and `storeUnits` the store's units in those same weeks: the suggested order
 * uses them to see how an item sold lately and how the whole store is trending.
 */
export interface Rates { weeks: number; perWeek: Map<string, number>; series?: Map<string, number[]>; storeUnits?: number[] }

/** Work out the weekly rates from item-week rows. `weeks` is the number of weeks the rows cover for this store. */
export function ratesFrom(rows: { item_code: string; qty: number; wk: number }[]): Rates {
  const wks = [...new Set(rows.map((r) => r.wk))].sort((a, b) => a - b)
  const weeks = wks.length
  const at = new Map(wks.map((w, i) => [w, i]))
  const series = new Map<string, number[]>()
  const storeUnits: number[] = Array(weeks).fill(0)
  for (const r of rows) {
    const q = Math.max(0, Number(r.qty) || 0)
    let s = series.get(r.item_code)
    if (!s) { s = Array(weeks).fill(0); series.set(r.item_code, s) }
    s[at.get(r.wk)!] += q
    storeUnits[at.get(r.wk)!] += q
  }
  const perWeek = new Map<string, number>()
  if (weeks > 0) for (const [code, s] of series) perWeek.set(code, s.reduce((a, b) => a + b, 0) / weeks)
  return { weeks, perWeek, series, storeUnits }
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

/** Whole weeks only: a store reads "2 weeks", never "1.7". Less than a week reads as "under 1 week". */
const weeksOf = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`
export const coverText = (weeks: number | null) => (weeks === null ? 'not selling' : weeks === 0 ? 'no stock left' : weeks >= 52 ? 'over a year of stock' : weeks < 1 ? 'under 1 week of stock' : `${weeksOf(Math.floor(weeks))} of stock`)

/** Why an item is flagged Low, in the same words as the suggested order: what is in stock, what it sold, what is on order, and how long that lasts against the target. */
export function lowWhy(i: { inventory: number; onOrder: number; sold: number; weeks: number; cover: number | null; target: number }): string {
  const lasts = i.cover === null ? 'It is not selling' : i.cover === 0 ? 'Nothing is left' : i.cover < 1 ? 'That lasts under 1 week' : `That lasts ${weeksOf(Math.floor(i.cover))}`
  return `In stock ${Math.max(0, i.inventory)}, sold ${i.sold} in the last ${weeksOf(i.weeks)}, on order ${i.onOrder}. ${lasts}, and this store aims to hold ${weeksOf(i.target)}.`
}
/** The short label on a Low item: how long its stock lasts, in whole weeks. */
export const lowLabel = (cover: number | null) => (cover === null ? 'Low' : cover === 0 ? 'Low, out of stock' : cover < 1 ? 'Low, under 1 week left' : `Low, ${weeksOf(Math.floor(cover))} left`)
