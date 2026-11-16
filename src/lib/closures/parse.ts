// Reads a closing store's stock sheet (item code and quantity) from rows, whether they came from an .xlsx or a CSV. This file only
// reads and cleans; validate.ts decides whether what was read can be used.
import { num, text, type Row } from '../xlsx'
import type { Check } from '../sales/validate'

export interface ClosureLine { code: string; qty: number; description: string }
export interface Skipped { row: number; code: string; reason: 'no item code' | 'totals row' | 'zero quantity' } // row is the sheet's row number, from 1
export interface BadQty { row: number; code: string; why: 'blank' | 'not a number' | 'negative' | 'not a whole number' }
export interface ClosureParse {
  headerRow: number // zero-based index of the header row, or -1 when none was found
  lines: ClosureLine[] // every kept line, repeated codes included (validate.ts reports those)
  dataRows: number // rows below the header that have an item code
  skipped: Skipped[]
  badQty: BadQty[]
  checks: Check[] // warnings found while reading; validate.ts includes these in its own list
}

export const CODE_ALIASES = ['item no', 'item no.', 'no.', 'item code', 'code', 'sku', 'item number']
export const QTY_ALIASES = ['qty', 'quantity', 'qty.', 'units', 'on hand']
export const DESC_ALIASES = ['description', 'desc', 'item description']

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Column index of the first header that matches any alias, ignoring case and extra spaces, or -1. */
export function colOfAny(header: Row, aliases: string[]): number {
  const want = new Set(aliases.map(norm))
  for (let i = 0; i < header.length; i++) if (want.has(norm(text(header[i])))) return i
  return -1
}

const isTotals = (code: string) => /^(grand\s+|sub\s*)?totals?\b/i.test(code)

export function parseClosure(rows: Row[]): ClosureParse {
  const out: ClosureParse = { headerRow: -1, lines: [], dataRows: 0, skipped: [], badQty: [], checks: [] }
  let cCode = -1, cQty = -1, cDesc = -1
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i]
    if (!r) continue
    const a = colOfAny(r, CODE_ALIASES), b = colOfAny(r, QTY_ALIASES)
    if (a >= 0 && b >= 0 && a !== b) { out.headerRow = i; cCode = a; cQty = b; cDesc = colOfAny(r, DESC_ALIASES); break }
  }
  if (out.headerRow < 0) return out

  const numericCodes: string[] = []
  const textCodes: string[] = []
  for (let i = out.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.every((c) => text(c) === '')) continue
    const row = i + 1
    const raw = r[cCode]
    const code = text(raw)
    if (!code) { out.skipped.push({ row, code: '', reason: 'no item code' }); continue }
    if (isTotals(code)) { out.skipped.push({ row, code, reason: 'totals row' }); continue }
    out.dataRows++

    const q = r[cQty]
    if (text(q) === '') { out.badQty.push({ row, code, why: 'blank' }); continue }
    const qty = num(q, NaN)
    if (Number.isNaN(qty)) { out.badQty.push({ row, code, why: 'not a number' }); continue }
    if (qty < 0) { out.badQty.push({ row, code, why: 'negative' }); continue }
    if (!Number.isInteger(qty)) { out.badQty.push({ row, code, why: 'not a whole number' }); continue }
    if (qty === 0) { out.skipped.push({ row, code, reason: 'zero quantity' }); continue }

    ;(typeof raw === 'number' ? numericCodes : textCodes).push(code)
    out.lines.push({ code, qty, description: cDesc >= 0 ? text(r[cDesc]) : '' })
  }

  // Excel turns 00123 into the number 123 when a column is formatted as a number. If some codes here are numbers, and the codes are not all
  // the same length or others start with zero, some may have lost their zeros, so ask for a look.
  if (numericCodes.length) {
    const all = [...numericCodes, ...textCodes]
    const mixedLength = new Set(all.map((c) => c.length)).size > 1
    if (mixedLength || textCodes.some((c) => c.startsWith('0'))) {
      out.checks.push({ label: 'Item codes may have lost leading zeros', ok: false, blocking: false,
        detail: `${numericCodes.length} item code${numericCodes.length === 1 ? ' is' : 's are'} stored as numbers in the sheet, so any zeros at the start would have been dropped by Excel. Check that they match your item list.` })
    }
  }
  return out
}
