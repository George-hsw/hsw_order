import { applyLine, type LineInput } from './order'
import { DEMO, supabase, type ItemRow, type OrderLine, type OrderRow, type OrderStatus, type OrderSummary, type StockRow, type SyncRun } from './supabase'
import { demoApi } from './demoApi'
import { supabaseApi } from './supabaseApi'

/** syncedAt: when this store's stock was last read from NAV (the last successful sync), not when a row last changed. */
export interface Catalogue { items: ItemRow[]; stock: StockRow[]; syncedAt?: string }
export interface OrderData { order: OrderRow; lines: OrderLine[] }

/** Thrown when someone else changed the same line since this screen loaded it. */
export class ConflictError extends Error {
  constructor(public current: OrderLine | undefined) { super('Someone else changed this line.') }
}

/**
 * Everything the screens need from the back end. `demoApi` runs it in memory for `npm run demo`; `supabaseApi` talks to
 * Supabase (Row Level Security, the order functions, Realtime). The screens do not know which one they have.
 */
export interface OrdersApi {
  catalogue(storeId: string): Promise<Catalogue>
  /** The store's current order (open or copied but not yet ordered in NAV), started if there is none. */
  openOrder(storeId: string, email: string): Promise<OrderData>
  /** Set an item's line to an absolute quantity (0 removes it). `baseRevision` is the revision this screen last saw (0 = no line yet). */
  saveLine(orderId: string, email: string, input: LineInput, baseRevision: number): Promise<OrderLine[]>
  /** Called with the full set of lines whenever any device changes them. Returns an unsubscribe. */
  subscribe(orderId: string, onLines: (lines: OrderLine[]) => void): () => void
  setStatus(orderId: string, status: OrderStatus, navRef?: string): Promise<OrderRow>
  listOrders(storeIds: string[]): Promise<OrderSummary[]>
  orderLines(orderId: string): Promise<OrderLine[]>
  /** Every line on every order for these stores, for reports. */
  reportLines(storeIds: string[]): Promise<{ order: OrderRow; lines: OrderLine[] }[]>
  /** Latest sync result per store (admin). */
  syncRuns(): Promise<SyncRun[]>
}

const notConnected = (): never => { throw new Error('The back end is not connected yet.') }
const offline: OrdersApi = {
  catalogue: async () => notConnected(), openOrder: async () => notConnected(), saveLine: async () => notConnected(),
  subscribe: () => notConnected(), setStatus: async () => notConnected(), listOrders: async () => notConnected(),
  orderLines: async () => notConnected(), reportLines: async () => notConnected(), syncRuns: async () => notConnected(),
}

export const api: OrdersApi = DEMO ? demoApi : supabase ? supabaseApi : offline

export { applyLine }
