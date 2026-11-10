// The notification bell: what needs attention, worked out from live data each time. Pure rules over plain inputs, so they are tested
// and nothing can be made up: a notice exists only while its condition is true, and goes when the problem is fixed.

import type { CustomerOrderNeed } from './customerOrders'
import { money } from './order'
import type { Tab } from './sections'
import type { Finding } from './analytics/model'
import type { OrderNeed } from './suggest'

export type Level = 'bad' | 'warn' | 'info'
/** Where a notice's button goes. `vendor` and `show` open the Order tab on that vendor, filtered. */
export interface Target { view: Tab; storeId?: string; vendor?: string; show?: 'low' | 'new' }
export interface Notice { key: string; level: Level; title: string; detail?: string; go?: Target; group: string }

export const COPIED_DAYS = 2 // an order copied for NAV this long ago and not marked ordered is flagged
/** How long a notice stays hidden once dismissed. Information comes back after a week; anything that needs action, tomorrow. */
export const HIDE_HOURS: Record<Level, number> = { bad: 24, warn: 24, info: 24 * 7 }
export const MAX_FINDINGS = 3
export const LOW_CAP = 4 // vendors listed one by one for low stock; the rest are summed into one line
export const NEW_CAP = 2

export interface StoreRef { id: string; name: string }
export interface Counted { store_id: string; vendor_no: string; items: number }
export interface OrderRef { store_id: string; vendor_no: string; status: string; copied_at: string | null }
export interface OverdueInvoice { store_id: string; doc_number: string; customer_name: string; balance_cents: number; due_date: string }
export interface SyncRef { store_id: string; finished_at: string; ok: boolean; message: string | null }

export interface NoticeInput {
  now: Date
  isAdmin: boolean
  stores: StoreRef[] // the stores the person can use
  customerOrders: CustomerOrderNeed[]
  lowStock: Counted[]
  orderNeeds?: OrderNeed[] | null // what each vendor needs ordering; when it is there, it replaces the low-stock lines
  newItems: Counted[]
  orders: OrderRef[]
  overdue: OverdueInvoice[]
  syncs: SyncRef[]
  staleAfterHours?: number
  // admin extras
  salesWeekEnds?: string[] // week_end (yyyy-mm-dd) of every loaded Sales week
  findings?: Finding[]
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const dayCount = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 864e5)

/** The most recent Sunday before today (a Sales week ends on a Sunday), as yyyy-mm-dd in local time. */
export function lastSunday(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  d.setDate(d.getDate() - (d.getDay() === 0 ? 7 : d.getDay()))
  return d.toLocaleDateString('en-CA')
}

/** The week that just ended is not loaded yet. Reports go out on Monday, so Monday itself is not flagged. */
export function salesWeekMissing(weekEnds: string[], now: Date): string | null {
  if (!weekEnds.length) return null // nothing has ever been loaded: that is a setup matter, not a late report
  const expected = lastSunday(now)
  const latest = [...weekEnds].sort().at(-1)!
  if (latest >= expected) return null
  if (now.getDay() === 1) return null
  return expected
}

