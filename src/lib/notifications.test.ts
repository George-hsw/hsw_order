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

  it('tells operations when a store answers or receives, for a week', () => {
    const ref = (id: string, status: string, daysAgo: number, reason = '') => ({ id, closure_name: 'Parramatta closure', from_store_name: 'Parramatta', to_store_name: 'Artarmon', status, decline_reason: reason, at: new Date(2026, 10, 11 - daysAgo, 9, 0).toISOString() })
    const n = buildNotices(base({ stores: [], opsRequests: [ref('a', 'accepted', 1), ref('b', 'declined', 2, 'No room'), ref('c', 'received', 0), ref('d', 'accepted', 9), ref('e', 'sent', 0)] }))
    expect(n.map((x) => x.key)).toEqual(['closure:b:declined', 'closure:a:accepted', 'closure:c:received'])
    expect(n[1]).toMatchObject({ level: 'info', title: 'Artarmon accepted stock from Parramatta', go: { view: 'closures' } })
    expect(n[0]).toMatchObject({ level: 'warn' })
    expect(n[0].detail).toContain('No room')
    expect(buildNotices(base({ stores: [], opsRequests: [] }))).toEqual([])
  })

  it('a waiting customer is urgent and goes to the vendor that supplies the item', () => {
    const n = buildNotices(base({ customerOrders: [{ id: 'd1', store_id: 's1', doc_number: 'CO-1', customer_name: 'Mia Chen', created_at: '', lines: [{ code: 'A', qty: 2, description: 'Tumbler', vendor: 'ANAS001' }] }] }))
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ level: 'bad', key: 'co:d1', go: { view: 'order', vendor: 'ANAS001', storeId: 's1' } })
    expect(n[0].detail).toContain('2 × A Tumbler')
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

describe('what needs ordering', () => {
  const need = (vendor: string, items: number, cost: number, customers = 0, held = 0) => ({ store_id: 's1', vendor_no: vendor, items, units: items * 2, cost, held, customers })
  it('is one notice for each vendor, biggest first, and a customer waiting makes it urgent', () => {
    const n = buildNotices(base({ orderNeeds: [need('V1', 3, 120), need('V2', 5, 900), need('V3', 1, 40, 1)] }))
    expect(n.map((x) => x.key)).toEqual(['need:s1:V3', 'need:s1:V2', 'need:s1:V1']) // urgent first, then by cost
    expect(n[0]).toMatchObject({ level: 'bad', title: '1 item to order from V3', go: { view: 'order', vendor: 'V3', storeId: 's1' } })
    expect(n[1].detail).toContain('$900.00')
    expect(n[0].detail).toContain('1 item for waiting customers')
  })
  it('replaces the low-stock lines when it is there, and the low-stock lines are used when it is not', () => {
    const low = [{ store_id: 's1', vendor_no: 'V1', items: 4 }]
    expect(buildNotices(base({ lowStock: low, orderNeeds: [need('V1', 2, 50)] })).map((x) => x.key)).toEqual(['need:s1:V1'])
    expect(buildNotices(base({ lowStock: low, orderNeeds: null })).map((x) => x.key)).toEqual(['low:s1:V1'])
  })
  it('keeps the list short: the biggest few vendors, then one line for the rest', () => {
    const many = Array.from({ length: 6 }, (_, k) => need('V' + k, 6 - k, (6 - k) * 100))
    const n = buildNotices(base({ orderNeeds: many })).filter((x) => x.key.startsWith('need:'))
    expect(n.map((x) => x.title)).toEqual(['6 items to order from V0', '5 items to order from V1', '4 items to order from V2', '3 items to order from V3', '2 more vendors need ordering'])
    expect(n.at(-1)?.detail).toContain('3 items in all')
  })
  it('says nothing for a vendor with only items for the person to decide', () => {
    expect(buildNotices(base({ orderNeeds: [need('V1', 0, 0, 0, 2)] }))).toEqual([])
  })
  it('holds back a suggestion under the vendor’s minimum order value, but not one that reaches it', () => {
    const n = buildNotices(base({ orderNeeds: [need('ANAS001', 3, 600), need('KESR001', 3, 300), need('V1', 2, 20)] })) // ANA needs 750, KES 300, V1 has none
    expect(n.map((x) => x.key)).toEqual(['need:s1:KESR001', 'need:s1:V1'])
  })
  it('does not hold back under-minimum needs when a customer is waiting', () => {
    expect(buildNotices(base({ orderNeeds: [need('ANAS001', 1, 40, 1)] })).map((x) => x.key)).toEqual(['need:s1:ANAS001'])
  })
  it('counts an open order for the vendor towards the minimum', () => {
    const open = (cost: number) => [{ store_id: 's1', vendor_no: 'ANAS001', status: 'open', copied_at: null, cost }]
    expect(buildNotices(base({ orderNeeds: [need('ANAS001', 1, 40)], orders: open(400) })).map((x) => x.key)).toEqual([]) // 440 of 750: still held
    expect(buildNotices(base({ orderNeeds: [need('ANAS001', 1, 40)], orders: open(710) })).map((x) => x.key)).toEqual(['need:s1:ANAS001']) // 750 reached
  })
})

