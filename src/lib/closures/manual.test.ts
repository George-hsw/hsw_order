import { describe, expect, it } from 'vitest'
import { FIRST_ROW, rowsFromText } from './manual'
import { parseClosure } from './parse'
import { blocked, checkClosure } from './validate'

const read = (text: string) => parseClosure(rowsFromText(text), FIRST_ROW)

describe('items typed by hand', () => {
  it('reads one item per line, whatever separates the parts', () => {
    const p = read('A1 5\nB2,3\nC3\t7\nD4;2 Large box')
    expect(p.lines).toEqual([{ code: 'A1', qty: 5, description: '' }, { code: 'B2', qty: 3, description: '' }, { code: 'C3', qty: 7, description: '' }, { code: 'D4', qty: 2, description: 'Large box' }])
  })
  it('keeps leading zeros and ignores blank lines and a trailing newline', () => {
    const p = read('00123 4\n\n00456 1\n')
    expect(p.lines.map((l) => l.code)).toEqual(['00123', '00456'])
    expect(p.headerRow).toBe(0)
  })
  it('names the line the person typed in a problem', () => {
    const p = read('A1 5\nB2\nC3 x')
    expect(p.badQty).toEqual([{ row: 2, code: 'B2', why: 'blank' }, { row: 3, code: 'C3', why: 'not a number' }])
  })
  it('is checked like a sheet: repeats and unknown codes block, nothing typed has no items', () => {
    expect(blocked(checkClosure(read('A1 1\nA1 2')))).toBe(true)
    expect(blocked(checkClosure(read('A1 1\nZ9 2'), { knownCodes: new Set(['A1']) }))).toBe(true)
    expect(blocked(checkClosure(read('A1 1\nB2 2'), { knownCodes: new Set(['A1', 'B2']) }))).toBe(false)
    expect(blocked(checkClosure(read('')))).toBe(true)
  })
})
