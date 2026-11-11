import { describe, expect, it } from 'vitest'
import { coverStatus, gpPercent, soldOver } from './orderview'

describe('gross profit', () => {
  it('is worked on the price before GST', () => {
    expect(gpPercent(110, 50)).toBe(50) // 110 incl GST is 100 ex, cost 50
    expect(gpPercent(54.95, 30)).toBe(39.9)
  })
  it('is null when the price or the cost is missing, and can be negative', () => {
    expect(gpPercent(null, 10)).toBeNull()
    expect(gpPercent(0, 10)).toBeNull()
    expect(gpPercent(110, 0)).toBeNull()
    expect(gpPercent(110, 120)).toBe(-20)
  })
})

describe('sales windows', () => {
  it('adds the last N weeks of a series that is oldest first', () => {
    expect(soldOver([1, 2, 3, 4, 5], 2)).toBe(9)
    expect(soldOver([1, 2], 12)).toBe(3)
    expect(soldOver(undefined, 4)).toBe(0)
    expect(soldOver([5, -2, 1], 3)).toBe(6) // a return does not take units off
  })
})

describe('stock colour', () => {
  it('is red when stock plus on order is under the units sold, yellow when equal, green when over', () => {
    expect(coverStatus(3, 2, 10)).toBe('short')
    expect(coverStatus(6, 4, 10)).toBe('even')
    expect(coverStatus(8, 4, 10)).toBe('covered')
  })
  it('has no colour for an item that has not sold, and ignores negative stock', () => {
    expect(coverStatus(5, 5, 0)).toBeNull()
    expect(coverStatus(-3, 0, 2)).toBe('short')
    expect(coverStatus(undefined, undefined, 2)).toBe('short')
  })
})
