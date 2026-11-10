import { describe, expect, it } from 'vitest'
import { resultsCsv, sameTotals, type WeekState } from './bulk'
import { planFolder } from './folder'
import { storeKey } from './parse'
import { crossDetailed, blocked, failures } from './validate'

const f = (name: string, lastModified = 1) => ({ name, lastModified })

describe('store names', () => {
  it('"(Company)" and plain names are the same store, as are Mt and Mount', () => {
    expect(storeKey('Artarmon (Company)')).toBe(storeKey('Artarmon'))
    expect(storeKey('Mt. Gravatt (Company)')).toBe(storeKey('Mount Gravatt'))
    expect(storeKey('Moore Park')).not.toBe(storeKey('Moore Park (Franchise) East'))
  })
})

describe('a store with sales but no item sheet', () => {
  const weekly = { current: { fy: 2027, week: 1 }, rows: [{ week: 1, store_name: 'Cambridge (Company)', co_fran: 'Company', ty_sales: 100, stock: 5 }, { week: 1, store_name: 'Artarmon (Company)', co_fran: 'Company', ty_sales: 10, stock: 1 }] } as never
  const sheet = { week: { fy: 2027, week: 1 }, warnings: [], format: [], sheets: [{ tab: 'ARTA', store_name: 'Artarmon', a1: '', items: [], totals: { header_stock: 1, sum_net: 5 } }] } as never
  it('is shown, and does not stop the stores that are there', () => {
    const c = crossDetailed(weekly, sheet)
    const missing = failures(c).filter((x) => x.label.includes('items missing'))
    expect(missing).toHaveLength(1)
    expect(missing[0].detail).toContain('Cambridge')
    expect(blocked(c)).toBe(false)
  })
})

describe('planning a folder', () => {
  const plan = planFolder([
    f('Australian Weekly Sales_FY2027-Week 01.xlsx'), f('Australian Weekly Sales_FY2027-Week 01 (1).xlsx', 5), f('Australian Weekly Sales_FY2027-Week 04.xlsx'),
    f('Detailed Sales Report_FY2027_Week01_ValueOnly.xlsx'), f('Detailed Sales Report_FY2027_Week04_ValueOnly.xlsx'),
    f('~$Detailed Sales Report_FY2027_Week02_ValueOnly.xlsx'), f('notes.xlsx'), f('Detailed Sales Report_ValueOnly.xlsx'), f('readme.txt'),
  ])
  it('lists each week once, with the weeks inside the newest weekly report that have no file of their own', () => {
    expect(plan.weeks.map((w) => [w.week, w.covered])).toEqual([[1, false], [2, true], [3, true], [4, false]])
  })
  it('imports only the newest weekly report of the year, because it holds every week up to there', () => {
    expect(plan.latestWeekly.get(2027)?.name).toBe('Australian Weekly Sales_FY2027-Week 04.xlsx')
  })
  it('keeps the newer of two copies and says which one it left out', () => {
    const w1 = plan.weeks[0]
    expect(w1.files.weekly?.name).toBe('Australian Weekly Sales_FY2027-Week 01 (1).xlsx')
    expect(w1.ignored).toEqual(['Australian Weekly Sales_FY2027-Week 01.xlsx'])
  })
  it('names the files it cannot place, and skips office temp files', () => {
    expect(plan.unknown.map((u) => u.name)).toEqual(['notes.xlsx', 'Detailed Sales Report_ValueOnly.xlsx'])
  })
})

describe('comparing the saved figures with the file', () => {
  it('equal rows and totals to the cent match; one cent or one row off does not', () => {
    expect(sameTotals({ rows: 3, a: 10.1, b: 2 }, { rows: 3, a: 10.1, b: 2 })).toBe(true)
    expect(sameTotals({ rows: 3, a: 0.1 + 0.2, b: 2 }, { rows: 3, a: 0.3, b: 2 })).toBe(true) // floating point noise is not a difference
    expect(sameTotals({ rows: 3, a: 10.1, b: 2 }, { rows: 3, a: 10.11, b: 2 })).toBe(false)
    expect(sameTotals({ rows: 3, a: 10.1, b: 2 }, { rows: 2, a: 10.1, b: 2 })).toBe(false)
  })
  it('the CSV has one line per report with both sides and the verdict', () => {
    const state = [{ fy: 2027, week: 1, weekly: { status: 'loaded', file: 'a, b.xlsx', source: { rows: 2, a: 1.5, b: 2 }, saved: { rows: 2, a: 1.5, b: 2 }, verified: true }, daily: { status: 'none' }, detailed: { status: 'blocked', why: ['x'] } }] as WeekState[]
    const lines = resultsCsv(state).split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('"a, b.xlsx"')
    expect(lines[1]).toContain(',yes,')
    expect(lines[2]).toContain('blocked')
  })
})

describe('item sales cannot exceed the store\'s whole week', () => {
  const weekly = { current: { fy: 2027, week: 1 }, rows: [{ week: 1, store_name: 'Robina', co_fran: 'Company', ty_sales: 100, stock: 5 }] } as never
  const sheet = (net: number) => ({ week: { fy: 2027, week: 1 }, warnings: [], format: [], sheets: [{ tab: 'ROBI', store_name: 'Robina', a1: '', items: [], totals: { header_stock: 5, sum_net: net } }] } as never)
  it('passes at the usual 71% to 90%, and blocks a sheet that is bigger than the whole week', () => {
    expect(blocked(crossDetailed(weekly, sheet(80)))).toBe(false)
    const c = crossDetailed(weekly, sheet(487))
    expect(blocked(c)).toBe(true)
    expect(failures(c)[0].detail).toContain('another week or another store')
  })
})
