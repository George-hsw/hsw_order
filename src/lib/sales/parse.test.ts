import { describe, expect, it } from 'vitest'
import { makeXlsx } from '../testXlsx'
import { fyOf, kindOf, parseDaily, parseDetailed, parseWeekly, storeKey, toStoreDays } from './parse'

describe('file names', () => {
  it('tells the reports apart and finds the year', () => {
    expect(kindOf('Detailed Sales Report_FY2027_Week10_ValueOnly.xlsx')).toBe('detailed')
    expect(kindOf('Australian Weekly Sales_FY2027-Week 10.xlsx')).toBe('weekly')
    expect(kindOf('Daily Sales_FY2027-Week10.xlsx')).toBe('daily')
    expect(kindOf('notes.xlsx')).toBeNull()
    expect(fyOf('Daily Sales_FY2027-Week10.xlsx')).toBe(2027)
    expect(fyOf('x_FY27.xlsx')).toBe(2027)
  })
  it('matches store names loosely', () => {
    expect(storeKey('Mt. Gravatt')).toBe(storeKey('Mount Gravatt'))
    expect(storeKey('Mt Gravatt')).toBe(storeKey('Mt. Gravatt'))
  })
})

const HEAD = ['No.', 'Order QTY', 'Store PO Qty', 'Item Description', 'MOQ', 'Item Vendor No.', 'Business Rank', 'Item Division Code', 'Item Category', 'Item Status Code',
  'Item Store Cost Ex GST', 'Item RRP Ex GST', 'Store Margin', 'Inventory', '13W Qty Sold', 'Inventory Cost', 'COGS', 'Net Sales', 'QTY Sold', 'Ranking', 'COGS', 'Net Sales', 'QTY Sold',
  'Store Rank YTD', 'Net Sales', 'QTY Sold', 'No Stores Stocking', 'Potential Sales', 'Potential Sales Growth', 'Potential Ranking', 'Potential Loss']
const item = (code: string, o: { net?: number; qty?: number; rank?: number; gnet?: number; gqty?: number; n?: number; loss?: number }) => {
  const r: (string | number)[] = new Array(31).fill(0)
  r[0] = code; r[3] = code + ' thing'; r[4] = '6'; r[5] = 'V1'; r[6] = 100; r[7] = 'BATH'
  r[17] = o.net ?? 0; r[18] = o.qty ?? 0; r[19] = o.rank ?? 0; r[24] = o.gnet ?? 0; r[25] = o.gqty ?? 0; r[26] = o.n ?? 0; r[30] = o.loss ?? 0
  return r
}
const detailedBook = () => makeXlsx([
  { name: 'ARTA', rows: [['Artarmon', 'Week10'], [], [], HEAD, item('A1', { net: 50, qty: 3, rank: 4, gqty: 60, n: 20 }), item('A2', {}), item('A3', { loss: 12 })] },
  { name: 'CAMB', rows: [['Bundall', 'Week10'], [], [], HEAD, item('C1', { qty: 1, net: 9, rank: 2 })] },
  { name: 'GLEN', rows: [['Glen', 'Week10'], [], [], HEAD, item('G1', { qty: 1 })] },
  { name: 'APL ITEMS', hidden: true, rows: [['x']] },
])

