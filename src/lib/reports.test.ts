import { describe, expect, it } from 'vitest'
import { periodStart, summarise, type OrderWithLines } from './reports'
import type { OrderLine, OrderRow } from './supabase'

const order = (id: string, status: OrderRow['status'], by: string, at: string): OrderRow =>
  ({ id, store_id: 's', vendor_no: 'V1', status, nav_ref: null, created_by: by, created_at: at, copied_at: null, ordered_at: status === 'ordered' ? at : null })
const line = (o: string, code: string, vendor: string | null, division: string | null, qty: number, cost: number): OrderLine =>
  ({ id: o + code, order_id: o, item_code: code, qty, unit_cost: cost, vendor_no: vendor, division, description: code, revision: 1, updated_by: null, updated_at: '' })

const data: OrderWithLines[] = [
  { order: order('a', 'ordered', 'Sam@hsw.com.au', '2026-11-03T00:00:00Z'), lines: [line('a', 'X1', 'V1', 'BATH', 6, 5), line('a', 'X2', 'V2', 'KITCHEN', 2, 10)] },
  { order: order('b', 'ordered', 'lee@hsw.com.au', '2026-10-01T00:00:00Z'), lines: [line('b', 'X1', 'V1', 'BATH', 4, 5)] },
  { order: order('c', 'open', 'sam@hsw.com.au', '2026-11-04T00:00:00Z'), lines: [line('c', 'X3', null, null, 1, 3)] },
]
const names = { 'sam@hsw.com.au': 'Sam Carter' }

describe('reports', () => {
  it('counts only ordered orders by default, grouped by vendor', () => {
    const { rows, total } = summarise(data, { since: null, includeOpen: false, by: 'vendor' }, names)
    expect(rows.map((r) => [r.name, r.orders, r.units, r.cost])).toEqual([['V1', 2, 10, 50], ['V2', 1, 2, 20]])
    expect(total).toEqual({ orders: 2, lines: 3, units: 12, cost: 70 })
  })
  it('can include open orders, and names the missing vendor', () => {
    const { rows } = summarise(data, { since: null, includeOpen: true, by: 'vendor' }, names)
    expect(rows.map((r) => r.name)).toContain('No vendor')
  })
  it('limits to the period', () => {
    const since = periodStart('month', new Date('2026-11-05T00:00:00Z'))
    const { total } = summarise(data, { since, includeOpen: false, by: 'division' }, names)
    expect(total.orders).toBe(1)
  })
  it('groups by person, ignoring email case', () => {
    const { rows } = summarise(data, { since: null, includeOpen: false, by: 'person' }, names)
    expect(rows.find((r) => r.name === 'Sam Carter')?.orders).toBe(1)
    expect(rows.find((r) => r.name === 'lee@hsw.com.au')?.cost).toBe(20)
  })
  it('periods', () => {
    expect(periodStart('all')).toBeNull()
    expect(periodStart('30', new Date('2026-11-05T12:00:00Z'))!.toISOString().slice(0, 10)).toBe('2026-10-06')
  })
})
