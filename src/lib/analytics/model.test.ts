import { describe, expect, it } from 'vitest'
import { byHour, byStore, daily, dayKey, findings, hourOf, quietPeople, summarise, topErrors, userRows, type AppEvent } from './model'

let id = 0
const ev = (over: Partial<AppEvent>): AppEvent => ({ id: ++id, at: '2026-11-05T01:00:00Z', email: 'a@hsw.com.au', store_id: null, session_id: 's1', kind: 'tab_view', detail: {}, device: 'Chrome on Windows', device_id: 'd1', ...over })
const NOW = new Date('2026-11-05T06:00:00Z') // 5pm Thursday in Sydney (daylight time)

describe('time in Sydney', () => {
  it('turns a UTC time into the Sydney day and hour', () => {
    expect(dayKey('2026-11-04T14:30:00Z')).toBe('2026-11-05') // 1:30am the next day
    expect(hourOf('2026-11-04T14:30:00Z')).toBe(1)
  })
})

describe('summary', () => {
  const events = [ev({ kind: 'session_start' }), ev({ kind: 'order_copied' }), ev({ kind: 'order_deleted', email: 'b@hsw.com.au', session_id: 's2' }), ev({ kind: 'error', detail: { message: 'x' } }), ev({ kind: 'order_started' }), ev({ kind: 'order_ordered' })]
  it('counts people, sessions and what they did', () => {
    expect(summarise(events)).toEqual({ users: 2, sessions: 2, started: 1, copied: 1, ordered: 1, deleted: 1, errors: 1, events: 6 })
  })
  it('lists each of the last days, including quiet ones', () => {
    const d = daily([ev({ at: '2026-11-05T02:00:00Z' }), ev({ at: '2026-11-05T03:00:00Z', email: 'b@hsw.com.au' }), ev({ at: '2026-11-03T02:00:00Z', kind: 'order_copied' })], 3, NOW)
    expect(d.map((x) => x.day)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05'])
    expect(d.map((x) => x.users)).toEqual([1, 0, 2])
    expect(d[0].copied).toBe(1)
  })
  it('counts sign-ins by hour', () => {
    const h = byHour([ev({ kind: 'session_start', at: '2026-11-04T14:30:00Z' }), ev({ kind: 'session_start', at: '2026-11-04T14:40:00Z' }), ev({ kind: 'tab_view', at: '2026-11-04T14:40:00Z' })])
    expect(h[1]).toBe(2)
    expect(h.reduce((a, b) => a + b, 0)).toBe(2)
  })
  it('ranks stores and people', () => {
    const e = [ev({ store_id: 's1' }), ev({ store_id: 's1', kind: 'order_copied' }), ev({ store_id: 's2', email: 'b@hsw.com.au' })]
    expect(byStore(e)).toMatchObject([{ store_id: 's1', events: 2, users: 1, copied: 1 }, { store_id: 's2', events: 1 }])
    const rows = userRows([ev({ at: '2026-11-01T00:00:00Z' }), ev({ at: '2026-11-04T00:00:00Z', email: 'b@hsw.com.au', device: 'Safari on iPhone', detail: { tab: 'order' } })], [{ email: 'a@hsw.com.au', name: 'Ann', active: true }])
    expect(rows.map((r) => r.name)).toEqual(['b@hsw.com.au', 'Ann']) // newest first; unknown emails shown as they are
    expect(rows[0].device).toBe('Safari on iPhone')
  })
  it('finds accounts that have never been used', () => {
    const people = [{ email: 'a@hsw.com.au', name: 'A', active: true }, { email: 'c@hsw.com.au', name: 'C', active: true }, { email: 'd@hsw.com.au', name: 'D', active: false }]
    expect(quietPeople([ev({})], people).map((p) => p.name)).toEqual(['C'])
  })
})

describe('unusual activity', () => {
  const at = (h: number, m = 0) => `2026-11-05T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
  it('says nothing about an ordinary day', () => {
    expect(findings([ev({ kind: 'session_start', at: at(1) }), ev({ kind: 'order_copied', at: at(2) })], NOW)).toEqual([])
  })
  it('flags a device the person has not used before', () => {
    const f = findings([ev({ kind: 'session_start', at: '2026-10-20T01:00:00Z' }), ev({ kind: 'session_start', at: at(2), device: 'Firefox on Linux', device_id: 'd2' })], NOW)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'medium', title: 'Signed in on a new device', who: 'a@hsw.com.au' })
  })
  it('does not flag a first ever sign-in as a new device', () => {
    expect(findings([ev({ kind: 'session_start', at: at(2) })], NOW)).toEqual([])
  })
  it('flags three devices in a day as high', () => {
    const f = findings(['d1', 'd2', 'd3'].map((d, i) => ev({ kind: 'session_start', at: at(1 + i), device_id: d, device: d, session_id: d })), NOW)
    expect(f.some((x) => x.severity === 'high' && x.title.includes('3 different devices'))).toBe(true)
  })
  it('flags overnight sign-ins in Sydney time', () => {
    const f = findings([ev({ kind: 'session_start', at: '2026-11-04T15:30:00Z' })], NOW) // 2:30am
    expect(f.map((x) => x.title)).toContain('Signed in overnight')
  })
  it('flags bursts, error spikes and many deletes', () => {
    const burst = Array.from({ length: 8 }, (_, i) => ev({ kind: 'session_start', at: at(2, i), session_id: 'b' + i }))
    const errs = Array.from({ length: 5 }, (_, i) => ev({ kind: 'error', at: at(3, i), detail: { message: 'boom' } }))
    const dels = Array.from({ length: 5 }, (_, i) => ev({ kind: 'order_deleted', at: at(4, i) }))
    const titles = findings([...burst, ...errs, ...dels], NOW).map((x) => x.title)
    expect(titles).toContain('8 sign-ins within an hour')
    expect(titles).toContain('5 errors')
    expect(titles).toContain('5 orders deleted')
  })
  it('puts the most serious first and ignores events older than the window', () => {
    const f = findings([ev({ kind: 'session_start', at: '2026-11-04T15:30:00Z' }), ...['d1', 'd2', 'd3'].map((d) => ev({ kind: 'session_start', at: at(2), device_id: d, device: d, session_id: d })), ev({ kind: 'error', at: '2026-10-01T00:00:00Z' })], NOW)
    expect(f[0].severity).toBe('high')
    expect(f.every((x) => x.title !== '1 errors')).toBe(true)
  })
  it('lists the most common errors with how many people hit them', () => {
    const e = [ev({ kind: 'error', detail: { message: 'A', where: 'order' } }), ev({ kind: 'error', detail: { message: 'A' }, email: 'b@hsw.com.au' }), ev({ kind: 'error', detail: { message: 'B' } })]
    expect(topErrors(e)).toMatchObject([{ message: 'A', count: 2, people: 2 }, { message: 'B', count: 1 }])
  })
})
