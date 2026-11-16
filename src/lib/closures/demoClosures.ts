// A made-up closure setup for `npm run demo`, kept in memory (it resets on reload). Nothing here is real.
import { demoItems, demoStock, demoStores } from '../demo'
import type { AllocRow, ClosureDetail, ClosureLineRow, ClosureRow, ClosuresApi, NeedRow, RequestLineRow, RequestRow } from './api'

const wait = <T>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(v), ms))
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 36e5).toISOString()
const stores = () => demoStores()
export const DEMO_CLOSING_STORE = 'demo-22' // shown as closed, so it is the one to pick

const items = () => demoItems().filter((i) => i.vendor_no)
let n = 100
const uid = (p: string) => p + String(++n)
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((f) => f())

const lineOf = (closure_id: string, i: { code: string; description: string; price: number | null }, qty: number): ClosureLineRow => ({ closure_id, item_code: i.code, qty, description: i.description, system_qty: qty + 2, unit_cost: Math.round(((i.price ?? 20) * 0.45) * 100) / 100 })

// One closure already sent, so a store user (try ?as=priya) has something waiting and Closures has a history.
const seedId = 'dc-seed'
const seedItems = items().slice(0, 4)
let closures: ClosureRow[] = [{ id: seedId, closing_store_id: DEMO_CLOSING_STORE, name: 'Parramatta closure', kind: 'closure', status: 'sent', source_file: 'parramatta-stock.xlsx', created_by: 'morgan@hsw.com.au', created_at: iso(30), sent_at: iso(28) }]
let lines: ClosureLineRow[] = seedItems.map((i, k) => lineOf(seedId, i, [12, 8, 10, 6][k]))
let participants = new Map<string, string[]>([[seedId, ['demo-0', 'demo-1', 'demo-2']]])
let alloc: AllocRow[] = []
const sourceName = (c: ClosureRow) => stores().find((s) => s.id === c.closing_store_id)?.name ?? '' // '' when a push has no sending store
const closingName = () => stores().find((s) => s.id === DEMO_CLOSING_STORE)?.name ?? 'Closing store'
let requests: RequestRow[] = [
  { id: 'dr-1', closure_id: seedId, from_store_id: DEMO_CLOSING_STORE, from_store_name: closingName(), to_store_id: 'demo-0', round: 1, status: 'sent', decline_reason: '', sent_at: iso(28), sent_by: 'morgan@hsw.com.au', responded_at: null, responded_by: null, copied_at: null, received_at: null, received_by: null },
  { id: 'dr-2', closure_id: seedId, from_store_id: DEMO_CLOSING_STORE, from_store_name: closingName(), to_store_id: 'demo-1', round: 1, status: 'accepted', decline_reason: '', sent_at: iso(28), sent_by: 'morgan@hsw.com.au', responded_at: iso(20), responded_by: 'sam@hsw.com.au', copied_at: null, received_at: null, received_by: null },
  { id: 'dr-3', closure_id: seedId, from_store_id: DEMO_CLOSING_STORE, from_store_name: closingName(), to_store_id: 'demo-2', round: 1, status: 'declined', decline_reason: 'No room until the new shelving is in', sent_at: iso(28), sent_by: 'morgan@hsw.com.au', responded_at: iso(22), responded_by: 'lee@hsw.com.au', copied_at: null, received_at: null, received_by: null },
]
const rl = (request_id: string, k: number, req: number, acc: number | null): RequestLineRow => ({ request_id, item_code: seedItems[k].code, description: seedItems[k].description, qty_requested: req, qty_accepted: acc, unit_cost: lineOf(seedId, seedItems[k], 1).unit_cost })
let requestLines: RequestLineRow[] = [rl('dr-1', 0, 5, null), rl('dr-1', 1, 3, null), rl('dr-2', 0, 4, 4), rl('dr-2', 2, 6, 3), rl('dr-3', 1, 5, 0), rl('dr-3', 3, 6, 0)]

/** Whether a store stocks an item, and how much it falls short, in a way that is varied but always the same for the same pair. */
const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }
const shortfallFor = (store: string, code: string) => ((hash(store + code) % 5) === 0 ? 0 : 2 + (hash(code + store) % 9))

