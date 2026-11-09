import { describe, expect, it } from 'vitest'
import { badge, buildNotices, hideUntil, lastSunday, salesWeekMissing, visible, type NoticeInput } from './notifications'

const now = new Date(2026, 10, 11, 10, 0) // Wednesday 11 Nov 2026
const base = (over: Partial<NoticeInput> = {}): NoticeInput => ({
  now, isAdmin: false, stores: [{ id: 's1', name: 'Artarmon' }], customerOrders: [], lowStock: [], newItems: [], orders: [], overdue: [], syncs: [], ...over,
})
const fresh = { store_id: 's1', finished_at: new Date(2026, 10, 11, 6, 0).toISOString(), ok: true, message: null }

describe('buildNotices', () => {
  it('says nothing when there is nothing to say', () => {
    expect(buildNotices(base({ syncs: [fresh] }))).toEqual([])
  })

  it('a waiting customer is urgent and goes to the vendor that supplies the item', () => {
    const n = buildNotices(base({ customerOrders: [{ id: 'd1', store_id: 's1', doc_number: 'CO-1', customer_name: 'Mia Chen', created_at: '', lines: [{ code: 'A', qty: 2, description: 'Tumbler', vendor: 'ANAS001' }] }] }))
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ level: 'bad', key: 'co:d1', go: { view: 'order', vendor: 'ANAS001', storeId: 's1' } })
    expect(n[0].detail).toContain('2 × Tumbler')
  })

  it('low stock and new items are counted per vendor and open the Order tab filtered', () => {
    const n = buildNotices(base({ lowStock: [{ store_id: 's1', vendor_no: 'V1', items: 12 }], newItems: [{ store_id: 's1', vendor_no: 'V1', items: 1 }] }))
    expect(n.map((x) => x.title)).toEqual(['12 items low at V1', '1 new item in V1'])
    expect(n[0].go).toMatchObject({ show: 'low' })
    expect(n[1]).toMatchObject({ level: 'info', go: { show: 'new' } })
  })

  it('names the store only when the person has more than one', () => {
    const two = base({ stores: [{ id: 's1', name: 'Artarmon' }, { id: 's2', name: 'Aspley' }], lowStock: [{ store_id: 's2', vendor_no: 'V1', items: 3 }] })
    expect(buildNotices(two)[0].title).toBe('3 items low at V1 at Aspley')
  })

  it('flags an order copied two or more days ago and not marked ordered, but not a recent one', () => {
    const old = new Date(2026, 10, 8).toISOString()
    const recent = new Date(2026, 10, 10).toISOString()
    const n = buildNotices(base({ orders: [{ store_id: 's1', vendor_no: 'V1', status: 'copied', copied_at: old }, { store_id: 's1', vendor_no: 'V2', status: 'copied', copied_at: recent }, { store_id: 's1', vendor_no: 'V3', status: 'ordered', copied_at: old }] }))
    expect(n.map((x) => x.key)).toEqual(['copied:s1:V1'])
    expect(n[0].title).toContain('3 days ago')
  })

  it('adds overdue invoices per store with the total', () => {
    const n = buildNotices(base({ overdue: [{ store_id: 's1', doc_number: 'INV-1', customer_name: 'Al', balance_cents: 10000, due_date: '2026-11-01' }, { store_id: 's1', doc_number: 'INV-2', customer_name: 'Bo', balance_cents: 5050, due_date: '2026-11-05' }] }))
    expect(n[0]).toMatchObject({ level: 'bad', title: '2 invoices overdue' })
    expect(n[0].detail).toContain('$150.50')
    expect(n[0].detail).toContain('INV-1')
  })

  it('warns a store about stale stock, but is quiet about a store that has never synced', () => {
    const old = { ...fresh, finished_at: new Date(2026, 10, 8, 6, 0).toISOString() }
    expect(buildNotices(base({ syncs: [old] })).map((x) => x.key)).toEqual(['stale:s1'])
    expect(buildNotices(base({ syncs: [] }))).toEqual([])
    expect(buildNotices(base({ syncs: [fresh] }))).toEqual([])
  })

  it('gives the admin one line for failed syncs and one for stale stores, not one per store', () => {
    const stores = [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }, { id: 's3', name: 'C' }]
    const n = buildNotices(base({ isAdmin: true, stores, syncs: [{ ...fresh, store_id: 's1', ok: false, message: 'feed empty' }, { ...fresh, store_id: 's2', ok: false, message: 'x' }, { ...fresh, store_id: 's3', finished_at: new Date(2026, 10, 5).toISOString() }] }))
    expect(n.map((x) => x.key)).toEqual(['syncfail', 'stale'])
    expect(n[0].title).toBe('The NAV sync failed for 2 stores')
  })

  it('admin extras: late Sales reports and the worst unusual-activity findings, capped', () => {
    const f = (sev: 'high' | 'medium' | 'low', t: string) => ({ severity: sev, who: 'x@hsw.com.au', title: t, detail: 'd', at: '' })
    const n = buildNotices(base({ isAdmin: true, salesWeekEnds: ['2026-11-01'], findings: [f('high', 'H'), f('medium', 'M1'), f('medium', 'M2'), f('medium', 'M3'), f('low', 'L')] }))
    expect(n.find((x) => x.key.startsWith('salesweek'))?.level).toBe('warn')
    expect(n.filter((x) => x.key.startsWith('finding:'))).toHaveLength(3)
    expect(n.find((x) => x.key === 'findings:more')?.title).toBe('1 more to look at in Analytics')
    expect(buildNotices(base({ isAdmin: false, salesWeekEnds: ['2026-11-01'] }))).toEqual([])
  })

  it('orders urgent first, then things to check, then information', () => {
    const n = buildNotices(base({
      newItems: [{ store_id: 's1', vendor_no: 'V', items: 1 }], lowStock: [{ store_id: 's1', vendor_no: 'V', items: 2 }],
      overdue: [{ store_id: 's1', doc_number: 'I', customer_name: 'C', balance_cents: 100, due_date: '2026-11-01' }],
    }))
    expect(n.map((x) => x.level)).toEqual(['bad', 'warn', 'info'])
  })
})

