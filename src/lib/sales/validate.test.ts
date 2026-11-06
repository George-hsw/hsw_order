import { describe, expect, it } from 'vitest'
import { makeXlsx } from '../testXlsx'
import { parseDaily, parseDetailed, parseWeekly } from './parse'
import { blocked, checkDaily, checkDetailed, checkWeekly, crossCheck, failures } from './validate'

const HEAD = ['No.', 'x', 'x', 'Item Description', 'MOQ', 'Item Vendor No.', 'Business Rank', 'Item Division Code', 'x', 'x', 'x', 'x', 'x', 'Inventory', '13W', 'x', 'COGS', 'Net Sales', 'QTY Sold', 'Ranking',
  'COGS', 'Net Sales', 'QTY Sold', 'Store Rank YTD', 'Net Sales', 'QTY Sold', 'No Stores Stocking', 'Potential Sales', 'Potential Sales Growth', 'Potential Ranking', 'Potential Loss']
const item = (code: string, net: number, qty: number) => { const r: (string | number)[] = new Array(31).fill(0); r[0] = code; r[3] = code; r[17] = net; r[18] = qty; r[19] = qty ? 5 : 0; return r }
const labels = () => { const r: string[] = []; r[16] = 'STORE WEEKLY'; r[20] = 'STORE YTD'; r[24] = 'GROUP WEEKLY'; return r }
const good = (c: ReturnType<typeof checkDetailed>) => failures(c).filter((x) => !x.label.startsWith('All store sheets')) // a one-sheet fixture is never all 23
const top = (net: number, qty: number) => { const r: (string | number)[] = ['Artarmon', 'Week10']; r[17] = net; r[18] = qty; return r }
const detailed = (headNet: number, headQty: number, rows = [item('A1', 50, 3), item('A2', 25.5, 2), item('A3', 0, 0)]) =>
  parseDetailed(makeXlsx([{ name: 'ARTA', rows: [top(headNet, headQty), [], labels(), HEAD, ...rows] }]), 'Detailed Sales Report_FY2027_Week10.xlsx')

describe('detailed sales checks', () => {
  it('passes when the rows add up to the sheet\'s own totals', () => {
    const c = checkDetailed(detailed(75.5, 5))
    expect(good(c)).toEqual([])
    expect(blocked(good(c))).toBe(false)
  })
  it('keeps a refund row that has no units, so the totals still add up', () => {
    const d = detailed(70.5, 5, [item('A1', 50, 3), item('A2', 25.5, 2), item('R1', -5, 0)])
    expect(d.sheets[0].items.map((i) => i.item_code)).toContain('R1')
    expect(good(checkDetailed(d))).toEqual([])
  })
  it('blocks when net sales or units disagree with the header', () => {
    expect(blocked(checkDetailed(detailed(80, 5)))).toBe(true)
    expect(blocked(checkDetailed(detailed(75.5, 6)))).toBe(true)
  })
  it('blocks a repeated item code', () => {
    const c = checkDetailed(detailed(125.5, 8, [item('A1', 50, 3), item('A1', 50, 3), item('A2', 25.5, 2)]))
    expect(failures(c).some((x) => x.label.includes('repeated') && x.blocking)).toBe(true)
  })
})

const WH = ['Store', 'RM', 'Co/Fran', 'State', 'Data', 'Retail SQM', 'Centre Type', 'Week No', 'L4L Adjust', 'TY Sales', 'LY Sales', 'No. of transactions', 'No. of transactions LY', 'Member Sales', 'Member Trans', 'Stock', 'SYS', 'GP Wk', 'GP Wk LY', 'Qty Sold', 'Basket Size']
const wrow = (store: string, wk: number, ty: number, ly: number) => [store, 'R', 'Company', 'NSW', 'LS', 400, 'C', wk, 0, ty, ly, 10, 10, 1, 1, 1, 1, 0.4, 0.4, 5, 2]
const weekly = (groupTy: number, groupLy: number) => parseWeekly(makeXlsx([
  { name: 'Summary-Wk', rows: [['Current Week Report', '', 'Week beg', 46264, '', '', 'Week No.', 2], [], [], ['Group Turnover', '', groupLy, groupTy]] },
  { name: 'Database', rows: [[], [], WH, wrow('Artarmon', 1, 90, 80), wrow('Artarmon', 2, 100, 90), wrow('Bondi', 2, 50.25, 40)] },
]), 'Australian Weekly Sales_FY2027-Week 2.xlsx')

