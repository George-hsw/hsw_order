// What a request is up to, in words and counts, and what is left of a closing store's stock. Pure functions; the database enforces the same rules
// (reoffer_lines in migration 032), so these only show people what it will allow.
import type { ClosureLineRow, RequestLineRow, RequestRow, RequestStatus } from './api'
import { JOURNAL_HEADER, NAV_UOM, ausDate, clean, fmtQty } from '../stocktake'

export const REQUEST_LABEL: Record<RequestStatus, string> = {
  sent: 'Waiting for the store', accepted: 'Accepted', declined: 'Declined', received: 'Received', cancelled: 'Taken back',
}
/** The chip class for each status (the design system's own: warn, quote, bad, paid). */
export const REQUEST_CHIP: Record<RequestStatus, string> = { sent: 'chip warn', accepted: 'chip quote', declined: 'chip bad', received: 'chip paid', cancelled: 'chip' }

/** A store answers while it is waiting; after that only copying for NAV and marking received remain. */
export const awaitingAnswer = (r: Pick<RequestRow, 'status'>) => r.status === 'sent'
export const canTakeBack = (r: Pick<RequestRow, 'status'>) => r.status === 'sent'

export interface Progress { waiting: number; accepted: number; declined: number; received: number; cancelled: number; total: number; allAnswered: boolean }

/** How the requests of a closure stand. A taken-back request is counted but never holds the closure open. */
export function closureProgress(requests: Pick<RequestRow, 'status'>[]): Progress {
  const p: Progress = { waiting: 0, accepted: 0, declined: 0, received: 0, cancelled: 0, total: requests.length, allAnswered: false }
  for (const r of requests) {
    if (r.status === 'sent') p.waiting++
    else if (r.status === 'accepted') p.accepted++
    else if (r.status === 'declined') p.declined++
    else if (r.status === 'received') p.received++
    else p.cancelled++
  }
  p.allAnswered = p.total > 0 && p.waiting === 0
  return p
}

/** Units a request holds: what was asked while it waits, what was accepted once answered (a decline holds nothing). */
export function heldBy(r: Pick<RequestRow, 'status'>, l: Pick<RequestLineRow, 'qty_requested' | 'qty_accepted'>): number {
  if (r.status === 'sent') return l.qty_requested
  if (r.status === 'accepted' || r.status === 'received') return l.qty_accepted ?? l.qty_requested
  return 0
}

/** What is left of each item on the sheet after the requests that still hold stock. This is what can be offered again. */
export function leftOverAfter(lines: Pick<ClosureLineRow, 'item_code' | 'qty'>[], requests: Pick<RequestRow, 'id' | 'status'>[], requestLines: Pick<RequestLineRow, 'request_id' | 'item_code' | 'qty_requested' | 'qty_accepted'>[]): Map<string, number> {
  const status = new Map(requests.map((r) => [r.id, r]))
  const held = new Map<string, number>()
  for (const l of requestLines) {
    const r = status.get(l.request_id)
    if (r) held.set(l.item_code, (held.get(l.item_code) ?? 0) + heldBy(r, l))
  }
  const out = new Map<string, number>()
  for (const l of lines) out.set(l.item_code, Math.max(0, l.qty - (held.get(l.item_code) ?? 0)))
  return out
}

/** Tab-separated lines for pasting into a NAV transfer order: the item number and the accepted quantity. The transfer's header (from, to) is entered by hand. */
export function transferNavText(lines: Pick<RequestLineRow, 'item_code' | 'qty_accepted' | 'qty_requested'>[]): string {
  return lines
    .map((l) => ({ code: l.item_code.replace(/[\t\r\n]/g, ' ').trim(), qty: l.qty_accepted ?? l.qty_requested }))
    .filter((l) => l.qty > 0)
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((l) => `${l.code}\t${l.qty}`)
    .join('\n')
}

/**
 * The stock adjustment a store pastes into NAV for stock it receives: tab-separated item journal lines in the same columns as a stock take
 * adjustment (date, barcode left for NAV, item number, description, EA, quantity, reason code). The quantity is positive, since the stock is
 * added. The reason code is left blank, for the store to fill in.
 */
export function transferJournalText(lines: Pick<RequestLineRow, 'item_code' | 'description' | 'qty_accepted' | 'qty_requested'>[], date = new Date(), withHeader = false): string {
  const when = ausDate(date)
  const rows = lines
    .map((l) => ({ l, qty: l.qty_accepted ?? l.qty_requested }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => (a.l.item_code < b.l.item_code ? -1 : a.l.item_code > b.l.item_code ? 1 : 0))
    .map(({ l, qty }) => [when, '', l.item_code, clean(l.description), NAV_UOM, fmtQty(qty), ''].join('\t'))
  return [...(withHeader ? [JOURNAL_HEADER.join('\t')] : []), ...rows].join('\n')
}

/** What a store sees for a request: it copies the adjustment into NAV, then marks it done. */
export function storeStatus(r: Pick<RequestRow, 'status' | 'copied_at'>): { label: string; chip: string } {
  if (r.status === 'sent') return { label: 'To copy into NAV', chip: 'chip warn' }
  if (r.status === 'accepted') return r.copied_at ? { label: 'Copied, to mark done', chip: 'chip quote' } : { label: 'To copy into NAV', chip: 'chip warn' }
  if (r.status === 'received') return { label: 'Done', chip: 'chip paid' }
  if (r.status === 'declined') return { label: 'Declined', chip: 'chip bad' }
  return { label: 'Taken back', chip: 'chip' }
}
