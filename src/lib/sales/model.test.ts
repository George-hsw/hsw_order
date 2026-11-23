import { describe, expect, it } from 'vitest'
import { availablePeriods, combineChain, memberPct, priorWeeks, sumDays, chainAvg, change, compact, flagCounts, itemFlag, money2, ordinal, pctText, rangeText, rankText, topBy, weekLabel, weeksOf, type ItemSale, distinct, divisionLabel, topSellers } from './model'

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
  const w = (week: number, qty: number, extra: Partial<ItemWeek> = {}): ItemWeek => ({ fy: 2027, week, qty, net_sales: qty * 10, store_rank: 5, business_rank: 40, group_qty: qty * 2, stores_stocking: 4, potential_loss: 0, ...extra })
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

describe('topSellers', () => {
  const mk = (code: string, qty: number, net: number, vendor: string, division: string) => ({ item_code: code, description: code, vendor_no: vendor, division, qty, net_sales: net, store_rank: 0, group_qty: 0, group_net: 0, stores_stocking: 0, business_rank: 0, potential_sales: 0, potential_loss: 0, inventory: 0, moq: 1 })
  const items = [mk('A', 10, 50, 'V1', 'HOME_DECOR'), mk('B', 2, 200, 'V1', 'KITCHEN'), mk('C', 7, 70, 'V2', 'KITCHEN'), mk('D', 0, 0, 'V2', 'KITCHEN')]
  it('ranks by sales or by units, and leaves out what did not sell', () => {
    expect(topSellers(items, { n: 10, by: 'net_sales', vendor: '', division: '' }).map((i) => i.item_code)).toEqual(['B', 'C', 'A'])
    expect(topSellers(items, { n: 2, by: 'qty', vendor: '', division: '' }).map((i) => i.item_code)).toEqual(['A', 'C'])
  })
  it('narrows to a vendor and a category', () => {
    expect(topSellers(items, { n: 10, by: 'qty', vendor: 'V1', division: '' }).map((i) => i.item_code)).toEqual(['A', 'B'])
    expect(topSellers(items, { n: 10, by: 'qty', vendor: 'V2', division: 'KITCHEN' }).map((i) => i.item_code)).toEqual(['C'])
  })
  it('lists vendors and categories once each, and words a division', () => {
    expect(distinct(items as never, 'vendor_no')).toEqual(['V1', 'V2'])
    expect(divisionLabel('HOME_DECOR')).toBe('Home decor')
  })
})

import { combineLeague, combineWeeks, periodText, resolvePeriod, type StoreWeek, type WeekDates } from './model'

describe('periods', () => {
  const wk = (fy: number, week: number, end: string): WeekDates => ({ fy, week, week_start: end.slice(0, 8) + '01', week_end: end })
  const weeks = [wk(26, 50, '2026-06-28'), wk(27, 1, '2026-07-05'), wk(27, 2, '2026-07-12'), wk(27, 3, '2026-07-19'), wk(27, 4, '2026-07-26'), wk(27, 5, '2026-08-02'), wk(27, 6, '2026-08-09')]
  it('picks the newest weeks, a month, the year to date and the last year', () => {
    const k = (ws: WeekDates[]) => ws.map((w) => w.fy * 100 + w.week)
    expect(k(resolvePeriod('last4', weeks))).toEqual([2703, 2704, 2705, 2706])
    expect(k(resolvePeriod('month', weeks))).toEqual([2706, 2705].reverse()) // newest ends in August: weeks 5 and 6
    expect(k(resolvePeriod('lastmonth', weeks))).toEqual([2701, 2702, 2703, 2704])
    expect(k(resolvePeriod('fytd', weeks))).toEqual([2701, 2702, 2703, 2704, 2705, 2706])
    expect(k(resolvePeriod('lastfy', weeks))).toEqual([2650])
    expect(k(resolvePeriod('custom', weeks, { from: 2704, to: 2702 }))).toEqual([2702, 2703, 2704])
    expect(k(resolvePeriod('week', weeks, { one: { fy: 27, week: 2 } }))).toEqual([2702])
    expect(resolvePeriod('last4', [])).toEqual([])
  })
  it('words a period', () => {
    expect(periodText(resolvePeriod('custom', weeks, { from: 2702, to: 2704 }))).toContain('FY27 weeks 2 to 4')
    expect(periodText([])).toBe('no weeks')
  })
  const sw = (week: number, ty: number, ly: number, trans: number, gp: number, basket: number, name = 'A'): StoreWeek => ({ fy: 27, week, store_id: 's', store_name: name, co_fran: 'Company', state: 'NSW', region: '', centre_type: '', retail_sqm: 100, ty_sales: ty, ly_sales: ly, ty_trans: trans, ly_trans: trans, member_sales: ty / 2, member_trans: 0, stock: week, sys_sales: 0, gp_ty: gp, gp_ly: gp, qty_sold: 0, basket, l4l_adjust: 0 })
  it('adds weeks, weighting margin by sales and items per sale by sales made', () => {
    const c = combineWeeks([sw(1, 100, 80, 10, 0.5, 2), sw(2, 300, 120, 30, 0.3, 4)])!
    expect(c.ty_sales).toBe(400)
    expect(c.ly_sales).toBe(200)
    expect(c.gp_ty).toBeCloseTo(0.35)
    expect(c.basket).toBeCloseTo(3.5)
    expect(c.stock).toBe(2) // the latest week's
    expect(combineWeeks([])).toBeNull()
  })
  it('adds each store across weeks', () => {
    const r = combineLeague([[sw(1, 100, 0, 1, 0, 0, 'A'), sw(1, 50, 0, 1, 0, 0, 'B')], [sw(2, 10, 0, 1, 0, 0, 'A')]])
    expect(r.find((x) => x.store_name === 'A')!.ty_sales).toBe(110)
    expect(r).toHaveLength(2)
  })
})

