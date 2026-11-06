// Builds a tiny .xlsx in memory, for tests only. Real report files are never copied into the project: tests use made-up workbooks
// shaped like the reports.
import { strToU8, zipSync } from 'fflate'
import type { Cell } from './xlsx'

export interface TestSheet { name: string; rows: Cell[][]; hidden?: boolean }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const colName = (i: number) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26) } return s }

export function makeXlsx(sheets: TestSheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships>' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>'),
  }
  sheets.forEach((s, i) => {
    const rows = s.rows.map((row, r) => {
      const cells = row.map((v, c) => {
        if (v === undefined || v === '') return ''
        const ref = `${colName(c)}${r + 1}`
        return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(String(v))}</t></is></c>`
      }).join('')
      return `<row r="${r + 1}">${cells}</row>`
    }).join('')
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`)
  })
  return zipSync(files)
}
