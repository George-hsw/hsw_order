// A small CSV reader (RFC 4180) for closing-store sheets. It gives back the same shape as readWorkbook, so one parser serves both
// file types. Cells are text (a CSV has no types), and an empty field is left undefined like an empty Excel cell.
import type { Row, Sheet } from '../xlsx'

/** Which separator a file uses: a semicolon when the first line has no comma but has a semicolon (common in Excel exports), else a comma. */
function separator(text: string): string {
  const first = text.split(/\r\n|\n|\r/, 1)[0]
  return !first.includes(',') && first.includes(';') ? ';' : ','
}

/** Reads CSV text into rows. A blank line is kept as an empty row so row numbers match the file's line numbers. */
export function parseCsv(input: string): Row[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const sep = separator(text)
  const rows: Row[] = []
  let row: Row = []
  let field = ''
  let quoted = false // inside a quoted field
  let touched = false // the current row has had any character at all
  const endField = () => { row.push(field === '' ? undefined : field); field = '' }
  const endRow = () => { endField(); while (row.length && row[row.length - 1] === undefined) row.pop(); rows.push(row); row = []; touched = false }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    touched = true
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === sep) endField()
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else field += ch
  }
  if (touched) endRow() // a last line with no newline after it
  return rows
}

/** A CSV as a Sheet, the same as one tab of a workbook. */
export const readCsv = (text: string): Sheet => ({ name: 'CSV', hidden: false, rows: parseCsv(text) })

/** Decodes bytes as UTF-8. `suspect` is true when the text holds the replacement character, which usually means a Windows-1252 file. */
export function decodeUtf8(bytes: Uint8Array): { text: string; suspect: boolean } {
  const text = new TextDecoder('utf-8').decode(bytes)
  return { text, suspect: text.includes('�') }
}
