// Per-person summary for the Reports tab. Pure, so it is easy to test.
export interface ReportDoc {
  created_by: string | null
  doc_type: 'Quote' | 'Tax Invoice' | 'Customer Order'
  total_cents: number
  status: 'open' | 'part_paid' | 'paid' | 'void'
  created_at: string
  payments: { amount_cents: number }[]
}

export interface ReportRow {
  key: string // the creator's email, lowercased ('' when unknown)
  name: string
  quotes: number
  invoices: number
  invoicedCents: number
  depositCents: number // deposits taken on quotes that have not become invoices yet
  receivedCents: number // money recorded against invoices (a quote's deposit moves here when it is invoiced)
  dueCents: number
}

const blank = (key: string, name: string): ReportRow => ({ key, name, quotes: 0, invoices: 0, invoicedCents: 0, depositCents: 0, receivedCents: 0, dueCents: 0 })

/**
 * Documents created on or after `since` (null = all time), grouped by who created them, busiest first.
 * Void invoices are not counted. Received is what has been recorded against those invoices so far.
 */
export function summarise(docs: ReportDoc[], since: Date | null, names: Record<string, string>) {
  const by = new Map<string, ReportRow>()
  for (const d of docs) {
    if (since && new Date(d.created_at) < since) continue
    if (d.status === 'void') continue
    const key = (d.created_by ?? '').toLowerCase()
    const row = by.get(key) ?? blank(key, names[key] ?? (key || 'Unknown'))
    if (d.doc_type !== 'Tax Invoice') {
      if (d.doc_type === 'Quote') row.quotes += 1
      row.depositCents += d.payments.reduce((a, p) => a + p.amount_cents, 0) // deposits on quotes and customer orders
    }
    else {
      const received = d.payments.reduce((a, p) => a + p.amount_cents, 0)
      row.invoices += 1
      row.invoicedCents += d.total_cents
      row.receivedCents += received
      row.dueCents += Math.max(0, d.total_cents - received)
    }
    by.set(key, row)
  }
  const rows = [...by.values()].sort((a, b) => b.invoicedCents - a.invoicedCents || b.quotes - a.quotes || a.name.localeCompare(b.name))
  const total = rows.reduce((t, r) => ({
    ...t, quotes: t.quotes + r.quotes, invoices: t.invoices + r.invoices, invoicedCents: t.invoicedCents + r.invoicedCents, depositCents: t.depositCents + r.depositCents,
    receivedCents: t.receivedCents + r.receivedCents, dueCents: t.dueCents + r.dueCents,
  }), blank('', 'Total'))
  return { rows, total }
}

/** Start of the chosen period, or null for all time. */
export function periodStart(period: 'month' | '30' | '90' | 'all', now = new Date()): Date | null {
  if (period === 'all') return null
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  const d = new Date(now)
  d.setDate(d.getDate() - Number(period))
  d.setHours(0, 0, 0, 0)
  return d
}
