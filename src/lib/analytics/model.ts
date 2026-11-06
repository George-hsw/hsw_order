// What the admin's Analytics tab shows, worked out from the usage log. No network here, so every rule is unit-tested.

export interface AppEvent {
  id: number
  at: string // ISO time
  email: string
  store_id: string | null
  session_id: string
  kind: string
  detail: Record<string, unknown>
  device: string
  device_id: string
}

export const KINDS = { session: 'session_start', tab: 'tab_view', started: 'order_started', copied: 'order_copied', ordered: 'order_ordered', deleted: 'order_deleted', sales: 'sales_view', upload: 'upload', error: 'error' } as const
export const KIND_LABEL: Record<string, string> = {
  session_start: 'Signed in', tab_view: 'Opened a tab', order_started: 'Opened a vendor’s order', order_copied: 'Copied an order for NAV', order_ordered: 'Marked ordered in NAV',
  order_deleted: 'Deleted an order', sales_view: 'Looked at sales', upload: 'Uploaded sales reports', error: 'Hit an error',
}

export const TZ = 'Australia/Sydney'
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' })
/** The calendar day (yyyy-mm-dd) of a time in Sydney, where head office works. */
export const dayKey = (iso: string | Date) => dayFmt.format(new Date(iso))
export const hourOf = (iso: string | Date) => Number(hourFmt.format(new Date(iso)))

export type Period = '1' | '7' | '30' | '90'
export const PERIOD_LABEL: Record<Period, string> = { '1': 'Last 24 hours', '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days' }
export const periodStart = (p: Period, now = new Date()) => new Date(now.getTime() - Number(p) * 864e5)

export interface Summary { users: number; sessions: number; started: number; copied: number; ordered: number; deleted: number; errors: number; events: number }
export function summarise(events: AppEvent[]): Summary {
  const users = new Set<string>(), sessions = new Set<string>()
  const s: Summary = { users: 0, sessions: 0, started: 0, copied: 0, ordered: 0, deleted: 0, errors: 0, events: events.length }
  for (const e of events) {
    users.add(e.email)
    if (e.session_id) sessions.add(e.session_id)
    if (e.kind === KINDS.started) s.started++
    else if (e.kind === KINDS.copied) s.copied++
    else if (e.kind === KINDS.ordered) s.ordered++
    else if (e.kind === KINDS.deleted) s.deleted++
    else if (e.kind === KINDS.error) s.errors++
  }
  s.users = users.size
  s.sessions = sessions.size
  return s
}

/** One row per day for the last `days` days (oldest first), counting distinct people and sessions, with quiet days included as zero. */
export function daily(events: AppEvent[], days: number, now = new Date()): { day: string; users: number; sessions: number; copied: number }[] {
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(new Date(now.getTime() - i * 864e5)))
  const by = new Map(keys.map((k) => [k, { users: new Set<string>(), sessions: new Set<string>(), copied: 0 }]))
  for (const e of events) {
    const d = by.get(dayKey(e.at))
    if (!d) continue
    d.users.add(e.email)
    if (e.session_id) d.sessions.add(e.session_id)
    if (e.kind === KINDS.copied) d.copied++
  }
  return keys.map((k) => ({ day: k, users: by.get(k)!.users.size, sessions: by.get(k)!.sessions.size, copied: by.get(k)!.copied }))
}

/** Sign-ins by hour of the day in Sydney (24 numbers). */
export function byHour(events: AppEvent[]): number[] {
  const out = new Array<number>(24).fill(0)
  for (const e of events) if (e.kind === KINDS.session) out[hourOf(e.at)]++
  return out
}

export interface StoreUse { store_id: string; events: number; users: number; copied: number; last: string }
export function byStore(events: AppEvent[]): StoreUse[] {
  const m = new Map<string, { events: number; users: Set<string>; copied: number; last: string }>()
  for (const e of events) {
    if (!e.store_id) continue
    const r = m.get(e.store_id) ?? { events: 0, users: new Set<string>(), copied: 0, last: '' }
    r.events++; r.users.add(e.email)
    if (e.kind === KINDS.copied) r.copied++
    if (e.at > r.last) r.last = e.at
    m.set(e.store_id, r)
  }
  return [...m].map(([store_id, r]) => ({ store_id, events: r.events, users: r.users.size, copied: r.copied, last: r.last })).sort((a, b) => b.events - a.events)
}

export interface Person { email: string; name: string; active: boolean }
export interface UserRow { email: string; name: string; sessions: number; events: number; orders: number; errors: number; last_seen: string; device: string; tabs: string }
export function userRows(events: AppEvent[], people: Person[]): UserRow[] {
  const names = new Map(people.map((p) => [p.email.toLowerCase(), p.name]))
  const m = new Map<string, { sessions: Set<string>; events: number; orders: number; errors: number; last: string; device: string; tabs: Map<string, number> }>()
  for (const e of events) {
    const r = m.get(e.email) ?? { sessions: new Set<string>(), events: 0, orders: 0, errors: 0, last: '', device: '', tabs: new Map<string, number>() }
    r.events++
    if (e.session_id) r.sessions.add(e.session_id)
    if (e.kind === KINDS.copied || e.kind === KINDS.ordered) r.orders++
    if (e.kind === KINDS.error) r.errors++
    if (e.kind === KINDS.tab && typeof e.detail.tab === 'string') r.tabs.set(e.detail.tab, (r.tabs.get(e.detail.tab) ?? 0) + 1)
    if (e.at >= r.last) { r.last = e.at; if (e.device) r.device = e.device }
    m.set(e.email, r)
  }
  return [...m].map(([email, r]) => ({
    email, name: names.get(email) ?? email, sessions: r.sessions.size, events: r.events, orders: r.orders, errors: r.errors, last_seen: r.last, device: r.device,
    tabs: [...r.tabs].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t).join(', '),
  })).sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1))
}

