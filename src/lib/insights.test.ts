import { describe, expect, it } from 'vitest'
import { coverText, perWeekText, ratesFrom, stockInsight } from './insights'

describe('ratesFrom', () => {
  it('averages over the weeks loaded, counting a missing week as nothing sold', () => {
    const r = ratesFrom([
      { item_code: 'A', qty: 6, wk: 202701 }, { item_code: 'A', qty: 2, wk: 202702 },
      { item_code: 'B', qty: 4, wk: 202702 }, { item_code: 'C', qty: 0, wk: 202703 }, { item_code: 'D', qty: 0, wk: 202704 },
    ])
    expect(r.weeks).toBe(4)
    expect(r.perWeek.get('A')).toBe(2)
    expect(r.perWeek.get('B')).toBe(1)
    expect(r.perWeek.get('C')).toBe(0)
  })
  it('ignores negative quantities (refunds) and is empty with no rows', () => {
    expect(ratesFrom([{ item_code: 'A', qty: -3, wk: 1 }, { item_code: 'A', qty: 5, wk: 2 }]).perWeek.get('A')).toBe(2.5)
    expect(ratesFrom([]).weeks).toBe(0)
  })
})

describe('stockInsight', () => {
  it('counts stock, on order and transfers, and suggests up to the target in MOQ steps', () => {
    const s = stockInsight({ inventory: 2, qty_on_po: 1, transfer_in: 1 }, 3, 4, 6) // needs 12, has 4
    expect(s.have).toBe(4)
    expect(s.cover).toBeCloseTo(4 / 3)
    expect(s.low).toBe(true)
    expect(s.suggest).toBe(12) // 8 short, rounded up to two lots of 6
  })
  it('suggests nothing when the target is covered', () => {
    const s = stockInsight({ inventory: 20, qty_on_po: 0 }, 2, 4, 1)
    expect(s.low).toBe(false)
    expect(s.suggest).toBe(0)
  })
  it('an item that does not sell is never low and gets no suggestion', () => {
    const s = stockInsight({ inventory: 0, qty_on_po: 0 }, 0, 4, 1)
    expect(s.cover).toBeNull()
    expect(s.low).toBe(false)
    expect(s.suggest).toBe(0)
  })
  it('counts what is already in the open order, so it is not suggested twice', () => {
    const s = stockInsight({ inventory: 0, qty_on_po: 0 }, 3.5, 4, 6, 12) // needs 14, 12 already ordered
    expect(s.have).toBe(12)
    expect(s.suggest).toBe(6)
    expect(stockInsight({ inventory: 0, qty_on_po: 0 }, 3.5, 4, 6, 18).low).toBe(false)
  })
  it('treats a missing stock record as none on hand and a bad MOQ as 1', () => {
    const s = stockInsight(undefined, 1.5, 2, 0)
    expect(s.have).toBe(0)
    expect(s.suggest).toBe(3)
  })
})

describe('text', () => {
  it('words rates and cover plainly', () => {
    expect(perWeekText(2.5)).toBe('2.5')
    expect(perWeekText(3)).toBe('3')
    expect(perWeekText(12.4)).toBe('12')
    expect(coverText(null)).toBe('not selling')
    expect(coverText(0)).toBe('no stock left')
    expect(coverText(1.25)).toBe('1.3 weeks of stock')
    expect(coverText(60)).toBe('over a year of stock')
  })
})