describe('keeping the list short', () => {
  const many = (n: number) => Array.from({ length: n }, (_, k) => ({ store_id: 's1', vendor_no: 'V' + k, items: n - k }))
  it('lists the biggest few vendors and sums the rest into one line', () => {
    const n = buildNotices(base({ lowStock: many(6), newItems: many(4) }))
    const low = n.filter((x) => x.key.startsWith('low:'))
    expect(low.map((x) => x.title)).toEqual(['6 items low at V0', '5 items low at V1', '4 items low at V2', '3 items low at V3', '2 more vendors with items running low'])
    expect(low.at(-1)?.detail).toContain('3 items in all')
    expect(n.filter((x) => x.key.startsWith('new:')).map((x) => x.title)).toEqual(['4 new items in V0', '3 new items in V1', '2 more vendors with new items'])
  })
  it('does not add a summary line when everything fits', () => {
    expect(buildNotices(base({ lowStock: many(4) })).some((x) => x.key === 'low:more')).toBe(false)
  })
})

describe('Sales week timing', () => {
  it('finds the last Sunday before today', () => {
    expect(lastSunday(new Date(2026, 10, 11))).toBe('2026-11-08') // Wednesday
    expect(lastSunday(new Date(2026, 10, 8))).toBe('2026-11-01') // on a Sunday: the one before
  })
  it('flags a missing week from Tuesday, not on Monday, and not when it is loaded', () => {
    expect(salesWeekMissing(['2026-11-01'], new Date(2026, 10, 11))).toBe('2026-11-08')
    expect(salesWeekMissing(['2026-11-08'], new Date(2026, 10, 11))).toBeNull()
    expect(salesWeekMissing(['2026-11-01'], new Date(2026, 10, 9))).toBeNull() // Monday: reports are still coming
    expect(salesWeekMissing([], new Date(2026, 10, 11))).toBeNull()
  })
})

describe('hiding', () => {
  const list = buildNotices(base({ lowStock: [{ store_id: 's1', vendor_no: 'V', items: 2 }], newItems: [{ store_id: 's1', vendor_no: 'V', items: 1 }] }))
  it('hides what is dismissed until its time, then shows it again', () => {
    const hidden = new Map([['low:s1:V', new Date(2026, 10, 12, 10).toISOString()]])
    expect(visible(list, hidden, now).map((n) => n.key)).toEqual(['new:s1:V'])
    expect(visible(list, hidden, new Date(2026, 10, 12, 10, 1)).map((n) => n.key)).toEqual(['low:s1:V', 'new:s1:V'])
  })
  it('information stays hidden for a week, anything else for a day', () => {
    expect(new Date(hideUntil('warn', now)).getTime() - now.getTime()).toBe(24 * 36e5)
    expect(new Date(hideUntil('info', now)).getTime() - now.getTime()).toBe(24 * 7 * 36e5)
  })
  it('the badge counts what is showing and whether any is urgent', () => {
    expect(badge(list)).toEqual({ count: 2, urgent: false })
    expect(badge([])).toEqual({ count: 0, urgent: false })
  })
})