describe('stock offered by a closing store', () => {
  const base = { now: new Date('2026-11-05T01:00:00Z'), isAdmin: false, stores: [{ id: 's1', name: 'Alpha' }], customerOrders: [], lowStock: [], newItems: [], orders: [], overdue: [], syncs: [] }
  it('raises one notice for each request still waiting for an answer, pointing at Transfers', () => {
    const n = buildNotices({ ...base, transfers: [{ id: 'r1', store_id: 's1', from_store_name: 'Parramatta', lines: 3, units: 14 }, { id: 'r2', store_id: 's1', from_store_name: 'Penrith', lines: 1, units: 1 }] })
    const t = n.filter((x) => x.group === 'Transfers')
    expect(t.map((x) => x.key)).toEqual(['transfer:r1', 'transfer:r2'])
    expect(t[0]).toMatchObject({ level: 'warn', title: 'Stock transfer from Parramatta to copy', go: { view: 'transfers', storeId: 's1' } })
    expect(t[0].detail).toBe('3 items, 14 units to receive. Copy it into NAV, then mark it done.')
    expect(t[1].detail).toBe('1 item, 1 unit to receive. Copy it into NAV, then mark it done.')
  })
  it('names the store when the person works in more than one', () => {
    const n = buildNotices({ ...base, stores: [{ id: 's1', name: 'Alpha' }, { id: 's2', name: 'Beta' }], transfers: [{ id: 'r1', store_id: 's2', from_store_name: 'Parramatta', lines: 2, units: 5 }] })
    expect(n.find((x) => x.key === 'transfer:r1')?.title).toBe('Stock transfer from Parramatta at Beta to copy')
  })
  it('asks a store to order items when there is no sending store', () => {
    const n = buildNotices({ ...base, transfers: [{ id: 'r1', store_id: 's1', from_store_name: '', lines: 2, units: 9 }] })
    const t = n.filter((x) => x.group === 'Transfers')
    expect(t[0]).toMatchObject({ title: 'Management asks you to order items', go: { view: 'transfers', storeId: 's1' } })
    expect(t[0].detail).toContain('9 units to order')
    const ops = buildNotices({ ...base, stores: [], opsRequests: [{ id: 'q', closure_name: 'Spring push', from_store_name: '', to_store_name: 'Artarmon', status: 'accepted', decline_reason: '', at: new Date(2026, 10, 11, 9).toISOString() }] })
    expect(ops[0].title).toBe('Artarmon accepted your request to order items')
  })

  it('says nothing when there are none', () => {
    expect(buildNotices({ ...base }).some((x) => x.group === 'Transfers')).toBe(false)
    expect(buildNotices({ ...base, transfers: [] }).some((x) => x.group === 'Transfers')).toBe(false)
  })
})

describe('summary notices for operations and admin', () => {
  const co = (id: string, store: string) => ({ id, store_id: store, doc_number: id, customer_name: 'A', created_at: '', lines: [{ code: 'A', qty: 1, description: 'T', vendor: 'V1' }] })
  const inv = (n: string, store: string, cents: number) => ({ store_id: store, doc_number: n, customer_name: 'A', balance_cents: cents, due_date: '2026-11-01' })
  const stores = [{ id: 's1', name: 'Alpha' }, { id: 's2', name: 'Beta' }]
  it('counts customer orders and overdue invoices instead of listing each', () => {
    const n = buildNotices(base({ summary: true, stores, customerOrders: [co('c1', 's1'), co('c2', 's2'), co('c3', 's2')], overdue: [inv('I1', 's1', 10000), inv('I2', 's2', 5050)] }))
    expect(n.map((x) => x.key).sort()).toEqual(['sum:customers', 'sum:overdue'])
    expect(n.find((x) => x.key === 'sum:customers')!.title).toBe('3 customer orders waiting across 2 stores')
    expect(n.find((x) => x.key === 'sum:overdue')!.detail).toContain('$150.50')
  })
  it('rolls suspicious sign-ins into one security line', () => {
    const f = (severity: 'high' | 'medium' | 'low', title: string) => ({ severity, title, who: 'x', detail: 'd', at: '2026-11-10T01:00:00Z' }) as never
    const n = buildNotices(base({ summary: true, isAdmin: true, salesWeekEnds: ['2026-11-08'], findings: [f('high', 'Signed in on 3 devices'), f('medium', 'Signed in on a new device'), f('low', 'x')] }))
    const s = n.filter((x) => x.group === 'Security')
    expect(s).toHaveLength(1)
    expect(s[0].title).toBe('2 things to review in Analytics')
    expect(s[0].level).toBe('bad')
  })
  it('leaves store users with the item-by-item lines', () => {
    expect(buildNotices(base({ customerOrders: [co('c1', 's1')] })).some((x) => x.key === 'co:c1')).toBe(true)
  })
})
