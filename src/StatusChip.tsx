import { ORDER_STATUS_LABEL, type OrderStatus } from './lib/supabase'

const CLASS: Record<OrderStatus, string> = { open: '', copied: 'warn', ordered: 'paid' }

/** Open, Copied or Ordered in NAV, in the same chip as the Quote app's statuses. */
export default function StatusChip({ status, received }: { status: OrderStatus; received?: boolean }) {
  if (received) return <span className="chip paid">Received</span>
  return <span className={('chip ' + CLASS[status]).trim()}>{ORDER_STATUS_LABEL[status]}</span>
}
