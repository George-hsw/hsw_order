// Made-up usage for `npm run demo`, so the Analytics tab can be looked at. Nothing here is real.
import { demoStores } from '../demo'
import { KINDS, type AppEvent } from './model'

const people = ['priya@hsw.com.au', 'sam@hsw.com.au', 'lee@hsw.com.au', 'artarmon@hsw.com.au', 'aspley@hsw.com.au', 'kotara@hsw.com.au']
const devices: [string, string][] = [['Chrome on Windows', 'dev-a'], ['Safari on iPhone or iPad', 'dev-b'], ['Chrome on Android', 'dev-c'], ['Edge on Windows', 'dev-d']]

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export function demoEvents(): AppEvent[] {
  const r = rng(7)
  const stores = demoStores()
  const now = Date.now()
  const out: AppEvent[] = []
  let id = 0
  const add = (at: number, email: string, kind: string, sid: string, dev: [string, string], store: string | null, detail: Record<string, unknown> = {}) =>
    out.push({ id: ++id, at: new Date(at).toISOString(), email, store_id: store, session_id: sid, kind, detail, device: dev[0], device_id: dev[1] })
  for (let d = 60; d >= 0; d--) {
    people.forEach((email, pi) => {
      if (r() < 0.35 + (pi < 3 ? 0.3 : 0)) return
      const dev = devices[pi % 3]
      const store = stores[pi % stores.length].id
      const start = now - d * 864e5 - r() * 8 * 36e5
      const sid = `s-${d}-${pi}`
      add(start, email, KINDS.session, sid, dev, null)
      add(start + 6e4, email, KINDS.tab, sid, dev, null, { tab: 'order' })
      add(start + 12e4, email, KINDS.started, sid, dev, store, { vendor: 'ANAS001' })
      if (r() < 0.6) add(start + 6e5, email, KINDS.copied, sid, dev, store)
      if (r() < 0.3) add(start + 7e5, email, KINDS.ordered, sid, dev, store)
      if (r() < 0.25) { add(start + 8e5, email, KINDS.tab, sid, dev, null, { tab: 'sales' }); add(start + 81e4, email, KINDS.sales, sid, dev, store, { view: 'items' }) }
      if (r() < 0.06) add(start + 9e5, email, KINDS.error, sid, dev, store, { message: 'Could not load the range', where: 'load' })
      if (r() < 0.05) add(start + 95e4, email, KINDS.deleted, sid, dev, store)
    })
  }
  // A few unusual things for the demo to flag.
  const t = now - 3 * 36e5
  add(t, 'lee@hsw.com.au', KINDS.session, 'odd-1', devices[3], null)
  add(t + 6e4, 'lee@hsw.com.au', KINDS.session, 'odd-2', ['Firefox on Linux', 'dev-x'], null)
  add(t + 12e4, 'lee@hsw.com.au', KINDS.session, 'odd-3', ['Safari on Mac', 'dev-y'], null)
  for (let i = 0; i < 6; i++) add(t + i * 6e4, 'sam@hsw.com.au', KINDS.error, 'odd-4', devices[0], null, { message: 'Could not update the order', where: 'order' })
  return out.sort((a, b) => (a.at < b.at ? 1 : -1))
}