describe('format checks', () => {
  const sheet = (head: string[], lab = labels()) => parseDetailed(makeXlsx([{ name: 'ARTA', rows: [top(75.5, 5), [], lab, head, item('A1', 50, 3), item('A2', 25.5, 2)] }]), 'Detailed Sales Report_FY2027_Week10.xlsx')
  it('blocks a Detailed file whose columns were renamed', () => {
    const c = checkDetailed(sheet(HEAD.map((h) => (h === 'Potential Loss' ? 'Lost Sales' : h))))
    expect(failures(c).some((x) => x.label.includes('expected columns') && x.detail.includes('Potential Loss'))).toBe(true)
    expect(blocked(c)).toBe(true)
  })
  it('blocks a Detailed file whose blocks have moved', () => {
    const moved: string[] = []; moved[16] = 'STORE WEEKLY'; moved[18] = 'GROUP WEEKLY'
    expect(failures(checkDetailed(sheet(HEAD, moved))).some((x) => x.label.includes('blocks in place'))).toBe(true)
  })
  it('names the store sheets that are missing', () => {
    expect(failures(checkDetailed(detailed(75.5, 5))).find((x) => x.label.startsWith('All store sheets'))?.detail).toContain('ASPL')
  })
})

describe('weekly checks', () => {
  it('passes when the week\'s stores add up to the report\'s Group Turnover', () => {
    expect(failures(checkWeekly(weekly(150.25, 130)))).toEqual([])
  })
  it('blocks when they do not', () => {
    expect(blocked(checkWeekly(weekly(999, 130)))).toBe(true)
    expect(blocked(checkWeekly(weekly(150.25, 1)))).toBe(true)
  })
})

const FULL = [undefined, undefined, 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Full Week', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Full Week']
const daily = (total: number, ty = [1, 2, 3, 4, 5, 6, 7], ly = [1, 1, 1, 1, 1, 1, 1]) => parseDaily(makeXlsx([
  { name: 'Daily Sales Report_Value', rows: [[], [undefined, undefined, '2025-26'], [undefined, undefined, '01/09/25', 45902, 45903, 45904, 45905, 45906, 45907, '2025-26 Week 2', '31/08/2026', 46266, 46267, 46268, 46269, 46270, 46271, '2026-27 Week 2'], FULL] },
  { name: 'FY27', rows: [[], [undefined, 'Location', 'Store Name', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Total'], [undefined, 12064, 'Artarmon', ...ty, total]] },
  { name: 'FY26', rows: [[], [], [undefined, 'Location', 'Store Name', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Total'], [undefined, 12064, 'Artarmon', ...ly, ly.reduce((a, b) => a + b, 0)]] },
]), 'Daily Sales_FY2027-Week2.xlsx')

describe('daily and cross checks', () => {
  it('passes when seven days equal the sheet\'s total', () => { expect(failures(checkDaily(daily(28)))).toEqual([]) })
  it('blocks when they do not', () => { expect(blocked(checkDaily(daily(30)))).toBe(true) })
  it('blocks when the daily week disagrees with the weekly report', () => {
    const w = weekly(150.25, 130) // Artarmon week 2: 100 this year, 90 last year
    expect(blocked(crossCheck(w, daily(28)))).toBe(true)
    expect(blocked(crossCheck(w, daily(100, [10, 10, 10, 10, 20, 20, 20], [10, 10, 10, 10, 10, 15, 15])))).toBe(true) // last year adds to 80, the weekly report says 90
  })
  it('passes when the days equal the week, this year and last', () => {
    const w = weekly(150.25, 130)
    expect(failures(crossCheck(w, daily(100, [10, 10, 10, 10, 20, 20, 20], [10, 10, 10, 10, 20, 15, 15]))).filter((c) => c.blocking)).toEqual([])
  })
})

import { crossDetailed } from './validate'
describe('a Detailed sheet is the store it is filed under', () => {
  const w = weekly(150.25, 130) // week 2: Artarmon and Bondi, each with stock 1
  const sheet = (name: string, stock: number) => ({ week: { fy: 2027, week: 2 }, warnings: [], format: [], sheets: [{ tab: 'X', store_name: name, a1: 'Some other store', items: [], totals: { header_stock: stock, header_net: 0, header_qty: 0, sum_net: 0, sum_qty: 0, kept_net: 0, kept_qty: 0, rows: 0, sheet_week: 2 } }] })
  it('passes when the sheet\'s stock equals the weekly report\'s for that store, whatever A1 says', () => {
    expect(failures(crossDetailed(w, sheet('Artarmon', 1)))).toEqual([])
  })
  it('blocks a sheet whose stock belongs to another store', () => {
    const c = crossDetailed(w, sheet('Artarmon', 9999))
    expect(blocked(c)).toBe(true)
    expect(c[0].detail).toContain('different store')
  })
  it('blocks a sheet for a store the weekly report does not have', () => {
    expect(blocked(crossDetailed(w, sheet('Nowhere', 1)))).toBe(true)
  })
})
