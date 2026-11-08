import { describe, expect, it } from 'vitest'
import { chainAvg, change, compact, flagCounts, itemFlag, money2, ordinal, pctText, rangeText, rankText, topBy, weekLabel, weeksOf, type ItemSale } from './model'

const item = (over: Partial<ItemSale>): ItemSale => ({
  item_code: 'A', description: 'a', vendor_no: 'V', division: null, qty: 0, net_sales: 0, store_rank: 0, group_qty: 0, group_net: 0, stores_stocking: 0,
  business_rank: 0, potential_sales: 0, potential_loss: 0, inventory: 0, moq: 1, ...over,
})

describe('numbers and wording', () => {
  it('works out the change on last year', () => {
    expect(change(105, 100)).toBeCloseTo(0.05)
    expect(change(50, 100)).toBeCloseTo(-0.5)
    expect(change(10, 0)).toBeNull()
  })
  it('writes percentages, money and compact numbers', () => {
    expect(pctText(0.052)).toBe('+5.2%')
    expect(pctText(-0.0606)).toBe('−6.1%')
    expect(pctText(0)).toBe('0.0%')
    expect(pctText(null)).toBe('no comparison')
    expect(money2(31562.64)).toBe('$31,562.64')
    expect(money2(243.68)).toBe('$243.68')
    expect(money2(12)).toBe('$12.00')
    expect(money2(-5.4)).toBe('−$5.40')
    expect(compact(950)).toBe('950')
    expect(compact(12900)).toBe('13K')
    expect(compact(1250)).toBe('1.3K')
    expect(compact(1250000)).toBe('1.3M')
  })
  it('writes ordinals and ranks', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th'])
    expect(rankText({ metric: 'sales', rank: 6, of: 24 })).toBe('6th of 24')
  })
  it('labels weeks and date ranges', () => {
    expect(weekLabel({ fy: 2027, week: 10 })).toBe('FY27 week 10')
    expect(rangeText('2026-08-31', '2026-09-06')).toBe('31 Aug to 6 Sep')
  })
})

describe('item flags', () => {
  it('flags an item with no stock that sells, or whose sales were lost', () => {
    expect(itemFlag(item({ inventory: 0, qty: 3 }))).toBe('out')
    expect(itemFlag(item({ inventory: -2, potential_loss: 60 }))).toBe('out')
    expect(itemFlag(item({ inventory: 0, group_qty: 10, stores_stocking: 5 }))).toBe('out')
  })
  it('does not flag an item with no stock that nobody sells', () => {
    expect(itemFlag(item({ inventory: 0 }))).toBe('ok')
  })
  it('flags stock that is not selling while the chain sells it', () => {
    expect(itemFlag(item({ inventory: 6, qty: 0, group_qty: 12, stores_stocking: 10 }))).toBe('not_selling')
    expect(itemFlag(item({ inventory: 6, qty: 0, group_qty: 0 }))).toBe('ok')
  })
  it('compares sales with the average store that stocks the item', () => {
    const base = { inventory: 5, group_qty: 20, stores_stocking: 10 } // chain average 2
    expect(chainAvg(item(base))).toBe(2)
    expect(itemFlag(item({ ...base, qty: 1 }))).toBe('below')
    expect(itemFlag(item({ ...base, qty: 5 }))).toBe('above')
    expect(itemFlag(item({ ...base, qty: 2 }))).toBe('ok')
  })
  it('counts the flags', () => {
    const c = flagCounts([item({ inventory: 0, qty: 1 }), item({ inventory: 0, qty: 2 }), item({ inventory: 5, qty: 0, group_qty: 4, stores_stocking: 2 }), item({})])
    expect(c).toEqual({ out: 2, not_selling: 1, below: 0, above: 0, ok: 1 })
  })
  it('lists the biggest values, ignoring zeros', () => {
    const items = [item({ item_code: 'A', qty: 3 }), item({ item_code: 'B', qty: 9 }), item({ item_code: 'C', qty: 0 }), item({ item_code: 'D', qty: 9 })]
    expect(topBy(items, 'qty', 2).map((i) => i.item_code)).toEqual(['B', 'D'])
    expect(topBy(items, 'qty', 10)).toHaveLength(3)
  })
})

describe('weeks', () => {
  it('lists distinct weeks, newest first', () => {
    expect(weeksOf([{ fy: 2027, week: 9 }, { fy: 2027, week: 10 }, { fy: 2027, week: 9 }, { fy: 2026, week: 52 }])).toEqual([{ fy: 2027, week: 10 }, { fy: 2027, week: 9 }, { fy: 2026, week: 52 }])
  })
})

import { itemTrend, type ItemWeek } from './model'
describe('one item over the weeks', () => {
  const w = (week: number, qty: number, extra: Partial<ItemWeek> = {}): ItemWeek => ({ fy: 2027, week, qty, net_sales: qty * 10, store_rank: 5, group_qty: qty * 2, stores_stocking: 4, potential_loss: 0, ...extra })
  it('sorts the weeks, totals them and sets the average store beside each', () => {
    const t = itemTrend([w(3, 6), w(1, 2), w(2, 4)])
    expect(t.weeks.map((x) => x.week)).toEqual([1, 2, 3])
    expect(t.total_qty).toBe(12)
    expect(t.total_sales).toBe(120)
    expect(t.weeks[0].chain_avg).toBe(1) // 4 units across 4 stores
    expect(t.last?.week).toBe(3)
    expect(t.best?.qty).toBe(6)
  })
  it('works out growth over the last four weeks against the four before, and week on week', () => {
    const t = itemTrend([1, 1, 1, 1, 2, 2, 2, 3].map((q, i) => w(i + 1, q)))
    expect(t.growth4).toBeCloseTo(1.25) // 2+2+2+3 = 9 units against 4
    expect(t.growth1).toBeCloseTo(0.5) // 3 against 2
  })
  it('says nothing when there is nothing to compare with', () => {
    const t = itemTrend([w(1, 5)])
    expect(t.growth4).toBeNull()
    expect(t.growth1).toBeNull()
    expect(itemTrend([]).last).toBeNull()
  })
})
