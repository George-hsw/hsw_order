import { describe, expect, it } from 'vitest'
import { TEMPLATES, buildLabelsPdf, discountOf, expand, labelCount, nowPrice, perSheet, problemOf, regroup, sheetState, splitFull, templateOf, type QueueItem } from './labels'

const item = (code: string, qty: number, over: Partial<QueueItem> = {}): QueueItem => ({ code, description: `Item ${code}`, price: 109, qty, discount: '', ...over })

describe('label sheets', () => {
  it('matches the templates', () => {
    expect(TEMPLATES.map((t) => perSheet(t))).toEqual([33, 36, 9, 18])
  })
  it('says how many spaces are left on a part-filled sheet', () => {
    expect(sheetState(6, 9)).toMatchObject({ sheets: 1, onLast: 6, spaceLeft: 3, fullSheets: 0 })
    expect(sheetState(9, 9)).toMatchObject({ sheets: 1, onLast: 9, spaceLeft: 0, fullSheets: 1 })
    expect(sheetState(10, 9)).toMatchObject({ sheets: 2, onLast: 1, spaceLeft: 8, fullSheets: 1 })
    expect(sheetState(0, 9)).toMatchObject({ sheets: 0, spaceLeft: 0 })
  })
  it('starting part way down a used sheet takes those spaces', () => {
    expect(sheetState(5, 9, 5)).toMatchObject({ sheets: 1, onLast: 9, spaceLeft: 0 })
    expect(sheetState(6, 9, 5)).toMatchObject({ sheets: 2, onLast: 1 })
  })
  it('prints whole sheets only and keeps the rest', () => {
    const { print, keep } = splitFull([item('A', 7), item('B', 5)], 9)
    expect(print).toHaveLength(9)
    expect(keep).toHaveLength(3)
    expect(regroup(keep)).toEqual([expect.objectContaining({ code: 'B', qty: 3 })])
    expect(splitFull([item('A', 6)], 9).print).toHaveLength(0)
  })
  it('counts copies', () => {
    expect(labelCount([item('A', 2), item('B', 3)])).toBe(5)
    expect(expand([item('A', 2)])).toHaveLength(2)
  })
})

describe('label prices', () => {
  it('works out the clearance price to the cent', () => {
    expect(nowPrice(109, 40)).toBe(65.4)
    expect(nowPrice(19.95, 15)).toBe(16.96)
  })
  it('reads the discount', () => {
    expect(discountOf('40')).toBe(40)
    expect(discountOf('40%')).toBe(40)
    expect(discountOf('')).toBeNull()
    expect(discountOf('0')).toBeNull()
    expect(discountOf('150')).toBeNull()
  })
  it('flags items that cannot be printed', () => {
    expect(problemOf(item('A', 1, { price: null }), templateOf('shelf'))).toBe('No price')
    expect(problemOf(item('A', 1), templateOf('clearance'))).toBe('Add a discount %')
    expect(problemOf(item('A', 1, { discount: '30' }), templateOf('clearance'))).toBe('')
    expect(problemOf(item('A', 1), templateOf('shelf'))).toBe('')
  })
})

describe('label pdf', () => {
  it.each(TEMPLATES)('draws a $name sheet', (t) => {
    const labels = expand([item('A', 3, { discount: '40', barcode: '9310583095210' })])
    const doc = buildLabelsPdf(labels, t, { startAt: 2, barcode: true, teal: true })
    expect(doc.getNumberOfPages()).toBe(1)
  })
  it('adds a page when the labels overflow the sheet', () => {
    const doc = buildLabelsPdf(expand([item('A', 10, { discount: '10' })]), templateOf('clearance'), { startAt: 1, barcode: false, teal: false })
    expect(doc.getNumberOfPages()).toBe(2)
  })
})

describe('a kept print can be printed again', () => {
  it('survives being saved as JSON and prints the same labels', () => {
    const printed = expand([item('A', 4), item('B', 2)])
    const kept = JSON.parse(JSON.stringify(regroup(printed))) as QueueItem[]
    expect(kept.map((l) => [l.code, l.qty])).toEqual([['A', 4], ['B', 2]])
    expect(expand(kept)).toHaveLength(printed.length)
    const again = buildLabelsPdf(expand(kept), templateOf('shelf'), { startAt: 3, barcode: false, teal: false })
    const first = buildLabelsPdf(printed, templateOf('shelf'), { startAt: 3, barcode: false, teal: false })
    expect(again.getNumberOfPages()).toBe(first.getNumberOfPages())
  })
})

describe('label colours match the Excel templates', () => {
  const pdfOf = (id: 'shelf' | 'clearance' | 'strip', teal: boolean) =>
    buildLabelsPdf(expand([item('A', 1, { discount: '40' })]), templateOf(id), { startAt: 1, barcode: false, teal }).output()
  const YELLOW = /1\. 0\.82 0\. rg/ // FFD100
  const CHARCOAL = /0\.1 g/ // 1A1A1A
  const TEAL = /0\.09 0\.42 0\.45 rg/ // 176A72
  it('a clearance label has the yellow background and the 1A1A1A band', () => {
    expect(pdfOf('clearance', false)).toMatch(YELLOW)
    expect(pdfOf('clearance', false)).toMatch(CHARCOAL)
  })
  it('a clearance strip has the yellow background and the 1A1A1A block', () => {
    expect(pdfOf('strip', false)).toMatch(YELLOW)
    expect(pdfOf('strip', false)).toMatch(CHARCOAL)
  })
  it('a shelf label is teal 176A72 only when Teal is chosen', () => {
    expect(pdfOf('shelf', true)).toMatch(TEAL)
    expect(pdfOf('shelf', false)).not.toMatch(TEAL)
  })
})
