import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OrderNeed } from './suggest'
import { api } from './api'
import { findings, type AppEvent } from './analytics/model'
import { loadEvents } from './analytics/api'
import { badge, buildNotices, hideUntil, visible, type Notice } from './notifications'
import { salesApi } from './sales/api'
import type { StoreRow } from './supabase'

const EVERY_MS = 5 * 60 * 1000 // look again every five minutes while the app is open
const SLOW_MS = 12000 // a check that takes longer than this is left out rather than holding the bell up
const FEW_STORES = 5 // low stock and new items are counted for people who order for a few stores; the admin sees the admin checks instead
const EVENT_DAYS = 8 // far enough back to tell a new device from a known one

const within = <T,>(p: Promise<T>): Promise<T> => new Promise((ok, no) => { const t = setTimeout(() => no(new Error('too slow')), SLOW_MS); p.then((v) => { clearTimeout(t); ok(v) }, (e) => { clearTimeout(t); no(e) }) })

/**
 * Everything the notification bell shows, for the stores a person can use. Each check loads on its own: if one fails (or is slow) the rest still
 * show, and `partial` says so. Dismissals are remembered per person.
 */
export function useNotices({ isAdmin, stores, refreshKey }: { isAdmin: boolean; stores: StoreRow[]; refreshKey: number }) {
  const [all, setAll] = useState<Notice[]>([])
  const [hidden, setHidden] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [partial, setPartial] = useState(false)
  const [tick, setTick] = useState(0)
  const ids = useMemo(() => stores.map((s) => s.id), [stores])
  const idKey = ids.join(',')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') setTick((n) => n + 1) }, EVERY_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!ids.length) { setAll([]); setLoading(false); return }
    let live = true
    const few = ids.length <= FEW_STORES
    const since = new Date(Date.now() - EVENT_DAYS * 864e5)
    setLoading(true)
    Promise.allSettled([
      within(api.customerOrders(ids)),
      few ? within(api.lowStock(ids)) : Promise.resolve([]),
      few ? within(api.newItems(ids)) : Promise.resolve([]),
      within(api.listOrders(ids)),
      within(api.overdueInvoices(ids)),
      within(api.syncRuns()),
      within(api.dismissals()),
      isAdmin ? within(salesApi.weeks()) : Promise.resolve([]),
      isAdmin ? within(loadEvents(since)) : Promise.resolve({ events: [] as AppEvent[], truncated: false }),
      few ? within(api.orderNeeds(ids)) : Promise.resolve(null),
    ]).then((r) => {
      if (!live) return
      const val = <T,>(i: number, fallback: T): T => (r[i].status === 'fulfilled' ? (r[i] as PromiseFulfilledResult<T>).value : fallback)
      const failed = [0, 1, 2, 3, 4, 5, 7, 8, 9].filter((i) => r[i].status === 'rejected').length
      const now = new Date()
      const weeks = val<{ week_end: string }[]>(7, [])
      const events = val<{ events: AppEvent[] }>(8, { events: [] }).events
      setAll(buildNotices({
        now, isAdmin, stores: stores.map((s) => ({ id: s.id, name: s.name })),
        customerOrders: val(0, []), lowStock: val(1, []), orderNeeds: val<OrderNeed[] | null>(9, null), newItems: val(2, []),
        orders: val(3, []), overdue: val(4, []), syncs: val(5, []),
        salesWeekEnds: isAdmin && r[7].status === 'fulfilled' ? weeks.map((w) => w.week_end) : undefined,
        findings: isAdmin ? findings(events, now) : undefined,
      }))
      setHidden(val<Map<string, string>>(6, new Map()))
      setPartial(failed > 0)
      setLoading(false)
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, isAdmin, refreshKey, tick])

  const shown = useMemo(() => visible(all, hidden, new Date()), [all, hidden])

  /** Hide these for a while: a day, or a week for information. They come back if the problem is still there. */
  const hide = useCallback((list: Notice[]) => {
    if (!list.length) return
    const now = new Date()
    setHidden((h) => { const m = new Map(h); for (const n of list) m.set(n.key, hideUntil(n.level, now)); return m })
    // One call per hiding time: day-long and week-long hides differ.
    const byUntil = new Map<string, string[]>()
    for (const n of list) { const u = hideUntil(n.level, now); byUntil.set(u, [...(byUntil.get(u) ?? []), n.key]) }
    for (const [until, keys] of byUntil) api.dismiss(keys, until).catch(() => { /* hidden on this screen; it comes back after a reload */ })
  }, [])

  return { all, shown, hide, loading, partial, reload: () => setTick((n) => n + 1), ...badge(shown) }
}
