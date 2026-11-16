import { supabase } from '../supabase'
import { readAll, countOpt } from '../readAll'
import type { AllocRow, ClosureDetail, ClosureLineRow, ClosureRow, ClosuresApi, NeedRow, RequestLineRow, RequestRow } from './api'

const db = () => {
  if (!supabase) throw new Error('No Supabase connection')
  return supabase
}
const CHUNK = 1000 // lines saved per call
const NEED_CODES = 400 // item numbers asked about per call, so each stays well inside the database's time limit

/** The database's own message is plain English (it was written for this), so it is shown as it is. */
const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message) }
const num = (v: unknown) => Number(v ?? 0)
const chunks = <T>(list: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out }

const requestRow = (r: RequestRow): RequestRow => ({ ...r, round: num(r.round) })
const requestLine = (l: RequestLineRow): RequestLineRow => ({ ...l, qty_requested: num(l.qty_requested), qty_accepted: l.qty_accepted === null ? null : num(l.qty_accepted), unit_cost: num(l.unit_cost) })

export const supabaseClosuresApi: ClosuresApi = {
  async opsStores() {
    const { data, error } = await db().from('stores_basic').select('id,name,code,active').order('name')
    fail(error)
    return (data ?? []) as { id: string; name: string; code: string; active: boolean }[]
  },

  async knownCodes(codes) {
    const known = new Set<string>()
    for (const part of chunks([...new Set(codes)], 200)) {
      const { data, error } = await db().from('items').select('code').in('code', part)
      fail(error)
      for (const r of (data ?? []) as { code: string }[]) known.add(r.code)
    }
    return known
  },

  async opsStock(storeId, codes) {
    const out = new Map<string, { inventory: number; cost: number }>()
    for (const part of chunks([...new Set(codes)], NEED_CODES)) {
      const { data, error } = await db().rpc('ops_store_stock', { p_store: storeId, p_codes: part })
      fail(error)
      for (const r of (data ?? []) as { item_code: string; inventory: number | string; store_cost: number | string }[]) out.set(r.item_code, { inventory: num(r.inventory), cost: num(r.store_cost) })
    }
    return out
  },

  async list() {
    const { data, error } = await db().from('closures').select('*').order('created_at', { ascending: false })
    fail(error)
    return (data ?? []) as ClosureRow[]
  },

  async get(id): Promise<ClosureDetail> {
    const [c, lines, stores, alloc, reqs] = await Promise.all([
      db().from('closures').select('*').eq('id', id).single(),
      readAll<ClosureLineRow>((from, to, count) => db().from('closure_lines').select('*', countOpt(count)).eq('closure_id', id).order('item_code').range(from, to)),
      db().from('closure_stores').select('store_id').eq('closure_id', id),
      readAll<AllocRow>((from, to, count) => db().from('closure_alloc').select('*', countOpt(count)).eq('closure_id', id).order('store_id').order('item_code').range(from, to)),
      db().from('transfer_requests').select('*').eq('closure_id', id).order('sent_at'),
    ])
    fail(c.error); fail(stores.error); fail(reqs.error)
    const requests = ((reqs.data ?? []) as RequestRow[]).map(requestRow)
    let requestLines: RequestLineRow[] = []
    if (requests.length) {
      const ids = requests.map((r) => r.id)
      requestLines = (await readAll<RequestLineRow>((from, to, count) => db().from('transfer_request_lines').select('*', countOpt(count)).in('request_id', ids).order('request_id').order('item_code').range(from, to))).map(requestLine)
    }
    return {
      closure: c.data as ClosureRow,
      lines: lines.map((l) => ({ ...l, qty: num(l.qty), system_qty: l.system_qty === null ? null : num(l.system_qty), unit_cost: num(l.unit_cost) })),
      participants: ((stores.data ?? []) as { store_id: string }[]).map((s) => s.store_id),
      alloc: alloc.map((a) => ({ ...a, qty: num(a.qty), suggested_qty: num(a.suggested_qty) })),
      requests, requestLines,
    }
  },

  async create(storeId, name, file) {
    const { data, error } = await db().rpc('create_closure', { p_store: storeId, p_name: name, p_file: file })
    fail(error)
    return data as ClosureRow
  },

  async addLines(id, lines, onProgress) {
    let done = 0
    for (const part of chunks(lines, CHUNK)) {
      const { error } = await db().rpc('add_closure_lines', { p_closure: id, p_lines: part })
      fail(error)
      done += part.length
      onProgress?.(done)
    }
  },

  async setStores(id, stores) {
    const { error } = await db().rpc('set_closure_stores', { p_closure: id, p_stores: stores })
    fail(error)
  },

  async need(stores, codes, excludeClosure) {
    const out: NeedRow[] = []
    for (const part of chunks([...new Set(codes)], NEED_CODES)) {
      const { data, error } = await db().rpc('closure_need', { p_stores: stores, p_items: part, p_exclude_closure: excludeClosure ?? null })
      fail(error)
      for (const r of (data ?? []) as NeedRow[]) out.push({ ...r, rate: num(r.rate), have: num(r.have), wanted: num(r.wanted), shortfall: num(r.shortfall), cost: num(r.cost) })
    }
    return out
  },

  async saveAlloc(id, rows) {
    for (const part of chunks(rows, CHUNK)) {
      const { error } = await db().rpc('save_closure_alloc', { p_closure: id, p_rows: part })
      fail(error)
    }
  },

  async send(id) {
    const { data, error } = await db().rpc('send_closure', { p_closure: id })
    fail(error)
    return (data ?? []) as string[]
  },

  async cancelRequest(requestId) { fail((await db().rpc('cancel_request', { p_request: requestId })).error) },
  async deleteClosure(id) { fail((await db().rpc('delete_closure', { p_closure: id })).error) },

  async reoffer(id, rows) {
    const { data, error } = await db().rpc('reoffer_lines', { p_closure: id, p_rows: rows })
    fail(error)
    return (data ?? []) as string[]
  },

  async incoming(storeIds) {
    if (!storeIds.length) return { requests: [], lines: [] }
    const reqs = await readAll<RequestRow>((from, to, count) => db().from('transfer_requests').select('*', countOpt(count)).in('to_store_id', storeIds).order('sent_at', { ascending: false }).order('id').range(from, to))
    if (!reqs.length) return { requests: [], lines: [] }
    const ids = reqs.map((r) => r.id)
    const lines = await readAll<RequestLineRow>((from, to, count) => db().from('transfer_request_lines').select('*', countOpt(count)).in('request_id', ids).order('request_id').order('item_code').range(from, to))
    return { requests: reqs.map(requestRow), lines: lines.map(requestLine) }
  },

  async respond(requestId, accept, lines, reason) {
    const { error } = await db().rpc('respond_request', { p_request: requestId, p_accept: accept, p_lines: lines, p_reason: reason })
    fail(error)
  },
  async markCopied(requestId) { fail((await db().rpc('mark_request_copied', { p_request: requestId })).error) },
  async markReceived(requestId) { fail((await db().rpc('mark_request_received', { p_request: requestId })).error) },

  subscribe(onChange) {
    // Any change to a request reloads the screen's list, and so does the connection coming back, so a missed change is never missed for long.
    const channel = db().channel('transfer-requests-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfer_requests' }, onChange)
      .subscribe((status) => { if (status === 'SUBSCRIBED') onChange() })
    return () => { void db().removeChannel(channel) }
  },
}
