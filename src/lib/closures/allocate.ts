// Closures: share a closing store's stock out to the stores that are short of it. Plain rules, no guessing: the same numbers always give the same answer.
// Per item, the stores that need it (shortfall = wanted minus have, worked out in the database) are filled in proportion to their shortfall,
// in whole units, never above a store's shortfall, never more than the closing store has. Anything not taken is left over.

export interface ClosingLine { code: string; qty: number }
export interface NeedLine { store: string; code: string; shortfall: number }
/** store -> item code -> units */
export type Alloc = Map<string, Map<string, number>>
export interface Allocation { alloc: Alloc; left: Map<string, number> }

const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Closing quantity per item (repeated codes added together; nothing at or below zero). */
function closingQty(closing: ClosingLine[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const c of closing) {
    const q = whole(c.qty)
    if (q > 0) out.set(c.code, (out.get(c.code) ?? 0) + q)
  }
  return out
}

/** Shortfall per item per store, for the stores taking part only (repeated rows added together; a zero shortfall is no row). */
function shortfalls(need: NeedLine[], stores: Set<string>): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const n of need) {
    const sf = whole(n.shortfall)
    if (sf <= 0 || !stores.has(n.store)) continue
    const m = out.get(n.code) ?? new Map<string, number>()
    m.set(n.store, (m.get(n.store) ?? 0) + sf)
    out.set(n.code, m)
  }
  return out
}

/** Share the closing stock out by shortfall (largest remainder; ties go to the larger shortfall, then the store id, so the answer never changes). */
export function allocate(closing: ClosingLine[], need: NeedLine[], stores: string[]): Allocation {
  const taking = new Set(stores)
  const ordered = [...taking].sort(byText)
  const alloc: Alloc = new Map(ordered.map((s) => [s, new Map<string, number>()]))
  const left = new Map<string, number>()
  const sf = shortfalls(need, taking)

  for (const [code, qty] of [...closingQty(closing)].sort((a, b) => byText(a[0], b[0]))) {
    const rows = sf.get(code)
    const total = rows ? [...rows.values()].reduce((x, y) => x + y, 0) : 0
    if (!rows || total === 0) { left.set(code, qty); continue }

    const give = new Map<string, number>()
    if (qty >= total) {
      for (const [s, v] of rows) give.set(s, v)
    } else {
      const parts = [...rows].map(([store, shortfall]) => ({ store, shortfall, base: Math.floor((qty * shortfall) / total), frac: (qty * shortfall) % total }))
      let spare = qty - parts.reduce((x, p) => x + p.base, 0)
      const order = [...parts].sort((a, b) => b.frac - a.frac || b.shortfall - a.shortfall || byText(a.store, b.store))
      for (const p of order) { if (spare > 0) { p.base += 1; spare -= 1 } }
      for (const p of parts) give.set(p.store, p.base)
    }
    let used = 0
    for (const [s, v] of give) {
      if (v > 0) { alloc.get(s)!.set(code, v); used += v }
    }
    left.set(code, qty - used)
  }
  return { alloc, left }
}

export interface Summary {
  items: number // items on the closing sheet
  units: number // units on the closing sheet
  allocated: number
  left: number
  valueAllocated: number // at cost
  valueLeft: number
  valueTotal: number
  pctAllocated: number // of units, 0 to 100 (one decimal)
}

const sumAlloc = (alloc: Alloc): Map<string, number> => {
  const per = new Map<string, number>()
  for (const m of alloc.values()) for (const [code, q] of m) per.set(code, (per.get(code) ?? 0) + q)
  return per
}

/** Whole-closure figures. Units left over are the closing quantity minus what is allocated, so this stays right after the person edits quantities. */
export function summary(alloc: Alloc, closing: ClosingLine[], cost: Map<string, number>): Summary {
  const qty = closingQty(closing)
  const per = sumAlloc(alloc)
  let units = 0, allocated = 0, valueAllocated = 0, valueTotal = 0
  for (const [code, q] of qty) {
    const a = Math.min(per.get(code) ?? 0, q)
    const c = cost.get(code) ?? 0
    units += q
    allocated += a
    valueAllocated += a * c
    valueTotal += q * c
  }
  const pct = units > 0 ? Math.round((allocated / units) * 1000) / 10 : 0
  return { items: qty.size, units, allocated, left: units - allocated, valueAllocated, valueLeft: valueTotal - valueAllocated, valueTotal, pctAllocated: pct }
}
/** Same as `summary`, for callers that call it `totals`. */
export const totals = summary

