import { describe, expect, it } from 'vitest'
import { DEMAND, demandOf, suggestLine, type SuggestIn } from './suggest'

const flat = (n: number, v: number) => Array(n).fill(v)
const base = (over: Partial<SuggestIn> = {}): SuggestIn => ({ series: flat(13, 6), storeUnits: flat(13, 1000), inventory: 0, onOrder: 0, transferIn: 0, inOrder: 0, waiting: 0, moq: 1, weeks: 4, ...over })

describe('demand', () => {
  it('a steady seller is its own rate', () => {
    const d = demandOf(flat(13, 6), flat(13, 1000))
    expect(d.rate).toBeCloseTo(6)
    expect(d.trend).toBe(1)
  })
  it('lately counts more than the long view (60 / 40)', () => {
    const series = [...flat(8, 2), ...flat(5, 10)] // 13 weeks: 2 a week, then 10 a week for the last 5
    const d = demandOf(series, flat(13, 1000))
    expect(d.recent).toBe(10)
    expect(d.long).toBeCloseTo((8 * 2 + 5 * 10) / 13, 5)
    expect(d.rate).toBeCloseTo(0.6 * 10 + 0.4 * d.long, 5)
  })
  it('one big week cannot drive the order', () => {
    const spiky = [...flat(12, 1), 60]
    const capped = demandOf(spiky, flat(13, 1000)).rate
    const mean = spiky.reduce((a, b) => a + b, 0) / 13
    expect(capped).toBeLessThan(mean) // 60 is held to 2.5 times the item's average week (13.8), not left at 60
    const ceiling = Math.max(DEMAND.capK * mean, DEMAND.capFloor)
    expect(capped).toBeCloseTo(0.6 * ((4 * 1 + ceiling) / 5) + 0.4 * ((12 + ceiling) / 13), 5)
  })
  it('a store that is slowing down lowers every item, within limits', () => {
    const store = [...flat(9, 1000), ...flat(4, 700)]
    expect(demandOf(flat(13, 6), store).trend).toBeLessThan(1)
    expect(demandOf(flat(13, 6), [...flat(9, 1000), ...flat(4, 10)]).trend).toBe(DEMAND.trendMin)
    expect(demandOf(flat(13, 6), [...flat(9, 100), ...flat(4, 5000)]).trend).toBe(DEMAND.trendMax)
  })
})

describe('a suggested line', () => {
  it('orders what brings stock up to the weeks it should hold, in multiples of the MOQ', () => {
    const s = suggestLine(base({ inventory: 5, onOrder: 3, moq: 6 })) // needs 24, has 8, short 16, so 18
    expect([s.need, s.qty, s.fill, s.hold]).toEqual([16, 18, true, null])
    expect(s.why).toContain('Order 18 (MOQ 6)')
  })
  it('counts what is already in this order, and what customers are waiting for', () => {
    expect(suggestLine(base({ inOrder: 24 })).qty).toBe(0)
    expect(suggestLine(base({ waiting: 5 })).qty).toBe(29) // 24 to hold + 5 for customers
  })
  it('orders nothing when stock already covers it', () => {
    const s = suggestLine(base({ inventory: 100 }))
    expect(s.qty).toBe(0)
    expect(s.why).toContain('Nothing needed')
  })
  it('leaves an oversized MOQ for the person: shown, never filled in', () => {
    const s = suggestLine(base({ series: flat(13, 1), moq: 100 })) // one MOQ lasts ~100 weeks of 1 a week
    expect(s.qty).toBe(100)
    expect([s.fill, s.hold]).toEqual([false, 'moq'])
    expect(s.why).toContain('your call')
  })
  it('a slow seller is suggested only when it is out of stock and has really sold', () => {
    const slow = [...flat(11, 0), 1, 1]
    expect(suggestLine(base({ series: slow, inventory: 0 })).qty).toBe(1)
    expect(suggestLine(base({ series: slow, inventory: 2 })).qty).toBe(0)
    expect(suggestLine(base({ series: flat(13, 0), inventory: 0 })).qty).toBe(0) // never sold
    expect(suggestLine(base({ series: [...flat(12, 0), 1], inventory: 0 })).qty).toBe(0) // once is not a pattern
  })
  it('a customer order for an item that does not sell is still ordered', () => {
    expect(suggestLine(base({ series: flat(13, 0), waiting: 3 })).qty).toBe(3)
  })
  it('never suggests a negative quantity, and shows its working', () => {
    const s = suggestLine(base({ inventory: -4 }))
    expect(s.qty).toBeGreaterThanOrEqual(0)
    expect(s.why).toMatch(/^Sells about 6 a week/)
  })
})
