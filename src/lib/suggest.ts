// The suggested order. Plain rules, no guessing: the same numbers always give the same answer, and every line carries the working that produced it.
// The way an item's weekly demand is estimated was chosen by testing it on the real FY27 item sales (weeks 1 to 11): each rule forecast the next
// 4 weeks from the weeks before, and was scored on units short and units over. Adding back "lost sales" made forecasts worse, so it is not used.
import { perWeekText } from './insights'

export const DEMAND = {
  recentWeeks: 5, // how far back "lately" goes
  longWeeks: 13, // the longer view
  recentWeight: 0.6, // lately counts for 60%, the longer view 40%
  capK: 2.5, // a single week counts for at most this many times the item's average week ...
  capFloor: 3, // ... or 3 units, whichever is more, so one big sale does not drive an order
  trendWeeks: 4, // the store's last 4 weeks against all its weeks: a falling or rising season moves every item
  trendMin: 0.4,
  trendMax: 1.3,
}
/** Below this many units a week an item is a slow seller (the same line the backtest used): it is suggested only when it is out of stock. */
export const SLOW_RATE = 0.5
/** A suggestion whose minimum order lasts longer than this many weeks of sales is left for the person to decide. */
export const MAX_MOQ_WEEKS = 26

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export interface Demand { rate: number; recent: number; long: number; trend: number }
/** Units a week this item is expected to sell: recent and longer view, one-week spikes capped, scaled by how the whole store is trending. */
export function demandOf(series: number[], storeUnits: number[]): Demand {
  const s = series.slice(-DEMAND.longWeeks)
  const store = storeUnits.slice(-DEMAND.longWeeks)
  const ceiling = Math.max(DEMAND.capK * mean(s), DEMAND.capFloor)
  const c = s.map((x) => Math.min(x, ceiling))
  const recent = mean(c.slice(-DEMAND.recentWeeks))
  const long = mean(c)
  const trend = clamp(mean(store.slice(-DEMAND.trendWeeks)) / (mean(store) || 1), DEMAND.trendMin, DEMAND.trendMax)
  return { rate: (DEMAND.recentWeight * recent + (1 - DEMAND.recentWeight) * long) * trend, recent, long, trend }
}

/** What one vendor needs ordering at one store, added up (the database computes it with the same rules): the lines to order, their units and cost, and the lines left for the person to decide. */
export interface OrderNeed { store_id: string; vendor_no: string; items: number; units: number; cost: number; held: number; customers: number }

export type Hold = 'moq' | null
export interface SuggestIn {
  series: number[] // units sold in each loaded week, oldest first
  storeUnits: number[] // the whole store's units in those weeks
  inventory: number
  onOrder: number // on a purchase order already
  transferIn: number
  inOrder: number // already in this order
  waiting: number // units customers are waiting on (customer orders not yet ordered)
  moq: number
  weeks: number // weeks of stock the store aims to hold
}
export interface Suggestion extends Demand {
  qty: number // what to order, in multiples of the MOQ; 0 = nothing needed
  fill: boolean // false when it is only shown for the person to decide
  hold: Hold
  have: number
  need: number
  why: string // the full working
  brief: string // one short line
}

/** One item at one store. The quantity is only ever a suggestion: nothing is ordered until the person says so. */
export function suggestLine(i: SuggestIn): Suggestion {
  const d = demandOf(i.series, i.storeUnits)
  const have = Math.max(0, i.inventory) + Math.max(0, i.onOrder) + Math.max(0, i.transferIn) + Math.max(0, i.inOrder)
  const units = i.series.reduce((a, b) => a + b, 0)
  const step = Math.max(1, Math.round(i.moq || 1))
  const slow = d.rate < SLOW_RATE
  // A slow seller is not stocked up: only when it is gone (counting what customers are waiting for) and it has really sold.
  const wanted = slow ? (have - i.waiting <= 0 && units >= 2 ? 1 : 0) + i.waiting : d.rate * i.weeks + i.waiting
  const need = wanted - have
  const qty = need > 0 ? Math.ceil(need / step) * step : 0
  const hold: Hold = qty > 0 && d.rate > 0 && qty / d.rate > MAX_MOQ_WEEKS ? 'moq' : null
  const working = [
    d.rate > 0 ? `Sells about ${perWeekText(d.rate)} a week (lately ${perWeekText(d.recent)}, over ${Math.min(i.series.length, DEMAND.longWeeks)} weeks ${perWeekText(d.long)}${d.trend < 0.95 || d.trend > 1.05 ? `, store trend ${d.trend.toFixed(2)}` : ''}).` : units > 0 ? 'Has sold, but not lately.' : 'No sales in the weeks loaded.',
    `Has ${have} counting stock, orders and transfers.`,
    i.waiting > 0 ? `${i.waiting} wanted by customers.` : '',
    slow ? 'A slow seller, so it is suggested only when it is out.' : `To hold ${i.weeks} ${i.weeks === 1 ? 'week' : 'weeks'} it needs ${perWeekText(wanted)}.`,
    qty > 0 ? `Order ${qty}${step > 1 ? ` (MOQ ${step})` : ''}.` : need > 0 ? '' : 'Nothing needed.',
    hold === 'moq' ? `One MOQ lasts about ${Math.round(qty / d.rate)} weeks of sales, so it is your call.` : '',
  ].filter(Boolean).join(' ')
  const brief = d.rate > 0 ? `Sells about ${perWeekText(d.rate)} a week, has ${have}${i.waiting > 0 ? `, ${i.waiting} for customers` : ''}` : i.waiting > 0 ? `${i.waiting} wanted by customers, has ${have}` : `Out of stock, sold ${units} lately`
  return { ...d, qty, fill: qty > 0 && hold === null, hold, have, need: Math.max(0, need), why: working, brief }
}