export interface StoreLine { code: string; qty: number; shortfall: number; suggested: number; over: boolean }
export interface StoreRow { store: string; lines: StoreLine[]; units: number }

/** One row per store: its lines (item, quantity going, shortfall, the original suggestion). `over` flags a quantity above the store's shortfall. `suggested` defaults to `alloc`. */
export function byStore(alloc: Alloc, need: NeedLine[], suggested: Alloc = alloc): StoreRow[] {
  const sf = shortfalls(need, new Set([...alloc.keys(), ...suggested.keys()]))
  const stores = [...new Set([...alloc.keys(), ...suggested.keys()])].sort(byText)
  return stores.map((store) => {
    const mine = alloc.get(store) ?? new Map<string, number>()
    const first = suggested.get(store) ?? new Map<string, number>()
    const codes = [...new Set([...mine.keys(), ...first.keys()])].sort(byText)
    const lines = codes.map((code) => {
      const qty = mine.get(code) ?? 0
      const shortfall = sf.get(code)?.get(store) ?? 0
      return { code, qty, shortfall, suggested: first.get(code) ?? 0, over: qty > shortfall }
    })
    return { store, lines, units: lines.reduce((x, l) => x + l.qty, 0) }
  })
}

export interface ItemStore { store: string; qty: number; shortfall: number; over: boolean }
export interface ItemRow { code: string; closing: number; stores: ItemStore[]; allocated: number; left: number; overAllocated: boolean; anyOver: boolean }

/** One row per closing item: the closing quantity, what each store gets against its shortfall, and what is left. `overAllocated` means more is going than the closing store has. */
export function byItem(alloc: Alloc, need: NeedLine[], closing: ClosingLine[]): ItemRow[] {
  const qty = closingQty(closing)
  const stores = [...alloc.keys()].sort(byText)
  const sf = shortfalls(need, new Set(stores))
  return [...qty].sort((a, b) => byText(a[0], b[0])).map(([code, closingQ]) => {
    const row = stores
      .map((store) => ({ store, qty: alloc.get(store)?.get(code) ?? 0, shortfall: sf.get(code)?.get(store) ?? 0 }))
      .filter((r) => r.qty > 0 || r.shortfall > 0)
      .map((r) => ({ ...r, over: r.qty > r.shortfall }))
    const allocated = row.reduce((x, r) => x + r.qty, 0)
    return { code, closing: closingQ, stores: row, allocated, left: closingQ - allocated, overAllocated: allocated > closingQ, anyOver: row.some((r) => r.over) }
  })
}

export interface Problem { kind: 'over-allocated' | 'bad-qty'; code: string; store?: string; message: string }

/** Checks before sending: no item allocated beyond the closing quantity, and every quantity a whole number of zero or more. An empty list is fine to send. */
export function reconcile(alloc: Alloc, closing: ClosingLine[]): Problem[] {
  const problems: Problem[] = []
  const qty = closingQty(closing)
  const per = new Map<string, number>()
  for (const store of [...alloc.keys()].sort(byText)) {
    for (const [code, q] of [...alloc.get(store)!].sort((a, b) => byText(a[0], b[0]))) {
      if (!Number.isInteger(q) || q < 0) {
        problems.push({ kind: 'bad-qty', code, store, message: `${store} has ${q} of ${code}: it must be a whole number, zero or more.` })
        continue
      }
      per.set(code, (per.get(code) ?? 0) + q)
    }
  }
  for (const [code, total] of [...per].sort((a, b) => byText(a[0], b[0]))) {
    const have = qty.get(code) ?? 0
    if (total > have) problems.push({ kind: 'over-allocated', code, message: `${code} is allocated ${total} but the closing store has ${have}.` })
  }
  return problems
}
