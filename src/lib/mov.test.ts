import { describe, expect, it } from 'vitest'
import { movCheck, movFor } from './mov'

describe('minimum order value', () => {
  it('belongs to the 3-letter code a NAV vendor number starts with', () => {
    expect(movFor('ANAS001')?.mov).toBe(750)
    expect(movFor('kesr001')?.mov).toBe(300)
    expect(movFor('JOSE001')?.mov).toBe(500)
    expect(movFor('VERG001')?.mov).toBe(500)
    expect(movFor('MYHO001')?.mov).toBe(2000)
  })
  it('is null for a vendor with none, or no vendor', () => {
    expect(movFor('ZZZ0001')).toBeNull()
    expect(movFor('')).toBeNull()
    expect(movFor(null)).toBeNull()
    expect(movFor('constructor')).toBeNull() // not a code just because it is a property of every object
    expect(movCheck('ZZZ0001', 10)).toBeNull()
  })
  it('says how much is missing, in exact cents', () => {
    expect(movCheck('ANAS001', 629.9)).toEqual({ mov: 750, short: 120.1, met: false, note: undefined })
    expect(movCheck('ANAS001', 750)).toMatchObject({ short: 0, met: true })
    expect(movCheck('ANAS001', 1200)).toMatchObject({ short: 0, met: true })
    expect(movCheck('BUDR001', 323.99)).toMatchObject({ short: 0.01, met: false })
  })
  it('carries the supplier’s fee or levy when it has one', () => {
    expect(movCheck('TANS001', 700)?.note).toBe('$24.95 shipping fee if under')
    expect(movCheck('ANAS001', 700)?.note).toBeUndefined()
  })
})
