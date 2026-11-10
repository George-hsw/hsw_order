// Customer orders: what a customer is waiting for, so the store remembers to order it. Pure helpers, tested.

export type Fulfilment = 'to_order' | 'ordered' | 'arrived' | 'collected'
export const FULFILMENT_LABEL: Record<Fulfilment, string> = { to_order: 'To order', ordered: 'Ordered', arrived: 'Arrived', collected: 'Collected' }
/** The step after each one, and the button that takes it. */
export const NEXT_STEP: Partial<Record<Fulfilment, { to: Fulfilment; label: string }>> = {
  to_order: { to: 'ordered', label: 'Mark ordered' },
  ordered: { to: 'arrived', label: 'Mark arrived' },
  arrived: { to: 'collected', label: 'Mark collected' },
}
export const FULFILMENT_CHIP: Record<Fulfilment, string> = { to_order: 'warn', ordered: 'quote', arrived: 'paid', collected: '' }

export interface NeedLine { code: string; qty: number; description: string; vendor: string | null }
/** One customer order still to be ordered from the vendor. */
export interface CustomerOrderNeed { id: string; store_id: string; doc_number: string; customer_name: string; created_at: string; lines: NeedLine[] }

/** The item lines of a saved customer order (its builder form): item code and quantity. A blank quantity counts as 1, as on the document. Lines without an item code (own descriptions) cannot be ordered by code and are left out. */
export function codeLines(payload: unknown): { code: string; qty: number }[] {
  const lines = (payload as { lines?: { code?: unknown; qty?: unknown }[] } | null)?.lines
  if (!Array.isArray(lines)) return []
  const out = new Map<string, number>()
  for (const l of lines) {
    const code = typeof l?.code === 'string' ? l.code.trim() : ''
    if (!code) continue
    const n = Number(String(l.qty ?? '').trim())
    const qty = Number.isFinite(n) && n > 0 ? Math.round(n) : 1
    out.set(code, (out.get(code) ?? 0) + qty)
  }
  return [...out].map(([code, qty]) => ({ code, qty }))
}

/** For one store: every item a customer is waiting on, with who and how many. */
export function needsByItem(needs: CustomerOrderNeed[], storeId: string): Map<string, { id: string; doc_number: string; customer_name: string; qty: number }[]> {
  const m = new Map<string, { id: string; doc_number: string; customer_name: string; qty: number }[]>()
  for (const n of needs) {
    if (n.store_id !== storeId) continue
    for (const l of n.lines) m.set(l.code, [...(m.get(l.code) ?? []), { id: n.id, doc_number: n.doc_number, customer_name: n.customer_name, qty: l.qty }])
  }
  return m
}
