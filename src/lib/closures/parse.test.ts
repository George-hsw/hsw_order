import { describe, expect, it } from 'vitest'
import { makeXlsx } from '../testXlsx'
import { readWorkbook, type Cell } from '../xlsx'
import { parseCsv } from './csv'
import { CODE_ALIASES, colOfAny, DESC_ALIASES, parseClosure, QTY_ALIASES } from './parse'

const sheet = (rows: Cell[][]) => readWorkbook(makeXlsx([{ name: 'Stock', rows }])).sheets[0].rows
const read = (rows: Cell[][]) => parseClosure(sheet(rows))

describe('colOfAny', () => {
  it('ignores case and extra spaces, and returns the first match', () => {
    expect(colOfAny(['x', '  ITEM   no. '], CODE_ALIASES)).toBe(1)
    expect(colOfAny(['qty', 'Quantity'], QTY_ALIASES)).toBe(0)
    expect(colOfAny(['x', 'y'], CODE_ALIASES)).toBe(-1)
  })
  it('matches every alias', () => {
    for (const a of CODE_ALIASES) expect(read([[a, 'Qty'], ['A1', 2]]).lines).toEqual([{ code: 'A1', qty: 2, description: '' }])
    for (const a of QTY_ALIASES) expect(read([['Code', a], ['A1', 2]]).lines).toEqual([{ code: 'A1', qty: 2, description: '' }])
    for (const a of DESC_ALIASES) expect(read([['Code', 'Qty', a], ['A1', 2, 'Widget']]).lines[0].description).toBe('Widget')
  })
})

describe('parseClosure', () => {
  it('reads code, quantity and description', () => {
    const p = read([['Item No.', 'Description', 'Qty'], ['A1', 'Box', 3], ['A2', 'Lid', 10]])
    expect(p.lines).toEqual([{ code: 'A1', qty: 3, description: 'Box' }, { code: 'A2', qty: 10, description: 'Lid' }])
    expect(p.headerRow).toBe(0)
    expect(p.dataRows).toBe(2)
    expect(p.checks).toEqual([])
  })
  it('finds a header that is not on row 1', () => {
    const p = read([['Closing store stock'], [], ['Printed 1 July'], ['Code', 'Quantity'], ['A1', 4]])
    expect(p.headerRow).toBe(3)
    expect(p.lines).toEqual([{ code: 'A1', qty: 4, description: '' }])
  })
  it('does not look past row 30 for the header', () => {
    const rows: Cell[][] = Array.from({ length: 30 }, () => ['junk'])
    rows.push(['Code', 'Qty'], ['A1', 1])
    expect(read(rows).headerRow).toBe(-1)
  })
  it('reports no header when columns are missing', () => {
    const p = read([['Code', 'Colour'], ['A1', 'red']])
    expect(p.headerRow).toBe(-1)
    expect(p.lines).toEqual([])
  })
  it('keeps leading zeros in text codes', () => {
    const p = read([['Code', 'Qty'], ['00123', 2], ['00456', 1]])
    expect(p.lines.map((l) => l.code)).toEqual(['00123', '00456'])
    expect(p.checks).toEqual([])
  })
  it('turns numeric codes into text and warns when zeros may have been lost', () => {
    const p = read([['Code', 'Qty'], [123, 2], ['00456', 1]])
    expect(p.lines.map((l) => l.code)).toEqual(['123', '00456'])
    expect(p.checks).toHaveLength(1)
    expect(p.checks[0]).toMatchObject({ ok: false, blocking: false })
    expect(read([['Code', 'Qty'], [12345, 2], [67890, 1]]).checks).toEqual([]) // same length, nothing to suspect
    expect(read([['Code', 'Qty'], [12345, 2], [678, 1]]).checks).toHaveLength(1)
  })
  it('skips blank rows and a totals row', () => {
    const p = read([['Code', 'Qty'], ['A1', 2], [], ['A2', 3], ['Total', 5], [undefined, 5]])
    expect(p.lines.map((l) => l.code)).toEqual(['A1', 'A2'])
    expect(p.skipped).toEqual([{ row: 5, code: 'Total', reason: 'totals row' }, { row: 6, code: '', reason: 'no item code' }])
    expect(p.dataRows).toBe(2)
  })
  it('drops zero quantities but remembers them', () => {
    const p = read([['Code', 'Qty'], ['A1', 0], ['A2', 2]])
    expect(p.lines.map((l) => l.code)).toEqual(['A2'])
    expect(p.skipped).toEqual([{ row: 2, code: 'A1', reason: 'zero quantity' }])
    expect(p.dataRows).toBe(2)
  })
  it('records bad quantities with their row', () => {
    const p = read([['Code', 'Qty'], ['A1', ''], ['A2', 'lots'], ['A3', -1], ['A4', 1.5], ['A5', '1,250'], ['A6', '7']])
    expect(p.badQty).toEqual([
      { row: 2, code: 'A1', why: 'blank' }, { row: 3, code: 'A2', why: 'not a number' },
      { row: 4, code: 'A3', why: 'negative' }, { row: 5, code: 'A4', why: 'not a whole number' },
    ])
    expect(p.lines.map((l) => [l.code, l.qty])).toEqual([['A5', 1250], ['A6', 7]])
  })
  it('keeps repeated codes so validate can report them', () => {
    expect(read([['Code', 'Qty'], ['A1', 1], ['A1', 2]]).lines).toHaveLength(2)
  })
  it('reads the same from a CSV', () => {
    const p = parseClosure(parseCsv('﻿Item Code;Qty;Desc\r\n00123;4;"Box, large"\r\n;;\r\nTOTAL;4;\r\n'))
    expect(p.lines).toEqual([{ code: '00123', qty: 4, description: 'Box, large' }])
    expect(p.skipped).toEqual([{ row: 4, code: 'TOTAL', reason: 'totals row' }])
  })
})