export function buildNotices(i: NoticeInput): Notice[] {
  const out: Notice[] = []
  const name = new Map(i.stores.map((s) => [s.id, s.name]))
  const multi = i.stores.length > 1
  const at = (storeId: string) => (multi ? ` at ${name.get(storeId) ?? 'a store'}` : '')

  // Customers waiting: the most urgent thing a store has.
  for (const n of i.customerOrders) {
    const first = n.lines.find((l) => l.vendor)
    out.push({
      key: `co:${n.id}`, level: 'bad', group: 'Customers',
      title: `${n.customer_name} is waiting on an order${at(n.store_id)}`,
      detail: `${n.doc_number}: ${n.lines.map((l) => `${l.qty} × ${l.description}`).join(', ')}. Order it, then mark it ordered.`,
      go: first ? { view: 'order', storeId: n.store_id, vendor: first.vendor! } : { view: 'docs' },
    })
  }

  // Money owed.
  const owing = new Map<string, OverdueInvoice[]>()
  for (const o of i.overdue) owing.set(o.store_id, [...(owing.get(o.store_id) ?? []), o])
  for (const [storeId, list] of owing) {
    const total = list.reduce((a, o) => a + o.balance_cents, 0)
    const oldest = list.slice().sort((a, b) => (a.due_date < b.due_date ? -1 : 1))[0]
    out.push({
      key: `overdue:${storeId}`, level: 'bad', group: 'Money',
      title: `${plural(list.length, 'invoice')} overdue${at(storeId)}`,
      detail: `${money(total / 100)} is past its due date. Oldest: ${oldest.doc_number} for ${oldest.customer_name}, due ${oldest.due_date}.`,
      go: { view: 'docs' },
    })
  }

  // Stock.
  const biggest = (list: Counted[]) => [...list].sort((a, b) => b.items - a.items || a.vendor_no.localeCompare(b.vendor_no) || a.store_id.localeCompare(b.store_id))
  const low = biggest(i.orderNeeds ? [] : i.lowStock)
  for (const l of low.slice(0, LOW_CAP)) {
    out.push({
      key: `low:${l.store_id}:${l.vendor_no}`, level: 'warn', group: 'Stock',
      title: `${plural(l.items, 'item')} low at ${l.vendor_no}${at(l.store_id)}`,
      detail: 'Under the weeks of stock this store aims to hold, at the pace they sell.',
      go: { view: 'order', storeId: l.store_id, vendor: l.vendor_no, show: 'low' },
    })
  }
  if (low.length > LOW_CAP) out.push({ key: 'low:more', level: 'warn', group: 'Stock', title: `${plural(low.length - LOW_CAP, 'more vendor')} with items running low`, detail: `${low.slice(LOW_CAP).reduce((a, l) => a + l.items, 0)} items in all. Choose a vendor on the Order tab and use its Low stock filter.`, go: { view: 'order' } })
  // What needs ordering, a vendor at a time, biggest first: a customer waiting makes it urgent. The Order page opens on that vendor's prepared order.
  if (i.orderNeeds) {
    const needs = [...i.orderNeeds].filter((n) => n.items > 0).sort((a, b) => b.cost - a.cost || a.vendor_no.localeCompare(b.vendor_no) || a.store_id.localeCompare(b.store_id))
    for (const n of needs.slice(0, LOW_CAP)) {
      out.push({
        key: `need:${n.store_id}:${n.vendor_no}`, level: n.customers > 0 ? 'bad' : 'warn', group: 'Stock',
        title: `${plural(n.items, 'item')} to order from ${n.vendor_no}${at(n.store_id)}`,
        detail: `About ${money(n.cost)} at cost${n.customers > 0 ? `, ${plural(n.customers, 'item')} for waiting customers` : ''}${n.held > 0 ? `, ${plural(n.held, 'item')} for you to decide` : ''}. A prepared order is ready to review.`,
        go: { view: 'order', storeId: n.store_id, vendor: n.vendor_no },
      })
    }
    if (needs.length > LOW_CAP) out.push({ key: 'need:more', level: 'warn', group: 'Stock', title: `${plural(needs.length - LOW_CAP, 'more vendor')} need ordering`, detail: `${needs.slice(LOW_CAP).reduce((a, n) => a + n.items, 0)} items in all. Open Order to see them.`, go: { view: 'order' } })
  }
  // Stock that has not refreshed, or a sync that failed. A person with one or two stores sees each; the admin sees one line for all.
  const staleH = i.staleAfterHours ?? 36
  const lastSync = new Map<string, SyncRef>()
  for (const r of i.syncs) if (!lastSync.has(r.store_id) || r.finished_at > lastSync.get(r.store_id)!.finished_at) lastSync.set(r.store_id, r)
  const failed: StoreRef[] = []
  const stale: StoreRef[] = []
  for (const s of i.stores) {
    const r = lastSync.get(s.id)
    if (!r) continue // never synced: the Stores tab shows that, and it is not news
    if (!r.ok) failed.push(s)
    else if (i.now.getTime() - new Date(r.finished_at).getTime() > staleH * 36e5) stale.push(s)
  }
  if (i.isAdmin) {
    if (failed.length) out.push({ key: 'syncfail', level: 'bad', group: 'Admin', title: `The NAV sync failed for ${plural(failed.length, 'store')}`, detail: failed.slice(0, 5).map((s) => s.name).join(', ') + (failed.length > 5 ? ' and more' : '') + '. Stores shows the reason.', go: { view: 'stores' } })
    if (stale.length) out.push({ key: 'stale', level: 'warn', group: 'Admin', title: `${plural(stale.length, 'store')} ${stale.length === 1 ? 'has' : 'have'} not refreshed from NAV`, detail: stale.slice(0, 5).map((s) => s.name).join(', ') + (stale.length > 5 ? ' and more' : '') + '.', go: { view: 'stores' } })
  } else {
    for (const s of [...failed, ...stale]) out.push({ key: `stale:${s.id}`, level: 'warn', group: 'Stock', title: `Stock${multi ? ` at ${s.name}` : ''} has not refreshed`, detail: 'Check the figures against NAV before you order.' })
  }

  // Orders.
  for (const o of i.orders) {
    if (o.status !== 'copied' || !o.copied_at) continue
    const days = dayCount(new Date(o.copied_at), i.now)
    if (days >= COPIED_DAYS) out.push({ key: `copied:${o.store_id}:${o.vendor_no}`, level: 'warn', group: 'Orders', title: `${o.vendor_no} order${at(o.store_id)} was copied ${days} days ago`, detail: 'Enter the NAV order number and mark it ordered, or delete it if it was not used.', go: { view: 'order', storeId: o.store_id, vendor: o.vendor_no } })
  }

  // Information.
  const fresh = biggest(i.newItems)
  for (const l of fresh.slice(0, NEW_CAP)) {
    out.push({ key: `new:${l.store_id}:${l.vendor_no}`, level: 'info', group: 'Stock', title: `${plural(l.items, 'new item')} in ${l.vendor_no}${at(l.store_id)}`, detail: 'NAV marks them as new. See whether the store wants them.', go: { view: 'order', storeId: l.store_id, vendor: l.vendor_no, show: 'new' } })
  }
  if (fresh.length > NEW_CAP) out.push({ key: 'new:more', level: 'info', group: 'Stock', title: `${plural(fresh.length - NEW_CAP, 'more vendor')} with new items`, detail: `${fresh.slice(NEW_CAP).reduce((a, l) => a + l.items, 0)} new items in all.`, go: { view: 'order' } })

  // Admin.
  if (i.isAdmin) {
    const missing = i.salesWeekEnds ? salesWeekMissing(i.salesWeekEnds, i.now) : null
    if (missing) out.push({ key: `salesweek:${missing}`, level: 'warn', group: 'Admin', title: 'This week’s Sales reports are not loaded', detail: `The newest week loaded ends before ${missing}. Open Sales, Upload to add the three Power BI files.`, go: { view: 'sales' } })
    const f = (i.findings ?? []).filter((x) => x.severity !== 'low')
    const used = new Set<string>()
    f.slice(0, MAX_FINDINGS).forEach((x) => out.push({ key: ((k) => { let u = k; for (let n = 2; used.has(u); n++) u = `${k}#${n}`; used.add(u); return u })(`finding:${x.who}:${x.title}:${x.at}`), level: x.severity === 'high' ? 'bad' : 'warn', group: 'Admin', title: x.title, detail: `${x.who}. ${x.detail}`, go: { view: 'analytics' } }))
    if (f.length > MAX_FINDINGS) out.push({ key: 'findings:more', level: 'info', group: 'Admin', title: `${f.length - MAX_FINDINGS} more to look at in Analytics`, go: { view: 'analytics' } })
  }

  const rank: Record<Level, number> = { bad: 0, warn: 1, info: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.group.localeCompare(b.group)) // stable: within a group the biggest come first, as added
}

/** Drop the ones a person has hidden for now. `hidden` maps a notice key to when it comes back (ISO). */
export function visible(all: Notice[], hidden: Map<string, string>, now: Date): Notice[] {
  const t = now.toISOString()
  return all.filter((n) => { const until = hidden.get(n.key); return !until || until <= t })
}

export const hideUntil = (level: Level, now: Date) => new Date(now.getTime() + HIDE_HOURS[level] * 36e5).toISOString()

/** The badge: how many are showing, and whether any is urgent. */
export const badge = (shown: Notice[]) => ({ count: shown.length, urgent: shown.some((n) => n.level === 'bad') })
