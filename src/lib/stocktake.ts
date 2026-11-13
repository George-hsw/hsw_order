import type { CountLine, CountRow } from './supabase'
import type { Product } from './order'

// Stock take logic: what a count means for stock, and the lines for NAV. Pure functions, so they are tested without a screen.

const cents = (n: number) => Math.round(n * 100)

export type Side = 'positive' | 'negative'
export const SIDE_LABEL: Record<Side, string> = { positive: 'Positive adjustment', negative: 'Negative adjustment' }
export const SIDE_HELP: Record<Side, string> = {
  positive: 'Stock the shelf holds that the system does not. NAV adds it to the stock.',
  negative: 'Stock the system has that the shelf does not. NAV takes it off the stock.',
}

type Counted = Pick<CountLine, 'counted' | 'system_qty'>

/** Counted minus what the system said. Above zero is a gain, below zero a loss. */
export const variance = (l: Counted): number => Math.round((l.counted - Number(l.system_qty)) * 100) / 100
export const sideOf = (l: Counted): Side | null => { const v = variance(l); return v > 0 ? 'positive' : v < 0 ? 'negative' : null }

/** A quantity without a pointless ".00": 6 stays 6, 6.5 stays 6.5. */
export const fmtQty = (n: number) => String(Math.round(Number(n) * 100) / 100)
/** "+3" or "−3" (a real minus sign), "0" for no difference. */
export const fmtDiff = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtQty(Math.abs(n))

/** The dollar value of a line's difference at store cost, always positive. Worked in cents so totals never drift. */
export const adjustValue = (l: Pick<CountLine, 'counted' | 'system_qty' | 'unit_cost'>): number => Math.abs(cents(variance(l) * Number(l.unit_cost))) / 100

export interface Verdict { kind: 'match' | 'over' | 'short'; text: string }
/** What to say straight after a count is typed in, with the system's number now revealed. */
export function verdict(counted: number, system: number): Verdict {
  const d = variance({ counted, system_qty: system })
  if (d === 0) return { kind: 'match', text: `Matches the system (${fmtQty(system)}).` }
  return {
    kind: d > 0 ? 'over' : 'short',
    text: `The system says ${fmtQty(system)}. You counted ${fmtQty(counted)}, which is ${fmtQty(Math.abs(d))} ${d > 0 ? 'more' : 'fewer'}.`,
  }
}

export interface Split { positive: CountLine[]; negative: CountLine[]; matched: CountLine[] }
/** Splits a count into the two NAV journals. Items that matched need no adjustment. Each list is sorted by item number. */
export function splitAdjustments(lines: CountLine[]): Split {
  const out: Split = { positive: [], negative: [], matched: [] }
  for (const l of lines) (sideOf(l) === 'positive' ? out.positive : sideOf(l) === 'negative' ? out.negative : out.matched).push(l)
  for (const k of ['positive', 'negative'] as const) out[k].sort((a, b) => a.item_code.localeCompare(b.item_code))
  return out
}

export interface CountTotals { counted: number; matched: number; differ: number; gainUnits: number; lossUnits: number; gainValue: number; lossValue: number }
export function countTotals(lines: CountLine[]): CountTotals {
  const t: CountTotals = { counted: lines.length, matched: 0, differ: 0, gainUnits: 0, lossUnits: 0, gainValue: 0, lossValue: 0 }
  let gain = 0
  let loss = 0
  for (const l of lines) {
    const d = variance(l)
    if (d === 0) { t.matched++; continue }
    t.differ++
    if (d > 0) { t.gainUnits += d; gain += cents(adjustValue(l)) } else { t.lossUnits += -d; loss += cents(adjustValue(l)) }
  }
  t.gainUnits = Math.round(t.gainUnits * 100) / 100
  t.lossUnits = Math.round(t.lossUnits * 100) / 100
  t.gainValue = gain / 100
  t.lossValue = loss / 100
  return t
}

