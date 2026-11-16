import { describe, expect, it } from 'vitest'
import { makeXlsx } from '../testXlsx'
import { readWorkbook, type Cell } from '../xlsx'
import { parseClosure } from './parse'
import { blocked, checkClosure, MAX_LINES, type ClosureValidateOptions } from './validate'

const check = (rows: Cell[][], opts?: ClosureValidateOptions) =>
  checkClosure(parseClosure(readWorkbook(makeXlsx([{ name: 'Stock', rows }])).sheets[0].rows), opts)
const failing = (c: ReturnType<typeof check>) => c.filter((x) => !x.ok).map((x) => x.label)
const HEAD: Cell[] = ['Code', 'Qty']

describe('closure checks', () => {
  it('passes a clean sheet', () => {
    const c = check([HEAD, ['A1', 2], ['A2', 5]])
    expect(failing(c)).toEqual([])
    expect(blocked(c)).toBe(false)
  })
  it('blocks when there is no header', () => {
    const c = check([['Colour', 'Size'], ['red', 1]])
    expect(failing(c)).toEqual(['Header row found'])
    expect(blocked(c)).toBe(true)
  })
  it('blocks when there are no item rows', () => {
    const c = check([HEAD, ['Total', 0]])
    expect(failing(c)).toContain('Sheet has items')
    expect(blocked(c)).toBe(true)
  })
  it('blocks repeated item codes and names them', () => {
    const c = check([HEAD, ['A1', 1], ['A1', 2], ['B2', 1], ['B2', 1]])
    expect(blocked(c)).toBe(true)
    expect(c.find((x) => x.label === 'No repeated item codes')!.detail).toContain('A1, B2')
  })
  it('blocks blank, non numeric, negative and fractional quantities, listing the first few rows', () => {
    const rows: Cell[][] = [HEAD, ['A1', ''], ['A2', 'x'], ['A3', -2], ['A4', 0.5], ['A5', 1]]
    const c = check(rows)
    expect(blocked(c)).toBe(true)
    const d = c.find((x) => x.label.startsWith('Quantities'))!.detail
    expect(d).toContain('4 rows')
    expect(d).toContain('row 2 (A1, blank)')
    expect(d).toContain('row 4 (A3, negative)')
    expect(d).toContain('and 1 more')
    expect(d).not.toContain('A4')
  })
  it('warns about zero quantities without blocking', () => {
    const c = check([HEAD, ['A1', 0], ['A2', 3]])
    expect(failing(c)).toEqual(['Zero quantities left out'])
    expect(blocked(c)).toBe(false)
  })
  it('blocks more than 20,000 lines', () => {
    const rows: Cell[][] = [HEAD]
    for (let i = 0; i <= MAX_LINES; i++) rows.push(['C' + i, 1])
    expect(failing(check(rows))).toEqual(['Not too many lines'])
    expect(blocked(check(rows))).toBe(true)
    expect(blocked(check(rows.slice(0, MAX_LINES + 1)))).toBe(false)
  })
  it('blocks codes missing from knownCodes when a set is supplied, and lists them', () => {
    const rows: Cell[][] = [HEAD, ['A1', 1], ['Z9', 1], ['Y8', 1]]
    const c = check(rows, { knownCodes: new Set(['A1']) })
    expect(blocked(c)).toBe(true)
    expect(c.find((x) => x.label === 'Item codes are known')!.detail).toContain('Z9, Y8')
    expect(blocked(check(rows))).toBe(false) // no set, no check
    expect(blocked(check(rows, { knownCodes: new Set(['A1', 'Z9', 'Y8']) }))).toBe(false)
  })
  it('only warns when the sheet has more than the system shows', () => {
    const c = check([HEAD, ['A1', 5], ['A2', 1], ['A3', 9]], { systemQty: new Map([['A1', 3], ['A2', 1]]) })
    expect(failing(c)).toEqual(['Sheet quantities are within system stock'])
    expect(c.find((x) => !x.ok)!.detail).toContain('A1 (sheet 5, system 3)')
    expect(blocked(c)).toBe(false)
  })
  it('includes the leading zero warning from parsing', () => {
    const c = check([HEAD, [123, 1], ['00456', 1]])
    expect(failing(c)).toEqual(['Item codes may have lost leading zeros'])
    expect(blocked(c)).toBe(false)
  })
})
