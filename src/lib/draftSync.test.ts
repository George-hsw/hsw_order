import { describe, expect, it } from 'vitest'
import { mergeQuotes } from './draftSync'
import { emptyQuote, type QuoteInput } from './quote'

const withLine = (q: QuoteInput, i: number, code: string, qty = '1'): QuoteInput => ({
  ...q, lines: q.lines.map((l, n) => (n === i ? { ...l, code, qty } : l)),
})
const named = (q: QuoteInput, name: string): QuoteInput => ({ ...q, customer: { ...q.customer, name } })

describe('mergeQuotes', () => {
  const base = emptyQuote()

  it('keeps a customer name typed here and an item scanned on the other device', () => {
    const local = named(base, 'Jo Smith')
    const remote = withLine(base, 0, 'ABC123')
    const merged = mergeQuotes(base, local, remote)
    expect(merged.customer.name).toBe('Jo Smith')
    expect(merged.lines[0].code).toBe('ABC123')
  })

  it('takes a line the other device deleted when nothing here changed that line', () => {
    const shared = withLine(withLine(base, 0, 'A1'), 1, 'B2')
    const remote = withLine(base, 1, 'B2') // line 0 deleted over there
    const merged = mergeQuotes(shared, shared, remote)
    expect(merged.lines[0].code).toBe('')
    expect(merged.lines[1].code).toBe('B2')
  })

  it('keeps this device’s edit to a line it changed, and still takes the others', () => {
    const shared = withLine(base, 0, 'A1')
    const local = withLine(shared, 0, 'A1', '5') // quantity changed here
    const remote = withLine(withLine(shared, 0, 'A1', '2'), 1, 'B2') // quantity changed there too, plus a new line
    const merged = mergeQuotes(shared, local, remote)
    expect(merged.lines[0].qty).toBe('5')
    expect(merged.lines[1].code).toBe('B2')
  })

  it('is just the other device’s quote when nothing changed here', () => {
    const remote = named(withLine(base, 2, 'C3'), 'Pat')
    expect(mergeQuotes(base, base, remote)).toEqual(remote)
  })
})