export function sideTotals(lines: CountLine[]): { lines: number; units: number; value: number } {
  let units = 0
  let value = 0
  for (const l of lines) { units += Math.abs(variance(l)); value += cents(adjustValue(l)) }
  return { lines: lines.length, units: Math.round(units * 100) / 100, value: value / 100 }
}

/** Review order: the differences that cost or gain the most dollars first, matches last. */
export function byImpact(lines: CountLine[]): CountLine[] {
  return [...lines].sort((a, b) => adjustValue(b) - adjustValue(a) || Math.abs(variance(b)) - Math.abs(variance(a)) || a.item_code.localeCompare(b.item_code))
}

export const NAV_ENTRY: Record<Side, string> = { positive: 'Positive Adjmt.', negative: 'Negative Adjmt.' }
const JOURNAL_HEADER = ['Posting Date', 'Entry Type', 'Document No.', 'Item No.', 'Description', 'Location Code', 'Quantity', 'Unit of Measure Code']
const clean = (s: string) => [...s].map((c) => (c.charCodeAt(0) < 32 ? ' ' : c)).join('') // no tabs or line breaks inside a cell
const ausDate = (d: Date) => d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })

/**
 * Tab-separated item journal lines for one side, ready to paste into a NAV item journal. The quantity is always the positive size of the
 * difference: the entry type says whether NAV adds or removes it. Item numbers stay text so leading zeros survive.
 */
export function navAdjustText(lines: CountLine[], side: Side, locationCode: string, date = new Date(), withHeader = false): string {
  const when = ausDate(date)
  const rows = lines
    .filter((l) => sideOf(l) === side)
    .sort((a, b) => a.item_code.localeCompare(b.item_code))
    .map((l) => [when, NAV_ENTRY[side], '', l.item_code, clean(l.description), locationCode, fmtQty(Math.abs(variance(l))), l.uom ?? ''].join('\t'))
  return [...(withHeader ? [JOURNAL_HEADER.join('\t')] : []), ...rows].join('\n')
}

/** Counting the same item twice adds the second count to the first (a shelf plus the back room). */
export const addCounts = (earlier: number | undefined, now: number) => (earlier ?? 0) + now

/** What a count is about, in a few words. */
export function scopeLabel(c: Pick<CountRow, 'kind' | 'scope_type' | 'scope_value'>): string {
  if (c.kind === 'full') return 'Full stock take'
  if (c.scope_type === 'vendor') return `Vendor ${c.scope_value}`
  if (c.scope_type === 'category') return `Category ${c.scope_value}`
  if (c.scope_type === 'division') return `Division ${c.scope_value}`
  return 'Scanned items'
}

/** When this vendor or division was last counted (the newest finished count with that scope), or null. */
export function lastCounted(counts: CountRow[], type: 'vendor' | 'category' | 'division', value: string): string | null {
  const done = counts.filter((c) => c.kind === 'rolling' && c.scope_type === type && c.scope_value === value && c.status !== 'open' && c.saved_at)
  return done.reduce<string | null>((best, c) => (best === null || c.saved_at! > best ? c.saved_at : best), null)
}

/** Items the system says the store holds: stock on hand that is not 0. A negative balance counts, since it still needs a look. */
export const onHand = (range: Product[]): Product[] => range.filter((p) => (p.stock?.inventory ?? 0) !== 0)

/** Items in the scope with no counted line yet, items holding stock first. */
export function stillToCount(range: Product[], lines: CountLine[]): Product[] {
  const done = new Set(lines.map((l) => l.item_code))
  return range
    .filter((p) => !done.has(p.item.code))
    .sort((a, b) => (b.stock?.inventory ?? 0) - (a.stock?.inventory ?? 0) || a.item.code.localeCompare(b.item.code))
}

/** The side of a count that still needs a NAV journal entered. */
export function sidesToPost(count: Pick<CountRow, 'nav_pos_ref' | 'nav_neg_ref'>, split: Split): Side[] {
  const out: Side[] = []
  if (split.positive.length && !count.nav_pos_ref) out.push('positive')
  if (split.negative.length && !count.nav_neg_ref) out.push('negative')
  return out
}
