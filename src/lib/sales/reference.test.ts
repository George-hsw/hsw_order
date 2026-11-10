import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { crossReference, parseReference } from './reference'
import { blocked, crossDetailed, failures, loadableStores } from './validate'

// A small Power BI "Export data" workbook, written the way Power BI writes it: x: prefix, inline strings, empty cells as <x:c />.
const s = (t: string) => `<x:c t="inlineStr"><x:is><x:t>${t}</x:t></x:is></x:c>`
const n = (v: number | null) => (v === null ? '<x:c />' : `<x:c><x:v>${v}</x:v></x:c>`)
const row = (cells: string[]) => `<x:row>${cells.join('')}</x:row>`
function exportFile(filters = 'FinancialWeekLabel_AU is FY2027 Week 9'): Uint8Array {
  const head = row([s('Col_Name'), ...['Alpha', 'Beta', 'Total'].flatMap((x) => [s(x), s(x), s(x)])])
  const sub = row([s('No.'), ...Array(3).fill([s('Store Sales LCY'), s('Store Sales Qty'), s('Store Rank')]).flat()])
  const items = [
    row([s('A1'), n(10), n(1), n(1), n(20), n(2), n(1), n(30), n(3), n(null)]),
    row([s('A2'), n(5), n(1), n(2), n(null), n(null), n(null), n(5), n(1), n(null)]),
    row([s('A3'), n(null), n(null), n(null), n(7), n(1), n(3), n(7), n(1), n(null)]),
  ]
  const total = row([s('Total'), n(15), n(2), n(null), n(27), n(3), n(null), n(42), n(5), n(null)])
  const last = row([s(`Applied filters:\r\n${filters}`)])
  const sheet = `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${[head, sub, ...items, total, last].join('')}</x:sheetData></x:worksheet>`
  const book = '<?xml version="1.0"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Export" sheetId="1"/></x:sheets></x:workbook>'
  return zipSync({ 'xl/workbook.xml': strToU8(book), 'xl/worksheets/sheet1.xml': strToU8(sheet) })
}
const item = (item_code: string, net_sales: number, qty: number) => ({ item_code, net_sales, qty })
const sheet = (store_name: string, items: ReturnType<typeof item>[], header_stock = 100) => ({ tab: store_name.slice(0, 4).toUpperCase(), store_name, a1: '', items, totals: { header_stock, sum_net: 0 } })
const detailed = (...sheets: ReturnType<typeof sheet>[]) => ({ week: { fy: 2027, week: 9 }, warnings: [], format: [], sheets }) as never

describe('a Power BI item export', () => {
  it('is recognised by what is inside, not by its name, and says its year and week', () => {
    const r = parseReference(exportFile())!
    expect(r).not.toBeNull()
    expect([r.fy, r.week]).toEqual([2027, 9])
    expect([...r.stores.keys()]).toEqual(['Alpha', 'Beta']) // the Total columns are not a store
    expect(r.items).toBe(3)
    expect(r.stores.get('Alpha')!.get('A1')).toEqual({ net: 10, qty: 1 })
    expect(r.stores.get('Alpha')!.has('A3')).toBe(false) // an item the store did not sell is not listed for it
  })
  it('says no to any other workbook or file', () => {
    expect(parseReference(strToU8('not a zip'))).toBeNull()
    expect(parseReference(zipSync({ 'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Summary"/></sheets></workbook>'), 'xl/worksheets/sheet1.xml': strToU8('<worksheet/>') }))).toBeNull()
  })
})

describe('comparing a Detailed report with the export', () => {
  const ref = parseReference(exportFile())!
  it('proves a store whose items agree, and notes an item the sheet leaves out without blocking', () => {
    const { checks, proven } = crossReference(ref, detailed(sheet('Alpha', [item('A1', 10, 1)]), sheet('Beta', [item('A1', 20, 2), item('A3', 7, 1)])))
    expect(proven.has('alpha')).toBe(true) // A2 is missing from its sheet, but nothing in it is wrong
    expect(proven.has('beta')).toBe(true)
    const left = failures(checks).find((c) => c.label.startsWith('Alpha: items the sheet leaves out'))!
    expect(left.blocking).toBe(false)
    expect(left.detail).toContain('A2 (sales 5.00, units 1)')
    expect(blocked(checks)).toBe(false)
  })
  it('blocks a store whose figures differ, with the exact items', () => {
    const { checks, proven } = crossReference(ref, detailed(sheet('Alpha', [item('A1', 1, 10), item('A2', 5, 1)])))
    expect(proven.has('alpha')).toBe(false)
    expect(blocked(checks)).toBe(true)
    expect(failures(checks)[0].detail).toContain('A1: sheet sales 1.00 and units 10, export sales 10.00 and units 1')
  })
  it('does nothing for another week', () => {
    const other = { week: { fy: 2027, week: 10 }, warnings: [], format: [], sheets: [sheet('Alpha', [item('A1', 1, 10)])] } as never
    expect(crossReference(ref, other).checks).toEqual([])
  })
})

describe('loading only the stores that pass', () => {
  const ref = parseReference(exportFile())!
  const d = detailed(sheet('Alpha', [item('A1', 10, 1), item('A2', 5, 1)]), sheet('Beta', [item('A1', 99, 9)]))
  const checks = crossReference(ref, d).checks
  it('lists the stores to load and the stores to skip with the reason', () => {
    const p = loadableStores(checks, ['Alpha', 'Beta'])!
    expect(p.load).toEqual(['Alpha'])
    expect(p.skip.map((x) => x.name)).toEqual(['Beta'])
    expect(p.skip[0].why).toContain('disagree')
  })
  it('is not offered when something that is not about one store blocks the file', () => {
    expect(loadableStores([...checks, { label: 'Expected columns', ok: false, blocking: true, detail: 'x' }], ['Alpha', 'Beta'])).toBeNull()
  })
  it('is not offered when every store fails', () => {
    expect(loadableStores(crossReference(ref, detailed(sheet('Beta', [item('A1', 99, 9)]))).checks, ['Beta'])).toBeNull()
  })
})

describe('a stock figure that differs from the weekly report', () => {
  const weekly = { current: { fy: 2027, week: 9 }, rows: [{ week: 9, store_name: 'Alpha', co_fran: 'Company', ty_sales: 100, stock: 50 }] } as never
  const d = detailed(sheet('Alpha', [item('A1', 10, 1)], 80))
  it('blocks the sheet on its own, but is only noted when the item export proves the store', () => {
    expect(blocked(crossDetailed(weekly, d))).toBe(true)
    const c = crossDetailed(weekly, d, new Set(['alpha']))
    expect(blocked(c)).toBe(false)
    expect(failures(c).find((x) => x.label.includes('stock matches'))!.detail).toContain('proves the sheet is Alpha')
  })
})
