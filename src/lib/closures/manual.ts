// Items chosen by hand, read with the same rules as a sheet: the list becomes rows with a header, and parseClosure and checkClosure do the rest.
import type { Row } from '../xlsx'

/** The first chosen item is row 1, so the header is row 0 (pass FIRST_ROW to parseClosure so the checks name the item's place in the list). */
export const FIRST_ROW = 0

export interface HandLine { code: string; description: string; qty: number }

export const rowsFromLines = (lines: HandLine[]): Row[] => [['Item No', 'Qty', 'Description'], ...lines.map((l): Row => [l.code, l.qty, l.description || undefined])]

/** Adds a chosen item to the list. Choosing an item that is already there adds to its quantity. */
export function addHandLine(lines: HandLine[], add: HandLine): HandLine[] {
  const have = lines.find((l) => l.code === add.code)
  return have ? lines.map((l) => (l === have ? { ...l, qty: l.qty + add.qty } : l)) : [...lines, add]
}
