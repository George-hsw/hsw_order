import { describe, expect, it } from 'vitest'
import { addCounts, adjustValue, byImpact, countTotals, fmtDiff, lastCounted, navAdjustText, onHand, sidesToPost, splitAdjustments, stillToCount, variance, verdict } from './stocktake'
import type { CountLine, CountRow, ItemRow, StockRow } from './supabase'
import type { Product } from './order'

const line = (code: string, counted: number, system_qty: number, unit_cost = 10, extra: Partial<CountLine> = {}): CountLine => ({
  id: code, count_id: 'c1', item_code: code, counted, system_qty, unit_cost, description: 'Item ' + code, division: null, category: null,
  vendor_no: null, vendor_item_no: null, uom: 'EACH', revision: 1, updated_by: null, updated_at: '', ...extra,
})

describe('variance and verdict', () => {
  it('is counted minus system', () => {
    expect(variance(line('A', 9, 12))).toBe(-3)
    expect(variance(line('A', 14, 12))).toBe(2)
    expect(variance(line('A', 6, 6))).toBe(0)
  })
  it('copes with a fractional system quantity', () => {
    expect(variance(line('A', 6, 6.5))).toBe(-0.5)
    expect(variance(line('A', 3, 2.9))).toBe(0.1)
  })
  it('says what the system said and how far off the count is', () => {
    expect(verdict(9, 12)).toEqual({ kind: 'short', text: 'The system says 12. You counted 9, which is 3 fewer.' })
    expect(verdict(14, 12).kind).toBe('over')
    expect(verdict(6, 6).kind).toBe('match')
  })
  it('shows a real minus sign', () => {
    expect(fmtDiff(-3)).toBe('−3')
    expect(fmtDiff(2)).toBe('+2')
    expect(fmtDiff(0)).toBe('0')
  })
})

describe('splitting a count into the two NAV journals', () => {
  const lines = [line('B2', 9, 12), line('A1', 5, 2), line('C3', 4, 4), line('D4', 0, 7), line('E5', 3, 1)]
  it('sends gains to positive, losses to negative and leaves matches out', () => {
    const s = splitAdjustments(lines)
    expect(s.positive.map((l) => l.item_code)).toEqual(['A1', 'E5'])
    expect(s.negative.map((l) => l.item_code)).toEqual(['B2', 'D4'])
    expect(s.matched.map((l) => l.item_code)).toEqual(['C3'])
  })
  it('totals units and dollars for each side without drifting', () => {
    const t = countTotals([line('A', 5, 2, 0.1), line('B', 0, 7, 3.33), line('C', 4, 4)])
    expect(t).toMatchObject({ counted: 3, matched: 1, differ: 2, gainUnits: 3, lossUnits: 7, gainValue: 0.3, lossValue: 23.31 })
  })
  it('values a difference at store cost, always positive', () => {
    expect(adjustValue(line('A', 9, 12, 2.5))).toBe(7.5)
    expect(adjustValue(line('A', 14, 12, 2.5))).toBe(5)
  })
  it('puts the biggest dollar differences first in the review', () => {
    expect(byImpact([line('A', 5, 4, 1), line('B', 0, 3, 50), line('C', 9, 9), line('D', 1, 5, 2)]).map((l) => l.item_code)).toEqual(['B', 'D', 'A', 'C'])
  })
})

describe('copy for NAV', () => {
  const lines = [line('0042', 9, 12, 10, { uom: 'EACH', description: 'Tab\there' }), line('A1', 5, 2), line('C3', 4, 4)]
  const when = new Date(2026, 10, 13)
  it('writes tab-separated item journal lines for one side only, quantity as a positive size', () => {
    const neg = navAdjustText(lines, 'negative', 'ART', when)
    expect(neg).toBe('13/11/2026\tNegative Adjmt.\t\t0042\tTab here\tART\t3\tEACH')
    expect(navAdjustText(lines, 'positive', 'ART', when)).toBe('13/11/2026\tPositive Adjmt.\t\tA1\tItem A1\tART\t3\tEACH')
  })
  it('can include a header row, and is empty when a side has nothing', () => {
    expect(navAdjustText(lines, 'positive', 'ART', when, true).split('\n')[0]).toContain('Posting Date\tEntry Type')
    expect(navAdjustText([line('C3', 4, 4)], 'negative', 'ART', when)).toBe('')
  })
  it('lists only the sides still to be entered in NAV', () => {
    const split = splitAdjustments(lines)
    expect(sidesToPost({ nav_pos_ref: null, nav_neg_ref: null }, split)).toEqual(['positive', 'negative'])
    expect(sidesToPost({ nav_pos_ref: 'IJ-1', nav_neg_ref: null }, split)).toEqual(['negative'])
    expect(sidesToPost({ nav_pos_ref: 'IJ-1', nav_neg_ref: 'IJ-2' }, split)).toEqual([])
  })
})

describe('counting', () => {
  it('adds a second count of the same item to the first', () => {
    expect(addCounts(6, 4)).toBe(10)
    expect(addCounts(undefined, 4)).toBe(4)
  })

  const item = (code: string): ItemRow => ({ code, description: code, vendor_no: null, vendor_item_no: null, barcode: null, division: null, category: null, status: 'ACTIVE', price: 1, sales_uom: null, base_uom: null, blocked: false, exclude_from_replen: false })
  const prod = (code: string, inv?: number): Product => ({ item: item(code), stock: inv === undefined ? undefined : ({ inventory: inv } as StockRow) })
  it('lists what is still to count, items holding stock first', () => {
    const left = stillToCount([prod('A', 0), prod('B', 5), prod('C', 9), prod('D')], [line('C', 9, 9)])
    expect(left.map((p) => p.item.code)).toEqual(['B', 'A', 'D'])
  })

  it('lists only items with stock on the system, negatives included, and none without a stock record', () => {
    const listed = onHand([prod('A', 0), prod('B', 5), prod('C', -2), prod('D'), prod('E', 0.5)])
    expect(listed.map((p) => p.item.code)).toEqual(['B', 'C', 'E'])
  })

  const count = (id: string, scope_value: string, status: CountRow['status'], saved_at: string | null): CountRow => ({
    id, store_id: 's', kind: 'rolling', name: '', scope_type: 'vendor', scope_value, status, nav_pos_ref: null, nav_neg_ref: null, created_by: null,
    created_at: '2026-01-01', saved_at, posted_at: null,
  })
  it('finds when a vendor was last counted, ignoring counts still open', () => {
    const counts = [count('1', 'ANAS001', 'saved', '2026-03-01'), count('2', 'ANAS001', 'posted', '2026-09-01'), count('3', 'ANAS001', 'open', null), count('4', 'MYHO001', 'saved', '2026-05-05')]
    expect(lastCounted(counts, 'vendor', 'ANAS001')).toBe('2026-09-01')
    expect(lastCounted(counts, 'vendor', 'NOPE')).toBeNull()
  })
})
