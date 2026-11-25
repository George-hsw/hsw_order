import { describe, expect, it } from 'vitest'
import { coverChoices, coverText, lowLabel, lowWhy, ratesFrom, stockInsight } from './insights'

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

describe('ratesFrom history', () => {
  it('works the rate over the latest 13 weeks but keeps the longer history', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ item_code: 'A', qty: i < 7 ? 100 : 2, wk: 202601 + i }))
    const r = ratesFrom(rows)
    expect(r.weeks).toBe(13)
    expect(r.perWeek.get('A')).toBe(2)
    expect(r.series!.get('A')).toHaveLength(13)
    expect(r.history!.get('A')).toHaveLength(20)
    expect(r.history!.get('A')!.slice(-4).reduce((a, b) => a + b, 0)).toBe(8)
  })
})

describe('coverChoices', () => {
  it('runs to 12, then every 2 weeks to the last week loaded, and keeps a saved target', () => {
    expect(coverChoices(0, 4)).toEqual([1, 2, 3, 4, 5, 6, 8, 10, 12])
    expect(coverChoices(17, 4).slice(-3)).toEqual([14, 16, 17])
    expect(coverChoices(26, 4).slice(-4)).toEqual([20, 22, 24, 26])
    expect(coverChoices(13, 20)).toContain(20)
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
    expect(coverText(null)).toBe('not selling')
    expect(coverText(0)).toBe('no stock left')
    expect(coverText(1.25)).toBe('1 week of stock')
    expect(coverText(0.4)).toBe('under 1 week of stock')
    expect(coverText(7.9)).toBe('7 weeks of stock')
    expect(coverText(60)).toBe('over a year of stock')
  })
})


describe('lowWhy', () => {
  it('names the stock, sales, on order and the target, so the flag explains itself', () => {
    const t = lowWhy({ inventory: 2, onOrder: 0, sold: 10, weeks: 13, cover: 2.5, target: 4 })
    expect(t).toBe('In stock 2, sold 10 in the last 13 weeks, on order 0. That lasts 2 weeks, and this store aims to hold 4 weeks.')
    expect(lowLabel(2.5)).toBe('Low, 2 weeks left')
    expect(lowLabel(0.4)).toBe('Low, under 1 week left')
    expect(lowLabel(0)).toBe('Low, out of stock')
  })
})
