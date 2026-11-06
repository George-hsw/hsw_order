// A small, read-only .xlsx reader for the weekly reports. It reads values only (never formulas), decompresses only the sheets asked
// for, and keeps nothing: the caller gets plain rows and the file itself is not stored anywhere.
import { strFromU8, unzipSync } from 'fflate'

export type Cell = string | number | boolean | undefined
export type Row = Cell[]
export interface Sheet { name: string; hidden: boolean; rows: Row[] } // rows[0] is spreadsheet row 1; a skipped row is undefined
export interface Workbook { sheets: Sheet[]; sheet(name: string): Sheet | undefined }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  return ENTITIES[e.toLowerCase()] ?? m
})

/** Column letters to a zero-based index: A is 0, AA is 26. */
export const colIndex = (letters: string) => letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

const attr = (tag: string, name: string) => decode((tag.match(new RegExp('\\b' + name + '="([^"]*)"')) ?? [])[1] ?? '')

/** The sheets in a workbook with their file paths, in workbook order. */
function listSheets(workbookXml: string, relsXml: string) {
  const targets = new Map<string, string>()
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target').replace(/^\/?(xl\/)?/, '')
    if (id) targets.set(id, 'xl/' + target)
  }
  return [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: attr(m[0], 'name'),
    hidden: /state="(hidden|veryHidden)"/.test(m[0]),
    path: targets.get(attr(m[0], 'r:id')) ?? '',
  }))
}

function parseSheet(xml: string, strings: string[]): Row[] {
  const rows: Row[] = []
  let seq = 0
  for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    seq++
    const rowNo = Number(attr(r[1], 'r')) || seq
    const body = r[2]
    if (!body) continue
    const row: Row = []
    for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], 'r').match(/^([A-Z]+)/)
      if (!ref || c[2] === undefined) continue
      const type = attr(c[1], 't')
      const v = c[2].match(/<v>([\s\S]*?)<\/v>/)
      let value: Cell
      if (type === 'inlineStr') value = decode([...c[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))
      else if (!v) value = undefined
      else if (type === 's') value = strings[Number(v[1])]
      else if (type === 'str') value = decode(v[1])
      else if (type === 'b') value = v[1] === '1'
      else if (type === 'e') value = undefined
      else { const n = Number(v[1]); value = Number.isFinite(n) ? n : decode(v[1]) }
      if (value !== undefined && value !== '') row[colIndex(ref[1])] = value
    }
    rows[rowNo - 1] = row
  }
  return rows
}

/**
 * Reads a workbook. `want` limits which sheets are decompressed and parsed (by name), which matters for a 17 MB file with
 * 25 sheets. Sheets that are skipped still appear in `sheets`, with no rows.
 */
export function readWorkbook(data: Uint8Array, want: (name: string) => boolean = () => true): Workbook {
  const meta = unzipSync(data, { filter: (f) => f.name === 'xl/workbook.xml' || f.name === 'xl/_rels/workbook.xml.rels' || f.name === 'xl/sharedStrings.xml' })
  if (!meta['xl/workbook.xml']) throw new Error('That is not an Excel (.xlsx) file.')
  const list = listSheets(strFromU8(meta['xl/workbook.xml']), meta['xl/_rels/workbook.xml.rels'] ? strFromU8(meta['xl/_rels/workbook.xml.rels']) : '')
  const strings = meta['xl/sharedStrings.xml']
    ? [...strFromU8(meta['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
    : []
  const wanted = new Set(list.filter((s) => s.path && want(s.name)).map((s) => s.path))
  const files = unzipSync(data, { filter: (f) => wanted.has(f.name) })
  const sheets: Sheet[] = list.map((s) => ({ name: s.name, hidden: s.hidden, rows: files[s.path] ? parseSheet(strFromU8(files[s.path]), strings) : [] }))
  return { sheets, sheet: (name) => sheets.find((s) => s.name === name) }
}

// ---------- reading values out of rows ----------

/** The cell as trimmed text ('' when empty). */
export const text = (c: Cell): string => (c === undefined || c === null ? '' : String(c).trim())

/** The cell as a number: a number as is, text like "1,250.5" parsed, anything else 0 (or `fallback`). */
export function num(c: Cell, fallback = 0): number {
  if (typeof c === 'number') return Number.isFinite(c) ? c : fallback
  if (typeof c === 'string' && c.trim() !== '') { const n = Number(c.replace(/[,$%\s]/g, '')); return Number.isFinite(n) ? n : fallback }
  return fallback
}

/** Index of the first row whose cell in column `col` equals `value` (within the first `within` rows), or -1. */
export function findRow(rows: Row[], col: number, value: string, within = 30): number {
  for (let i = 0; i < Math.min(rows.length, within); i++) if (rows[i] && text(rows[i][col]).toLowerCase() === value.toLowerCase()) return i
  return -1
}

/** Column index by exact header text, taking the `nth` match (0 = first) for headers that repeat across blocks. */
export function colOf(header: Row, name: string, nth = 0): number {
  let seen = -1
  for (let i = 0; i < header.length; i++) if (text(header[i]).replace(/\s+/g, ' ') === name && ++seen === nth) return i
  return -1
}

/** An Excel date serial (days since 1899-12-30) as yyyy-mm-dd. */
export function excelDate(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10)
}
