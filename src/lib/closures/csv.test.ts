import { describe, expect, it } from 'vitest'
import { decodeUtf8, parseCsv, readCsv } from './csv'

describe('csv reader', () => {
  it('reads plain rows with LF and CRLF', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('reads a last line with no newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('handles quoted commas, newlines and doubled quotes', () => {
    expect(parseCsv('a,b\n"x, y","line1\nline2"\n"say ""hi""",z')).toEqual([['a', 'b'], ['x, y', 'line1\nline2'], ['say "hi"', 'z']])
  })
  it('strips a UTF-8 BOM', () => {
    expect(parseCsv('﻿Item No,Qty\n1,2')[0]).toEqual(['Item No', 'Qty'])
  })
  it('uses semicolons when the first line has no comma', () => {
    expect(parseCsv('Item No;Qty\nA1;5')).toEqual([['Item No', 'Qty'], ['A1', '5']])
  })
  it('keeps commas when the first line has one, even with a semicolon in a field', () => {
    expect(parseCsv('a,b\n"x;y",2')).toEqual([['a', 'b'], ['x;y', '2']])
  })
  it('leaves empty fields undefined and keeps blank lines as empty rows', () => {
    expect(parseCsv('a,b,c\n1,,3\n\n4,5,')).toEqual([['a', 'b', 'c'], ['1', undefined, '3'], [], ['4', '5']])
  })
  it('returns no rows for empty text, and a Sheet from readCsv', () => {
    expect(parseCsv('')).toEqual([])
    expect(readCsv('a\n1')).toEqual({ name: 'CSV', hidden: false, rows: [['a'], ['1']] })
  })
  it('keeps leading zeros in codes', () => {
    expect(parseCsv('Code,Qty\n00123,4')[1][0]).toBe('00123')
  })
})

describe('decodeUtf8', () => {
  it('decodes clean UTF-8 without a warning', () => {
    expect(decodeUtf8(new TextEncoder().encode('Café'))).toEqual({ text: 'Café', suspect: false })
  })
  it('flags bytes that are not valid UTF-8, as in a Windows-1252 file', () => {
    const r = decodeUtf8(new Uint8Array([0x43, 0x61, 0x66, 0xe9])) // "Caf" then é in Windows-1252
    expect(r.suspect).toBe(true)
    expect(r.text).toContain('�')
  })
})
