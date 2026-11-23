import { describe, expect, it } from 'vitest'
import { AREAS, areaOf, areaText, isAreaId, visibleAreas, visibleTabs, type Tab } from './sections'

describe('sections', () => {
  it('every tab belongs to exactly one area', () => {
    const all = AREAS.flatMap((a) => a.tabs.map((t) => t.tab))
    expect(new Set(all).size).toBe(all.length)
  })
  it('finds the area of a tab', () => {
    const cases: [Tab, string][] = [['new', 'quote'], ['docs', 'quote'], ['order', 'order'], ['price', 'price'], ['tansel', 'quote'], ['orders', 'order'], ['sales', 'sales'], ['analytics', 'admin'], ['stores', 'admin'], ['closures', 'transfer'], ['transfers', 'transfer']]
    for (const [tab, area] of cases) expect(areaOf(tab).id).toBe(area)
  })
  it('only the admin sees the Admin area', () => {
    expect(visibleAreas(false).map((a) => a.id)).toEqual(['quote', 'order', 'transfer', 'stocktake', 'price', 'sales'])
    expect(visibleAreas(true).map((a) => a.id)).toEqual(['quote', 'order', 'transfer', 'stocktake', 'price', 'sales', 'admin'])
    expect(visibleAreas(false, false).map((a) => a.id)).toEqual(['sales']) // a manager with no store of their own
    expect(visibleAreas(false, false, true).map((a) => a.id)).toEqual(['transfer', 'sales']) // operations with no store of their own gets Transfer
  })
  it('Reports needs someone who works in a store', () => {
    const quote = AREAS[0]
    expect(visibleTabs(quote, true).map((t) => t.tab)).toEqual(['new', 'docs', 'reports', 'tansel'])
    expect(visibleTabs(quote, false).map((t) => t.tab)).toEqual(['new', 'docs', 'tansel'])
  })
  it('Closures is for operations and admins, and Transfers is for people in a store', () => {
    const transfer = AREAS.find((a) => a.id === 'transfer')!
    expect(visibleTabs(transfer, true).map((t) => t.tab)).toEqual(['transfers'])
    expect(visibleTabs(transfer, true, true).map((t) => t.tab)).toEqual(['transfers', 'closures', 'holds'])
    expect(visibleTabs(transfer, false, true).map((t) => t.tab)).toEqual(['closures', 'holds']) // operations with no store of their own
    expect(visibleTabs(transfer, false).map((t) => t.tab)).toEqual([])
    expect(visibleTabs(AREAS.find((a) => a.id === 'order')!, true, true).map((t) => t.tab)).toEqual(['order', 'orders'])
  })
  it('operations see Transfer, stores see Stock transfers', () => {
    const transfer = AREAS.find((a) => a.id === 'transfer')!
    expect(areaText(transfer, true).label).toBe('Send to stores')
    expect(areaText(transfer, false).label).toBe('Stock transfers')
    expect(areaText(AREAS[0], true).label).toBe('Quote')
  })
  it('recognises an area id', () => {
    expect(isAreaId('sales')).toBe(true)
    expect(isAreaId('nope')).toBe(false)
    expect(isAreaId(null)).toBe(false)
  })
})
