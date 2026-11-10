import { describe, expect, it } from 'vitest'
import { BLANK, EXAMPLE, fit, type CabinetInput } from './tansel'

const line = (r: ReturnType<typeof fit>) => r.codes.map((c) => `${c.code}x${c.qty}`)
const cab = (over: Partial<CabinetInput>): CabinetInput => ({ ...BLANK, ...over })

// Expected answers below were taken from the workbook itself: the Example tab, and its formulas recalculated for each case.
describe('Tansel finder', () => {
  it('the workbook example: a pantry 568 wide, hinge 22 on the right', () => {
    const r = fit(EXAMPLE)
    expect(r.fits).toBe(true)
    expect(r.pick).toBe('500mm wide basket, 485mm deep  -  5 baskets high: 4 x 100mm high + 1 x 150mm high')
    expect(r.slides).toContain('Side mount slides with ADJUSTABLE spacer (TAN070)')
    expect(r.packersLeft).toBe('None')
    expect(r.packersRight).toBe('None (spacer clears the hinge)')
    expect(r.weight).toBe('40 kg per drawer')
    expect(line(r)).toEqual(['TAN009x4', 'TAN029x1', 'TAN088x5', 'TAN070x5'])
    expect(r.codes[0].description).toBe('S/S basket 500W x 100H x 485D')
  })

  it('asks for the missing measurements one at a time', () => {
    expect(fit(BLANK).headline).toBe('Enter the internal cabinet width (step 2)')
    expect(fit(cab({ width: 568 })).headline).toBe('Enter the internal cabinet depth (step 2)')
    expect(fit(cab({ width: 568, depth: 560 })).headline).toBe('Enter the cabinet height (step 2)')
  })

  it('warns when centimetres were typed', () => {
    expect(fit(cab({ width: 56.8 as number, depth: 560, heightFree: 1400 })).headline).toContain('type MILLIMETRES')
    expect(fit(cab({ width: 568, depth: 56, heightFree: 1400 })).headline).toContain('type MILLIMETRES')
  })

  it('says a cabinet is too shallow, and not enough height', () => {
    const shallow = fit(cab({ width: 568, depth: 390, heightFree: 1400 }))
    expect(shallow.fits).toBe(false)
    expect(shallow.headline).toBe('✗ CABINET TOO SHALLOW - need at least 400mm deep. Call Tansel 02 9440 9800')
    expect(fit(cab({ width: 568, depth: 560, heightFree: 200 })).headline).toBe('✗ NOT ENOUGH HEIGHT - needs 250mm, cabinet has 200mm')
  })

  it('splits a wide space into baskets side by side with bottom mount', () => {
    const r = fit(cab({ width: 991, depth: 520, heightFree: 1400, hinges: 'none', across: 2, count: 5, tall: 3 }))
    expect(r.fits).toBe(true)
    expect(r.slides).toContain('Bottom mount slides (TAN072)')
    expect(r.slides).toContain('(2 pairs per level)')
    expect(r.pick).toMatch(/^2 x 450mm baskets side by side, 485mm deep/)
  })

  it('treats 400 and 600 deep baskets as special order', () => {
    const r = fit(cab({ width: 520, depth: 420, heightFree: 1400, hinges: 'none', depthChoice: 400 }))
    expect(r.fits).toBe(true)
    expect(r.pick).toContain('(SPECIAL ORDER)')
    expect(r.notes).toContain('SPECIAL ORDER')
  })

  it('never lists a code that is missing from the table, and never a zero quantity', () => {
    for (const c of [EXAMPLE, cab({ ...EXAMPLE, product: 'laundry', width: 560, heightFree: 900 }), cab({ ...EXAMPLE, product: 'undersink', width: 400, heightFree: 600 })]) {
      for (const l of fit(c).codes) { expect(l.qty).toBeGreaterThan(0); expect(l.description).not.toBe('') }
    }
  })

  it('fits a laundry hamper, and tells the user to check the pipes for an under-sink rack', () => {
    const l = fit(cab({ product: 'laundry', width: 560, depth: 560, heightFree: 900, hinges: 'none' }))
    expect(l.fits).toBe(true)
    expect(l.pick).toContain('laundry hamper')
    const u = fit(cab({ product: 'undersink', width: 400, depth: 560, heightFree: 600, hinges: 'none' }))
    expect(u.notes).toContain('Check the sink plumbing')
  })

  it('the multi-frame needs its minimum height and depth', () => {
    expect(fit(cab({ product: 'frame', width: 400, depth: 500, heightFree: 500 })).headline).toContain('NOT ENOUGH HEIGHT - frame needs 580mm')
    const ok = fit(cab({ product: 'frame', width: 400, depth: 500, heightFree: 700, hinges: 'none', mf100: 2 }))
    expect(ok.fits).toBe(true)
    expect(line(ok)[0]).toBe('TAN055x1')
  })
})