describe('detailed sales', () => {
  const r = parseDetailed(detailedBook(), 'Detailed Sales Report_FY2027_Week10_ValueOnly.xlsx')
  it('reads the week from the file and keeps only items that sold, ranked or lost sales', () => {
    expect(r.week).toEqual({ fy: 2027, week: 10 })
    const arta = r.sheets.find((s) => s.tab === 'ARTA')!
    expect(arta.store_name).toBe('Artarmon')
    expect(arta.items.map((i) => i.item_code)).toEqual(['A1', 'A3'])
    expect(arta.items[0]).toMatchObject({ qty: 3, net_sales: 50, store_rank: 4, group_qty: 60, stores_stocking: 20, moq: 6, vendor_no: 'V1' })
  })
  it('warns about unknown sheets and a store name that disagrees with the tab', () => {
    expect(r.sheets.map((s) => s.tab)).toEqual(['ARTA', 'CAMB'])
    expect(r.warnings.some((w) => w.includes('GLEN'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('CAMB') && w.includes('Bundall'))).toBe(true)
    expect(r.sheets.find((s) => s.tab === 'CAMB')!.store_name).toBe('Cambridge')
  })
  it('needs a year in the file name', () => {
    expect(() => parseDetailed(detailedBook(), 'detailed sales.xlsx')).toThrow(/financial year/)
  })
})

describe('weekly database', () => {
  const H = ['Store', 'RM', 'Co/Fran', 'State', 'Data', 'Retail SQM', 'Centre Type', 'Week No', 'L4L Adjust', 'TY Sales', 'LY Sales', 'No. of transactions', 'No. of transactions LY',
    'Member Sales', 'Member Trans', 'Stock', 'SYS', 'GP Wk', 'GP Wk LY', 'Qty Sold', 'Basket Size', 'Comment']
  const row = (store: string, wk: number, ty: number, ly: number) => [store, 'NSW', 'Company', 'NSW', 'LS', 400, 'Homemaker', wk, 0, ty, ly, 100, 90, 500, 40, 9000, 300, 0.45, 0.46, 200, 2.5]
  const book = makeXlsx([
    { name: 'Summary-Wk', rows: [['Current Week Report', '', 'Week beg', 46264, '', '', 'Week No.', 10]] },
    { name: 'Database', rows: [[], ['x'], H, row('Artarmon', 9, 1000, 900), row('Artarmon', 10, 1200, 1000), row('Bondi', 10, 2000, 1500)] },
  ])
  const r = parseWeekly(book, 'Australian Weekly Sales_FY2027-Week 10.xlsx')
  it('reads every week and store, this year beside last', () => {
    expect(r.rows).toHaveLength(3)
    expect(r.rows[1]).toMatchObject({ fy: 2027, week: 10, store_name: 'Artarmon', ty_sales: 1200, ly_sales: 1000, ty_trans: 100, member_sales: 500, gp_ty: 0.45, basket: 2.5 })
    expect(r.current).toEqual({ fy: 2027, week: 10 })
  })
  it('works out each week\'s Monday to Sunday from the current week', () => {
    expect(r.weeks).toEqual([
      { fy: 2027, week: 9, week_start: '2026-08-24', week_end: '2026-08-30' },
      { fy: 2027, week: 10, week_start: '2026-08-31', week_end: '2026-09-06' },
    ])
  })
})

describe('daily sales', () => {
  const book = makeXlsx([
    { name: 'Daily Sales Report_Value', rows: [
      [undefined, 'Daily Sales Report'],
      [undefined, undefined, '2025-26', undefined, undefined, undefined, undefined, undefined, undefined, undefined, '2026-27'],
      [undefined, undefined, '01/09/25', 45902, 45903, 45904, 45905, 45906, 45907, '2025-26 Week 10', '31/08/2026', 46266, 46267, 46268, 46269, 46270, 46271, '2026-27 Week 10'],
    ] },
    { name: 'FY27', hidden: true, rows: [[], [undefined, 'Location', 'Store Name', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Total'],
      [undefined, 12064, 'Artarmon', 1, 2, 3, 4, 5, 6, 7, 28], [undefined, '4217F', 'Bundall', 10, 10, 10, 10, 10, 10, 10, 70]] },
    { name: 'FY26', hidden: true, rows: [[], [], [undefined, 'Location', 'Store Name', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Total'],
      [undefined, 12064, 'Artarmon', 7, 6, 5, 4, 3, 2, 1, 28]] },
  ])
  const r = parseDaily(book, 'Daily Sales_FY2027-Week10.xlsx')
  it('reads the week, its dates and each store\'s days beside last year\'s', () => {
    expect(r.dates).toEqual({ fy: 2027, week: 10, week_start: '2026-08-31', week_end: '2026-09-06' })
    expect(r.days).toHaveLength(14)
    expect(r.days[0]).toEqual({ location: '12064', store_name: 'Artarmon', weekday: 1, ty: 1, ly: 7 })
    expect(r.days[13]).toMatchObject({ location: '4217F', weekday: 7, ty: 10, ly: 0 })
    expect(r.warnings.some((w) => w.includes('Bundall'))).toBe(true)
  })
  it('matches locations to stores and reports the rest', () => {
    const out = toStoreDays(r.week, r.days, (l) => (l === '12064' ? 'id-1' : undefined))
    expect(out.rows).toHaveLength(7)
    expect(out.unmatched).toEqual(['Bundall'])
  })
})
