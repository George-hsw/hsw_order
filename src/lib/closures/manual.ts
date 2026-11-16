// Items typed or pasted by hand, read with the same rules as a sheet: the text becomes rows with a header, and parseClosure and checkClosure do the rest.
import type { Row } from '../xlsx'

/** The first typed line is row 1, so the header is row 0 (pass FIRST_ROW to parseClosure so the checks name the line the person typed). */
export const FIRST_ROW = 0

/** One item per line: the item number, then the quantity, then an optional description. Separated by a tab, comma, semicolon or spaces. */
export function rowsFromText(text: string): Row[] {
  const rows: Row[] = [['Item No', 'Qty', 'Description']]
  for (const line of text.split(/\r\n|\n|\r/)) {
    const parts = line.trim().split(/[\t,;]+|\s+/).map((p) => p.trim()).filter(Boolean)
    rows.push(parts.length ? [parts[0], parts[1], parts.slice(2).join(' ') || undefined] : [])
  }
  while (rows.length > 1 && rows[rows.length - 1].length === 0) rows.pop() // a trailing newline is not a line
  return rows
}
