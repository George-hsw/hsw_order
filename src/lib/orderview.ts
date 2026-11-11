// What the Order table shows beside each item, worked out by plain rules from figures the app already has.

/** NAV's price includes GST at 10%; the store cost does not. */
export const GST_DIVISOR = 1.1
/** The weeks of sales the stock colour is measured against. */
export const COVER_WEEKS = 12
/** The weeks the little sales chart shows. */
export const CHART_WEEKS = 13

/** Gross profit as a percentage of the price before GST, or null when the price or the cost is not known. */
export function gpPercent(priceIncGst: number | null | undefined, cost: number | null | undefined): number | null {
  if (!priceIncGst || priceIncGst <= 0 || !cost || cost <= 0) return null
  const ex = priceIncGst / GST_DIVISOR
  return Math.round(((ex - cost) / ex) * 1000) / 10
}

/** Units sold over the last `weeks` of a series that is oldest first. */
export function soldOver(series: number[] | undefined, weeks: number): number {
  return (series ?? []).slice(-weeks).reduce((a, n) => a + Math.max(0, n), 0)
}

export type Cover = 'short' | 'even' | 'covered'
export const COVER_LABEL: Record<Cover, string> = { short: 'Short', even: 'Enough', covered: 'Covered' }
export const COVER_HELP: Record<Cover, string> = {
  short: 'In stock plus on order is less than the units sold',
  even: 'In stock plus on order equals the units sold',
  covered: 'In stock plus on order is more than the units sold',
}

/** Red, yellow or green: stock plus what is on order, against the units sold over the weeks measured. Null when the item has not sold, so there is nothing to compare. */
export function coverStatus(inventory: number | undefined, onOrder: number | undefined, sold: number): Cover | null {
  if (sold <= 0) return null
  const have = Math.max(0, inventory ?? 0) + Math.max(0, onOrder ?? 0)
  return have < sold ? 'short' : have === sold ? 'even' : 'covered'
}
