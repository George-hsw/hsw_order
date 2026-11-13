import { describe, expect, it } from 'vitest'
import { AREAS, areaOf, isAreaId, visibleAreas, visibleTabs, type Tab } from './sections'

describe('sections', () => {
  it('every tab belongs to exactly one area', () => {
    const all = AREAS.flatMap((a) => a.tabs.map((t) => t.tab))
    expect(new Set(all).size).toBe(all.length)
  })
  it('finds the area of a tab', () => {
    const cases: [Tab, string][] = [['new', 'quote'], ['docs', 'quote'], ['order', 'order'], ['price', 'price'], ['tansel', 'quote'], ['orders', 'order'], ['sales', 'sales'], ['analytics', 'admin'], ['stores', 'admin']]
    for (const [tab, area] of cases) expect(areaOf(tab).id).toBe(area)
  })
  it('only the admin sees the Admin area', () => {
    expect(visibleAreas(false).map((a) => a.id)).toEqual(['quote', 'order', 'stocktake', 'price', 'sales'])
    expect(visibleAreas(true).map((a) => a.id)).toEqual(['quote', 'order', 'stocktake', 'price', 'sales', 'admin'])
    expect(visibleAreas(false, false).map((a) => a.id)).toEqual(['sales']) // a manager with no store of their own
  })
  it('Reports needs someone who works in a store', () => {
    const quote = AREAS[0]
    expect(visibleTabs(quote, true).map((t) => t.tab)).toEqual(['new', 'docs', 'reports', 'tansel'])
    expect(visibleTabs(quote, false).map((t) => t.tab)).toEqual(['new', 'docs', 'tansel'])
  })
  it('recognises an area id', () => {
    expect(isAreaId('sales')).toBe(true)
    expect(isAreaId('nope')).toBe(false)
    expect(isAreaId(null)).toBe(false)
  })
})
