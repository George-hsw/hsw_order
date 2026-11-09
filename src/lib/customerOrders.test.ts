import { describe, expect, it } from 'vitest'
import { NEXT_STEP, codeLines, needsByItem, type CustomerOrderNeed } from './customerOrders'

describe('codeLines', () => {
  it('reads item codes and quantities from the saved form, blank quantity = 1, own descriptions left out', () => {
    const payload = { lines: [{ code: ' ANA01093 ', qty: '2' }, { code: '', qty: '5', ownDescription: 'Custom shelf' }, { code: 'ANA01096', qty: '' }, { code: 'ANA01093', qty: '1' }] }
    expect(codeLines(payload)).toEqual([{ code: 'ANA01093', qty: 3 }, { code: 'ANA01096', qty: 1 }])
  })
  it('copes with a form that has no lines', () => {
    expect(codeLines({})).toEqual([])
    expect(codeLines(null)).toEqual([])
  })
})

describe('needsByItem', () => {
  const need = (id: string, store: string, code: string, qty: number): CustomerOrderNeed => ({ id, store_id: store, doc_number: 'CO-1-' + id, customer_name: 'Cust ' + id, created_at: '', lines: [{ code, qty, description: '', vendor: 'V' }] })
  it('groups by item for one store only', () => {
    const m = needsByItem([need('1', 's1', 'A', 2), need('2', 's1', 'A', 1), need('3', 's2', 'A', 9)], 's1')
    expect(m.get('A')?.map((x) => x.qty)).toEqual([2, 1])
    expect(m.size).toBe(1)
  })
})

describe('steps', () => {
  it('goes to order, ordered, arrived, collected and stops', () => {
    expect(NEXT_STEP.to_order?.to).toBe('ordered')
    expect(NEXT_STEP.arrived?.to).toBe('collected')
    expect(NEXT_STEP.collected).toBeUndefined()
  })
})
