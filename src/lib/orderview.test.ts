import { describe, expect, it } from 'vitest'
import { coverStatus, gpPercent, noStock, shownStock, soldOver } from './orderview'

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
  it('is short when unposted sales have taken stock below zero', () => {
    expect(coverStatus(-1, 0, 2)).toBe('short')
    expect(coverStatus(-1, 10, 0)).toBe('short')
    expect(coverStatus(undefined, undefined, 2)).toBe('short')
  })
  it('for an item that has not sold: covered if anything is held, short if sales not posted emptied it, no colour if plain empty', () => {
    expect(coverStatus(5, 5, 0)).toBe('covered')
    expect(coverStatus(0, 4, 0)).toBe('covered')
    expect(coverStatus(0, 0, 0, 3)).toBe('short')
    expect(coverStatus(0, 0, 0, 0)).toBeNull()
  })
  it('shows stock never below zero, and No stock only for zero with nothing unposted', () => {
    expect(shownStock(-1)).toBe(0)
    expect(shownStock(4)).toBe(4)
    expect(shownStock(undefined)).toBeNull()
    expect(noStock(0, 0)).toBe(true)
    expect(noStock(0, undefined)).toBe(true)
    expect(noStock(0, 2)).toBe(false)
    expect(noStock(-1, 3)).toBe(false)
    expect(noStock(3, 0)).toBe(false)
  })
})
