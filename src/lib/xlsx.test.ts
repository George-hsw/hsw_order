import { describe, expect, it } from 'vitest'
import { colOf, colIndex, excelDate, findRow, num, readWorkbook, text } from './xlsx'
import { makeXlsx } from './testXlsx'

describe('reading a workbook', () => {
  const book = makeXlsx([
    { name: 'One', rows: [['Store', 'Sales'], ['Artarmon & Co', 1250.5], [], ['Aspley', 'x']] },
    { name: 'Hidden', hidden: true, rows: [['secret']] },
    { name: 'Skipped', rows: [['not read']] },
  ])
  it('lists every sheet, marks hidden ones, and reads rows with their cells in place', () => {
    const wb = readWorkbook(book, (n) => n !== 'Skipped')
    expect(wb.sheets.map((s) => s.name)).toEqual(['One', 'Hidden', 'Skipped'])
    expect(wb.sheet('Hidden')?.hidden).toBe(true)
    const one = wb.sheet('One')!
    expect(one.rows[1]).toEqual(['Artarmon & Co', 1250.5]) // entities decoded, numbers kept as numbers
    expect(one.rows[3][0]).toBe('Aspley') // a blank row in between keeps later rows in place
  })
  it('decompresses only the sheets asked for', () => {
    const wb = readWorkbook(book, (n) => n === 'One')
    expect(wb.sheet('Skipped')?.rows).toEqual([])
    expect(wb.sheet('Hidden')?.rows).toEqual([])
  })
  it('refuses something that is not a workbook', () => {
    expect(() => readWorkbook(new Uint8Array([1, 2, 3]))).toThrow()
  })
})

describe('reading values', () => {
  it('converts column letters, numbers, text and dates', () => {
    expect(colIndex('A')).toBe(0)
    expect(colIndex('AA')).toBe(26)
    expect(num('1,250.5')).toBe(1250.5)
    expect(num('12%')).toBe(12)
    expect(num('x', -1)).toBe(-1)
    expect(num(undefined)).toBe(0)
    expect(text(' hi ')).toBe('hi')
    expect(text(undefined)).toBe('')
    expect(excelDate(46266)).toBe('2026-09-01') // a Tuesday: the week runs Monday 31 August to Sunday 6 September
    expect(excelDate(46271)).toBe('2026-09-06')
  })
  it('finds a header row and picks the nth column of a repeated header', () => {
    const rows = [[], [], [], ['No.', 'QTY Sold', 'x', 'QTY Sold']]
    expect(findRow(rows, 0, 'no.')).toBe(3)
    expect(findRow(rows, 0, 'missing')).toBe(-1)
    expect(colOf(rows[3], 'QTY Sold', 0)).toBe(1)
    expect(colOf(rows[3], 'QTY Sold', 1)).toBe(3)
    expect(colOf(rows[3], 'nope')).toBe(-1)
  })
})