const held = (store: string, code: string, exclude?: string) => requests
  .filter((r) => r.to_store_id === store && (r.status === 'sent' || r.status === 'accepted') && r.closure_id !== exclude)
  .flatMap((r) => requestLines.filter((l) => l.request_id === r.id && l.item_code === code).map((l) => (r.status === 'accepted' ? l.qty_accepted ?? l.qty_requested : l.qty_requested)))
  .reduce((a, b) => a + b, 0)

const leftOf = (closureId: string, code: string) => {
  const sheet = lines.find((l) => l.closure_id === closureId && l.item_code === code)?.qty ?? 0
  const used = requests.filter((r) => r.closure_id === closureId).flatMap((r) => requestLines.filter((l) => l.request_id === r.id && l.item_code === code).map((l) => (r.status === 'sent' ? l.qty_requested : r.status === 'accepted' || r.status === 'received' ? l.qty_accepted ?? l.qty_requested : 0))).reduce((a, b) => a + b, 0)
  return sheet - used
}

export const demoClosuresApi: ClosuresApi = {
  async opsStores() { return wait(stores().map((s) => ({ id: s.id, name: s.name, code: s.code, active: s.id === DEMO_CLOSING_STORE ? false : s.active }))) },
  async knownCodes(codes) { const known = new Set(items().map((i) => i.code)); return wait(new Set(codes.filter((c) => known.has(c)))) },
  async opsStock(_store, codes) { return wait(new Map(codes.map((c) => [c, { inventory: 40, cost: 9 }] as const))) },
  async list() { return wait([...closures].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) },
  async opsRequests() { return wait([...requests]) },
  async requestStatuses() { return wait(requests.map((r) => ({ closure_id: r.closure_id, status: r.status }))) },
  async get(id): Promise<ClosureDetail> {
    const closure = closures.find((c) => c.id === id)
    if (!closure) throw new Error('That closure does not exist')
    const reqs = requests.filter((r) => r.closure_id === id)
    return wait({ closure, lines: lines.filter((l) => l.closure_id === id), participants: participants.get(id) ?? [], alloc: alloc.filter((a) => a.closure_id === id), requests: reqs, requestLines: requestLines.filter((l) => reqs.some((r) => r.id === l.request_id)) })
  },
  async create(storeId, name, file, kind = 'closure') {
    const c: ClosureRow = { id: uid('dc-'), closing_store_id: storeId, kind, name, status: 'draft', source_file: file, created_by: 'morgan@hsw.com.au', created_at: new Date().toISOString(), sent_at: null }
    closures = [c, ...closures]
    return wait(c)
  },
  async setLine(id, code, qty, description = '') {
    const c = closures.find((x) => x.id === id)
    if (!c) throw new Error('That closure does not exist')
    if (c.status !== 'draft') throw new Error('This list has been sent, so it can no longer change')
    if (!Number.isInteger(qty) || qty < 0) throw new Error('The quantity must be a whole number, zero or more')
    const given = alloc.filter((a) => a.closure_id === id && a.item_code === code).reduce((n, a) => n + a.qty, 0)
    if (qty < given) throw new Error(`${given} units of ${code} are already shared out to stores. Lower their quantities first.`)
    if (qty === 0) { lines = lines.filter((l) => !(l.closure_id === id && l.item_code === code)); await wait(null); return }
    const item = items().find((i) => i.code === code.trim())
    if (!item) throw new Error('That item number is not in the item list: ' + code)
    const have = lines.find((l) => l.closure_id === id && l.item_code === item.code)
    lines = have ? lines.map((l) => (l === have ? { ...l, qty } : l)) : [...lines, lineOf(id, { code: item.code, description: description || item.description, price: item.price }, qty)]
    await wait(null)
  },
  async addLines(id, newLines, onProgress) {
    const byCode = new Map(items().map((i) => [i.code, i]))
    lines = [...lines.filter((l) => l.closure_id !== id), ...newLines.filter((l) => byCode.has(l.code)).map((l) => lineOf(id, { code: l.code, description: l.description || byCode.get(l.code)!.description, price: byCode.get(l.code)!.price }, l.qty))]
    onProgress?.(newLines.length)
    await wait(null)
  },
  async setStores(id, ids) { participants.set(id, ids); await wait(null) },
  async need(storeIds, codes, excludeClosure) {
    const out: NeedRow[] = []
    for (const s of storeIds) {
      const stocked = new Set(demoStock(s).map((x) => x.item_code))
      for (const code of codes) {
        if (!stocked.has(code)) continue
        const sf = Math.max(0, shortfallFor(s, code) - held(s, code, excludeClosure))
        out.push({ store_id: s, item_code: code, rate: sf / 4, have: 2, wanted: sf + 2, shortfall: sf, cost: 9 })
      }
    }
    return wait(out)
  },
  async saveAlloc(id, rows) {
    const next = new Map(alloc.filter((a) => a.closure_id === id).map((a) => [a.store_id + '|' + a.item_code, a]))
    for (const r of rows) { if (r.qty <= 0) next.delete(r.store_id + '|' + r.item_code); else next.set(r.store_id + '|' + r.item_code, { closure_id: id, ...r }) }
    const total = new Map<string, number>()
    for (const a of next.values()) total.set(a.item_code, (total.get(a.item_code) ?? 0) + a.qty)
    const bad = [...total].filter(([code, q]) => q > (lines.find((l) => l.closure_id === id && l.item_code === code)?.qty ?? 0)).map(([code]) => code)
    if (bad.length) throw new Error('These items are given out above what the sheet holds: ' + bad.slice(0, 5).join(', '))
    alloc = [...alloc.filter((a) => a.closure_id !== id), ...next.values()]
    await wait(null, 60)
  },
  async send(id) {
    const c = closures.find((x) => x.id === id)
    if (!c) throw new Error('That closure does not exist')
    if (c.status !== 'draft') throw new Error('This closure has already been sent')
    const mine = alloc.filter((a) => a.closure_id === id && a.qty > 0)
    if (!mine.length) throw new Error('Nothing has been given to any store yet')
    const ids: string[] = []
    for (const store of new Set(mine.map((a) => a.store_id))) {
      const rid = uid('dr-')
      ids.push(rid)
      requests = [...requests, { id: rid, closure_id: id, from_store_id: c.closing_store_id, from_store_name: sourceName(c), to_store_id: store, round: 1, status: 'sent', decline_reason: '', sent_at: new Date().toISOString(), sent_by: 'morgan@hsw.com.au', responded_at: null, responded_by: null, copied_at: null, received_at: null, received_by: null }]
      for (const a of mine.filter((x) => x.store_id === store)) { const l = lines.find((x) => x.closure_id === id && x.item_code === a.item_code)!; requestLines = [...requestLines, { request_id: rid, item_code: a.item_code, description: l.description, qty_requested: a.qty, qty_accepted: null, unit_cost: l.unit_cost }] }
    }
    closures = closures.map((x) => (x.id === id ? { ...x, status: 'sent', sent_at: new Date().toISOString() } : x))
    emit()
    return wait(ids)
  },
  async cancelRequest(requestId) {
    const r = requests.find((x) => x.id === requestId)
    if (!r) throw new Error('That request does not exist')
    if (r.status !== 'sent') throw new Error('That request has been answered, so it can no longer be taken back')
    requests = requests.map((x) => (x.id === requestId ? { ...x, status: 'cancelled' } : x))
    emit(); await wait(null)
  },
  async deleteClosure(id) {
    const c = closures.find((x) => x.id === id)
    if (c && c.status !== 'draft') throw new Error('Only a closure that has not been sent can be deleted')
    closures = closures.filter((x) => x.id !== id); lines = lines.filter((l) => l.closure_id !== id); alloc = alloc.filter((a) => a.closure_id !== id)
    await wait(null)
  },
  async reoffer(id, rows) {
    const c = closures.find((x) => x.id === id)
    if (!c || c.status !== 'sent') throw new Error('Only a closure that has been sent can be offered again')
    const offered = new Map<string, number>()
    for (const r of rows) offered.set(r.item_code, (offered.get(r.item_code) ?? 0) + r.qty)
    const bad = [...offered].filter(([code, q]) => q > leftOf(id, code)).map(([code]) => code)
    if (bad.length) throw new Error('These items have less left than you are offering: ' + bad.slice(0, 5).join(', '))
    const ids: string[] = []
    for (const store of new Set(rows.map((r) => r.store_id))) {
      const rid = uid('dr-'); ids.push(rid)
      const round = Math.max(0, ...requests.filter((r) => r.closure_id === id && r.to_store_id === store).map((r) => r.round)) + 1
      requests = [...requests, { id: rid, closure_id: id, from_store_id: c.closing_store_id, from_store_name: sourceName(c), to_store_id: store, round, status: 'sent', decline_reason: '', sent_at: new Date().toISOString(), sent_by: 'morgan@hsw.com.au', responded_at: null, responded_by: null, copied_at: null, received_at: null, received_by: null }]
      for (const r of rows.filter((x) => x.store_id === store)) { const l = lines.find((x) => x.closure_id === id && x.item_code === r.item_code)!; requestLines = [...requestLines, { request_id: rid, item_code: r.item_code, description: l.description, qty_requested: r.qty, qty_accepted: null, unit_cost: l.unit_cost }] }
    }
    emit()
    return wait(ids)
  },
  async incoming(storeIds) {
    const reqs = requests.filter((r) => storeIds.includes(r.to_store_id)).sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1))
    return wait({ requests: reqs, lines: requestLines.filter((l) => reqs.some((r) => r.id === l.request_id)) })
  },
  async respond(requestId, accept, accepted, reason) {
    const r = requests.find((x) => x.id === requestId)
    if (!r) throw new Error('That request does not exist')
    if (r.status !== 'sent') throw new Error('That request has already been answered')
    const why = reason.trim()
    const mine = requestLines.filter((l) => l.request_id === requestId)
    if (accept) {
      for (const a of accepted ?? []) { const l = mine.find((x) => x.item_code === a.item_code); if (!l || a.qty_accepted < 0 || a.qty_accepted > l.qty_requested || !Number.isInteger(a.qty_accepted)) throw new Error('Each quantity must be a whole number, no more than was asked for') }
      requestLines = requestLines.map((l) => (l.request_id === requestId ? { ...l, qty_accepted: accepted?.find((a) => a.item_code === l.item_code)?.qty_accepted ?? l.qty_requested } : l))
      const any = requestLines.some((l) => l.request_id === requestId && (l.qty_accepted ?? 0) > 0)
      if (!any && !why) throw new Error('Say why none of it is wanted')
      requests = requests.map((x) => (x.id === requestId ? { ...x, status: any ? 'accepted' : 'declined', decline_reason: any ? '' : why, responded_at: new Date().toISOString(), responded_by: 'you' } : x))
    } else {
      if (!why) throw new Error('Say why it is declined')
      requestLines = requestLines.map((l) => (l.request_id === requestId ? { ...l, qty_accepted: 0 } : l))
      requests = requests.map((x) => (x.id === requestId ? { ...x, status: 'declined', decline_reason: why, responded_at: new Date().toISOString(), responded_by: 'you' } : x))
    }
    emit(); await wait(null)
  },
  async markCopied(requestId) { requests = requests.map((x) => (x.id === requestId ? { ...x, copied_at: x.copied_at ?? new Date().toISOString() } : x)); await wait(null, 30) },
  async markReceived(requestId) {
    const r = requests.find((x) => x.id === requestId)
    if (!r || r.status !== 'accepted') throw new Error('Only an accepted request can be marked received')
    requests = requests.map((x) => (x.id === requestId ? { ...x, status: 'received', received_at: new Date().toISOString(), received_by: 'you' } : x))
    emit(); await wait(null)
  },
  subscribe(onChange) { listeners.add(onChange); return () => { listeners.delete(onChange) } },
}

/** A made-up sheet for the demo, so the upload can be tried without a file: the demo items with plausible quantities. */
export const demoSheetRows = (): (string | number)[][] => [['Item No.', 'Description', 'Qty'], ...items().slice(0, 14).map((i, k) => [i.code, i.description, 6 + ((k * 7) % 31)])]
