import { describe, expect, it } from 'vitest'
import { addHandLine, FIRST_ROW, rowsFromLines } from './manual'
import { parseClosure } from './parse'
import { blocked, checkClosure } from './validate'

const read = (lines: { code: string; description: string; qty: number }[]) => parseClosure(rowsFromLines(lines), FIRST_ROW)
const L = (code: string, qty: number, description = '') => ({ code, qty, description })

describe('items chosen by hand', () => {
  it('reads like a sheet, keeping leading zeros and descriptions', () => {
    const p = read([L('00123', 4, 'Box'), L('A2', 7)])
    expect(p.lines).toEqual([{ code: '00123', qty: 4, description: 'Box' }, { code: 'A2', qty: 7, description: '' }])
    expect(p.headerRow).toBe(0)
  })
  it('adding an item already on the list adds to its quantity', () => {
    const lines = addHandLine(addHandLine([], L('A1', 2)), L('B2', 1))
    expect(addHandLine(lines, L('A1', 3))).toEqual([L('A1', 5), L('B2', 1)])
    expect(lines).toEqual([L('A1', 2), L('B2', 1)]) // the list given is not changed
  })
  it('is checked like a sheet: unknown codes block, an empty list has no items', () => {
    expect(blocked(checkClosure(read([L('A1', 1), L('Z9', 2)]), { knownCodes: new Set(['A1']) }))).toBe(true)
    expect(blocked(checkClosure(read([L('A1', 1), L('B2', 2)]), { knownCodes: new Set(['A1', 'B2']) }))).toBe(false)
    expect(blocked(checkClosure(read([])))).toBe(true)
  })
})