/** Active accounts with no event at all in the period: set up but not being used. */
export const quietPeople = (events: AppEvent[], people: Person[]) => {
  const seen = new Set(events.map((e) => e.email))
  return people.filter((p) => p.active && !seen.has(p.email.toLowerCase()))
}

// ---------- unusual activity ----------

export interface Finding { severity: 'high' | 'medium' | 'low'; who: string; title: string; detail: string; at: string }
const RANK = { high: 0, medium: 1, low: 2 }
export const NIGHT = [0, 5] // sign-ins from midnight up to 5am Sydney time
export const MANY_DEVICES = 3
export const BURST = 8
export const ERROR_SPIKE = 5
export const DELETE_SPIKE = 5

/**
 * Plain, visible rules over the log. They point at things worth a look; none of them is proof of anything. `events` should reach back
 * further than the last day so a new device can be told from a known one.
 */
export function findings(events: AppEvent[], now = new Date(), windowHours = 24): Finding[] {
  const out: Finding[] = []
  const from = new Date(now.getTime() - windowHours * 36e5).toISOString()
  const recent = events.filter((e) => e.at >= from)
  const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : 1))

  // A device this person has not used before, when they have used others.
  const known = new Map<string, Set<string>>()
  for (const e of sorted) {
    if (!e.device_id) continue
    const set = known.get(e.email) ?? new Set<string>()
    if (e.kind === KINDS.session && !set.has(e.device_id) && set.size > 0 && e.at >= from) out.push({ severity: 'medium', who: e.email, title: 'Signed in on a new device', detail: `${e.device || 'Unknown device'}. Earlier sign-ins were on ${set.size} other device${set.size === 1 ? '' : 's'}.`, at: e.at })
    set.add(e.device_id)
    known.set(e.email, set)
  }

  const perUser = new Map<string, AppEvent[]>()
  for (const e of recent) perUser.set(e.email, [...(perUser.get(e.email) ?? []), e])
  for (const [email, list] of perUser) {
    const sessions = list.filter((e) => e.kind === KINDS.session)
    const devices = new Set(sessions.map((e) => e.device_id).filter(Boolean))
    if (devices.size >= MANY_DEVICES) out.push({ severity: 'high', who: email, title: `Signed in on ${devices.size} different devices`, detail: `In the last ${windowHours} hours: ${[...new Set(sessions.map((e) => e.device).filter(Boolean))].join(', ')}.`, at: sessions[sessions.length - 1].at })
    const night = sessions.filter((e) => { const h = hourOf(e.at); return h >= NIGHT[0] && h < NIGHT[1] })
    if (night.length) out.push({ severity: 'low', who: email, title: 'Signed in overnight', detail: `${night.length} sign-in${night.length === 1 ? '' : 's'} between midnight and 5am Sydney time.`, at: night[night.length - 1].at })
    const hours = new Map<string, number>()
    for (const e of sessions) { const k = e.at.slice(0, 13); hours.set(k, (hours.get(k) ?? 0) + 1) }
    const burst = Math.max(0, ...hours.values())
    if (burst >= BURST) out.push({ severity: 'medium', who: email, title: `${burst} sign-ins within an hour`, detail: 'Many fresh sessions in a short time can mean a login problem or someone retrying.', at: sessions[sessions.length - 1].at })
    const errs = list.filter((e) => e.kind === KINDS.error)
    if (errs.length >= ERROR_SPIKE) out.push({ severity: 'medium', who: email, title: `${errs.length} errors`, detail: `Latest: ${String(errs[errs.length - 1].detail.message ?? 'unknown').slice(0, 120)}`, at: errs[errs.length - 1].at })
    const del = list.filter((e) => e.kind === KINDS.deleted)
    if (del.length >= DELETE_SPIKE) out.push({ severity: 'medium', who: email, title: `${del.length} orders deleted`, detail: 'A lot of deleting in one day. Check they meant to.', at: del[del.length - 1].at })
  }
  const allErr = recent.filter((e) => e.kind === KINDS.error)
  if (allErr.length >= ERROR_SPIKE * 4) out.push({ severity: 'high', who: 'Everyone', title: `${allErr.length} errors across the app`, detail: `${new Set(allErr.map((e) => e.email)).size} people affected in the last ${windowHours} hours.`, at: allErr[allErr.length - 1].at })

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.at < b.at ? 1 : -1))
}

/** The most common error messages in the events, with how many people hit each. */
export function topErrors(events: AppEvent[], n = 8): { message: string; count: number; people: number; last: string; where: string }[] {
  const m = new Map<string, { count: number; people: Set<string>; last: string; where: string }>()
  for (const e of events) {
    if (e.kind !== KINDS.error) continue
    const msg = String(e.detail.message ?? 'Unknown error').slice(0, 140)
    const r = m.get(msg) ?? { count: 0, people: new Set<string>(), last: '', where: String(e.detail.where ?? '') }
    r.count++; r.people.add(e.email)
    if (e.at > r.last) { r.last = e.at; r.where = String(e.detail.where ?? r.where) }
    m.set(msg, r)
  }
  return [...m].map(([message, r]) => ({ message, count: r.count, people: r.people.size, last: r.last, where: r.where })).sort((a, b) => b.count - a.count).slice(0, n)
}
