// Store closures: what the screens ask for. Like salesApi, it is a separate small API with a real implementation (supabaseClosures.ts), a demo one
// (demoClosures.ts) and an offline stub, so the main OrdersApi stays as it is.
import { DEMO, supabase, type StoreRow } from '../supabase'
import { demoClosuresApi } from './demoClosures'
import { supabaseClosuresApi } from './supabaseClosures'

export type ClosureStatus = 'draft' | 'sent' | 'cancelled'
/** A closure moves a closing store's stock; a push sends chosen items to stores, from a sending store or from none (the stores are asked to order them). */
export type ClosureKind = 'closure' | 'push'
export type RequestStatus = 'sent' | 'accepted' | 'declined' | 'received' | 'cancelled'

export interface ClosureRow {
  id: string
  closing_store_id: string | null // the closing store; for a push, the sending store, or none
  kind: ClosureKind
  name: string
  status: ClosureStatus
  source_file: string
  created_by: string
  created_at: string
  sent_at: string | null
}
export interface ClosureLineRow { closure_id: string; item_code: string; qty: number; description: string; system_qty: number | null; unit_cost: number }
export interface AllocRow { closure_id: string; store_id: string; item_code: string; qty: number; suggested_qty: number }
export interface RequestRow {
  id: string
  closure_id: string
  from_store_id: string | null
  from_store_name: string // empty when there is no sending store: the store is asked to order the items
  to_store_id: string
  round: number
  status: RequestStatus
  decline_reason: string
  sent_at: string
  sent_by: string
  responded_at: string | null
  responded_by: string | null
  copied_at: string | null
  received_at: string | null
  received_by: string | null
}
export interface RequestLineRow { request_id: string; item_code: string; description: string; qty_requested: number; qty_accepted: number | null; unit_cost: number }
/** What a store could take of one item, worked out in the database. */
export interface NeedRow { store_id: string; item_code: string; rate: number; have: number; wanted: number; shortfall: number; cost: number }

export interface ClosureDetail {
  closure: ClosureRow
  lines: ClosureLineRow[]
  participants: string[] // store ids taking part
  alloc: AllocRow[]
  requests: RequestRow[]
  requestLines: RequestLineRow[]
}

export interface ClosuresApi {
  // ----- operations -----
  /** Every store by name and code, including one that has closed: the closing store is one of them. */
  opsStores(): Promise<Pick<StoreRow, 'id' | 'name' | 'code' | 'active'>[]>
  /** Which of these item numbers are in the item list. */
  knownCodes(codes: string[]): Promise<Set<string>>
  /** The closing store's stock for these item numbers, to warn when the sheet holds more than the system says. */
  opsStock(storeId: string, codes: string[]): Promise<Map<string, { inventory: number; cost: number }>>
  list(): Promise<ClosureRow[]>
  /** Every request to every store, for the operations bell: who answered, and when. */
  opsRequests(): Promise<RequestRow[]>
  /** The status of every request, to show how far each closure has got. */
  requestStatuses(): Promise<{ closure_id: string; status: RequestStatus }[]>
  get(id: string): Promise<ClosureDetail>
  create(storeId: string | null, name: string, file: string, kind?: ClosureKind): Promise<ClosureRow>
  /** Add, change or remove (quantity 0) one line of a draft by hand. */
  setLine(id: string, code: string, qty: number, description?: string): Promise<void>
  addLines(id: string, lines: { code: string; qty: number; description: string }[], onProgress?: (done: number) => void): Promise<void>
  setStores(id: string, stores: string[]): Promise<void>
  need(stores: string[], codes: string[], excludeClosure?: string): Promise<NeedRow[]>
  saveAlloc(id: string, rows: { store_id: string; item_code: string; qty: number; suggested_qty: number }[]): Promise<void>
  send(id: string): Promise<string[]>
  cancelRequest(requestId: string): Promise<void>
  deleteClosure(id: string): Promise<void>
  reoffer(id: string, rows: { store_id: string; item_code: string; qty: number }[]): Promise<string[]>
  // ----- the receiving store -----
  incoming(storeIds: string[]): Promise<{ requests: RequestRow[]; lines: RequestLineRow[] }>
  respond(requestId: string, accept: boolean, lines: { item_code: string; qty_accepted: number }[] | null, reason: string): Promise<void>
  markCopied(requestId: string): Promise<void>
  markReceived(requestId: string): Promise<void>
  /** Calls back whenever a request changes (and once when the connection comes back). Returns the way to stop. */
  subscribe(onChange: () => void): () => void
}

const notConnected = (): never => { throw new Error('The back end is not connected yet.') }
const offline: ClosuresApi = {
  opsStores: async () => notConnected(), knownCodes: async () => notConnected(), opsStock: async () => notConnected(), list: async () => notConnected(), opsRequests: async () => notConnected(), requestStatuses: async () => notConnected(), get: async () => notConnected(),
  create: async () => notConnected(), setLine: async () => notConnected(), addLines: async () => notConnected(), setStores: async () => notConnected(), need: async () => notConnected(), saveAlloc: async () => notConnected(),
  send: async () => notConnected(), cancelRequest: async () => notConnected(), deleteClosure: async () => notConnected(), reoffer: async () => notConnected(),
  incoming: async () => notConnected(), respond: async () => notConnected(), markCopied: async () => notConnected(), markReceived: async () => notConnected(),
  subscribe: () => notConnected(),
}

export const closuresApi: ClosuresApi = DEMO ? demoClosuresApi : supabase ? supabaseClosuresApi : offline