describe('periods and totals', () => {
  const wk = (fy: number, week: number, end: string) => ({ fy, week, week_start: end, week_end: end })
  const weeks = [wk(2026, 52, '2026-06-28'), wk(2027, 1, '2026-07-05'), wk(2027, 2, '2026-07-12'), wk(2027, 3, '2026-07-19'), wk(2027, 4, '2026-07-26'), wk(2027, 5, '2026-08-02')]
  it('only offers periods that have weeks, and are what their name says', () => {
    const k = availablePeriods(weeks)
    expect(k).toContain('week'); expect(k).toContain('last4'); expect(k).toContain('fytd'); expect(k).toContain('custom'); expect(k).toContain('lastfy')
    expect(k).not.toContain('last13') // only six weeks loaded
    expect(availablePeriods(weeks.filter((w) => w.fy === 2027))).not.toContain('lastfy') // nothing loaded from last year
    expect(availablePeriods([weeks[0]])).toEqual(['week', 'month', 'fytd'])
    expect(availablePeriods([])).toEqual([])
  })
  it('finds the weeks straight before a period, or none', () => {
    expect(priorWeeks(weeks, weeks.slice(3, 5)).map((w) => w.week)).toEqual([1, 2])
    expect(priorWeeks(weeks, weeks.slice(1, 3))).toEqual([weeks[0]].slice(0, 0)) // only one week before, two needed
    expect(priorWeeks(weeks, [])).toEqual([])
  })
  it('adds days across weeks', () => {
    const d = (weekday: number, ty: number, ly: number) => ({ fy: 2027, week: 1, store_id: 's', weekday, ty, ly })
    expect(sumDays([[d(1, 10, 5), d(2, 20, 5)], [d(1, 30, 5), d(3, 1, 1)]])).toEqual([{ weekday: 1, ty: 40, ly: 10 }, { weekday: 2, ty: 20, ly: 5 }, { weekday: 3, ty: 1, ly: 1 }])
  })
  it('combines the chain only when every week has it, margin weighted by sales', () => {
    const c = (ty: number, gp: number) => ({ stores: 40, ty_sales: ty, ly_sales: ty, avg_store_sales: ty / 40, avg_gp: gp, avg_basket: 2 })
    const both = combineChain([c(400, 0.4), c(1200, 0.6)])!
    expect(both.avg_store_sales).toBeCloseTo(40)
    expect(both.avg_gp).toBeCloseTo((400 * 0.4 + 1200 * 0.6) / 1600)
    expect(combineChain([c(400, 0.4), null])).toBeNull()
    expect(combineChain([])).toBeNull()
  })
  it('member shares always add up to 100', () => {
    const w = (m: number, t: number) => ({ member_sales: m, ty_sales: t }) as never
    expect(memberPct(w(335, 1000))).toEqual([34, 66]) // each rounded alone would give 34 and 67
    expect(memberPct(w(2000, 1000))).toEqual([100, 0]) // more member sales than sales is clamped, never negative
    expect(memberPct(w(0, 0))).toEqual([0, 0])
  })
  it('a change too small to show has no sign', () => {
    expect(pctText(-0.00001)).toBe('0.0%')
    expect(pctText(0.00004)).toBe('0.0%')
  })
})
