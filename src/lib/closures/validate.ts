// The gate before a closing store's sheet is used. A blocking check that fails stops the upload; a warning is shown but does not.
import { blocked, type Check } from '../sales/validate'
import type { ClosureParse } from './parse'

export { blocked }
export const MAX_LINES = 20_000

export interface ClosureValidateOptions {
  knownCodes?: Set<string> // when given, any code not in it blocks
  systemQty?: Map<string, number> // the closing store's stock in the system, by code; a larger sheet quantity is only a warning
}

/** "A, B, C and 4 more" for the first few items of a long list. */
const few = (items: string[], n = 5) => items.length > n ? `${items.slice(0, n).join(', ')} and ${items.length - n} more` : items.join(', ')
const s = (n: number, one: string, many: string) => (n === 1 ? one : many)

export function checkClosure(p: ClosureParse, opts: ClosureValidateOptions = {}): Check[] {
  const out: Check[] = [...p.checks]
  const found = p.headerRow >= 0
  out.push({ label: 'Header row found', ok: found, blocking: true,
    detail: 'No header row was found in the first 30 rows. The sheet needs a column for the item code (such as Item No or Code) and one for the quantity (such as Qty or Quantity).' })
  if (!found) return out

  out.push({ label: 'Sheet has items', ok: p.dataRows > 0, blocking: true, detail: 'There are no item rows below the header.' })
  out.push({ label: 'Not too many lines', ok: p.dataRows <= MAX_LINES, blocking: true,
    detail: `The sheet has ${p.dataRows.toLocaleString('en-AU')} item rows, and the limit is ${MAX_LINES.toLocaleString('en-AU')}. Split it into smaller sheets.` })

  const counts = new Map<string, number>()
  for (const l of p.lines) counts.set(l.code, (counts.get(l.code) ?? 0) + 1)
  const dups = [...counts].filter(([, n]) => n > 1).map(([c]) => c)
  out.push({ label: 'No repeated item codes', ok: dups.length === 0, blocking: true,
    detail: `${dups.length} item ${s(dups.length, 'code appears', 'codes appear')} more than once: ${few(dups)}. Combine them into one row each.` })

  out.push({ label: 'Quantities are whole numbers of zero or more', ok: p.badQty.length === 0, blocking: true,
    detail: `${p.badQty.length} ${s(p.badQty.length, 'row has', 'rows have')} a quantity that cannot be used: ${few(p.badQty.map((b) => `row ${b.row} (${b.code}, ${b.why})`), 3)}.` })

  const zero = p.skipped.filter((x) => x.reason === 'zero quantity')
  out.push({ label: 'Zero quantities left out', ok: zero.length === 0, blocking: false,
    detail: `${zero.length} ${s(zero.length, 'item has', 'items have')} a quantity of zero and will be left out: ${few(zero.map((z) => z.code))}.` })

  if (opts.knownCodes) {
    const known = opts.knownCodes
    const unknown = [...new Set(p.lines.filter((l) => !known.has(l.code)).map((l) => l.code))]
    out.push({ label: 'Item codes are known', ok: unknown.length === 0, blocking: true,
      detail: `${unknown.length} item ${s(unknown.length, 'code is', 'codes are')} not in the item list: ${few(unknown)}.` })
  }
  if (opts.systemQty) {
    const sys = opts.systemQty
    const over = p.lines.filter((l) => sys.has(l.code) && l.qty > sys.get(l.code)!).map((l) => `${l.code} (sheet ${l.qty}, system ${sys.get(l.code)})`)
    out.push({ label: 'Sheet quantities are within system stock', ok: over.length === 0, blocking: false,
      detail: `${over.length} ${s(over.length, 'item has', 'items have')} more on the sheet than the system shows: ${few(over, 3)}.` })
  }
  return out
}
