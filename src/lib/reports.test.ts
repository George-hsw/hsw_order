import { describe, expect, it } from 'vitest'
import { periodStart, summarise, type ReportDoc } from './reports'

const doc = (p: Partial<ReportDoc>): ReportDoc => ({
  created_by: 'sam@hsw.com.au', doc_type: 'Tax Invoice', total_cents: 10000, status: 'open',
  created_at: '2026-10-15T00:00:00Z', payments: [], ...p,
})
const names = { 'sam@hsw.com.au': 'Sam Carter', 'priya@hsw.com.au': 'Priya Nair' }

describe('summarise', () => {
  it('groups by creator and sums invoices, payments and what is still due', () => {
    const { rows, total } = summarise([
      doc({ total_cents: 20000, payments: [{ amount_cents: 5000 }] }),
      doc({ total_cents: 10000, payments: [{ amount_cents: 10000 }], status: 'paid' }),
      doc({ doc_type: 'Quote', total_cents: 99999 }),
      doc({ created_by: 'priya@hsw.com.au', total_cents: 5000 }),
    ], null, names)
    expect(rows[0]).toMatchObject({ name: 'Sam Carter', quotes: 1, invoices: 2, invoicedCents: 30000, receivedCents: 15000, dueCents: 15000 })
    expect(rows[1]).toMatchObject({ name: 'Priya Nair', invoices: 1, dueCents: 5000 })
    expect(total).toMatchObject({ quotes: 1, invoices: 3, invoicedCents: 35000, receivedCents: 15000, dueCents: 20000 })
  })

  it('counts deposits held on quotes separately from money received on invoices', () => {
    const { rows, total } = summarise([
      doc({ doc_type: 'Quote', total_cents: 50000, payments: [{ amount_cents: 10000 }], status: 'part_paid' }),
      doc({ total_cents: 20000, payments: [{ amount_cents: 20000 }], status: 'paid' }),
    ], null, names)
    expect(rows[0]).toMatchObject({ quotes: 1, invoices: 1, depositCents: 10000, receivedCents: 20000, dueCents: 0 })
    expect(total.depositCents).toBe(10000)
  })

  it('ignores void documents and documents before the period starts', () => {
    const { rows } = summarise([
      doc({ status: 'void' }),
      doc({ created_at: '2026-08-01T00:00:00Z' }),
      doc({ created_at: '2026-10-20T00:00:00Z' }),
    ], new Date('2026-10-01T00:00:00Z'), names)
    expect(rows).toHaveLength(1)
    expect(rows[0].invoices).toBe(1)
  })

  it('matches creators case-insensitively and labels unknown ones', () => {
    const { rows } = summarise([doc({ created_by: 'SAM@HSW.COM.AU' }), doc({ created_by: null })], null, names)
    expect(rows.map((r) => r.name).sort()).toEqual(['Sam Carter', 'Unknown'])
  })
})

describe('periodStart', () => {
  const now = new Date(2026, 9, 30, 15, 0, 0)
  it('starts the month on the 1st and counts back whole days', () => {
    expect(periodStart('month', now)).toEqual(new Date(2026, 9, 1))
    expect(periodStart('30', now)).toEqual(new Date(2026, 8, 30)) // 30 days before 30 Oct, at midnight
    expect(periodStart('all', now)).toBeNull()
  })
})

describe('customer orders in reports', () => {
  it('count their deposits like quote deposits, and are not counted as quotes or invoices', () => {
    const { total } = summarise([{ created_by: 'a@x', doc_type: 'Customer Order', total_cents: 9900, status: 'part_paid', created_at: '2026-11-01', payments: [{ amount_cents: 2000 }] }], null, {})
    expect(total.quotes).toBe(0)
    expect(total.invoices).toBe(0)
    expect(total.depositCents).toBe(2000)
    expect(total.invoicedCents).toBe(0)
  })
})
