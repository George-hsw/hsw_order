// Summaries for the Reports tab. Pure, so they are easy to test.
import { totals } from './order'
import type { OrderLine, OrderRow } from './supabase'

export type Period = 'month' | '30' | '90' | 'all'
export type GroupBy = 'vendor' | 'division' | 'person'

/** The first moment of the period, or null for all time. */
export function periodStart(p: Period, now = new Date()): Date | null {
  if (p === 'all') return null
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  const d = new Date(now)
  d.setDate(d.getDate() - Number(p))
  return d
}

export interface ReportRow { key: string; name: string; orders: number; lines: number; units: number; cost: number }
export interface OrderWithLines { order: OrderRow; lines: OrderLine[] }

/**
 * Orders in the period, grouped by vendor, division or the person who started the order, biggest cost first.
 * By default only orders marked Ordered in NAV count; `includeOpen` adds open and copied ones.
 */
export function summarise(data: OrderWithLines[], opts: { since: Date | null; includeOpen: boolean; by: GroupBy }, names: Record<string, string>) {
  const rows = new Map<string, { row: ReportRow; ids: Set<string> }>()
  const allIds = new Set<string>()
  const all = { lines: [] as OrderLine[] }
  for (const { order, lines } of data) {
    if (!opts.includeOpen && order.status !== 'ordered') continue
    if (opts.since && new Date(order.ordered_at ?? order.created_at) < opts.since) continue
    allIds.add(order.id)
    all.lines.push(...lines)
    for (const l of lines) {
      const key = opts.by === 'vendor' ? l.vendor_no ?? '' : opts.by === 'division' ? l.division ?? '' : (order.created_by ?? '').toLowerCase()
      const name = opts.by === 'person' ? names[key] ?? (key || 'Unknown') : key || (opts.by === 'vendor' ? 'No vendor' : 'No division')
      const entry = rows.get(key) ?? { row: { key, name, orders: 0, lines: 0, units: 0, cost: 0 }, ids: new Set<string>() }
      entry.ids.add(order.id)
      entry.row.lines += 1
      entry.row.units += l.qty
      entry.row.cost = Math.round((entry.row.cost + totals([l]).cost) * 100) / 100
      rows.set(key, entry)
    }
  }
  const list = [...rows.values()].map(({ row, ids }) => ({ ...row, orders: ids.size })).sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name))
  return { rows: list, total: { orders: allIds.size, ...totals(all.lines) } }
}
