import { applyLine, type LineInput, type Product, type VendorOption } from './order'
import { DEMO, supabase, type OrderLine, type OrderRow, type OrderStatus, type OrderSummary, type SyncRun } from './supabase'
import { demoApi } from './demoApi'
import { supabaseApi } from './supabaseApi'

/** The vendors a store orders from. syncedAt: when its stock was last read from NAV (the last successful sync), not when a row last changed. */
export interface VendorList { options: VendorOption[]; syncedAt?: string }
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
  /** The vendors for a store with their item counts: small, so the Order tab can show it straight away. */
  vendors(storeId: string): Promise<VendorList>
  /** One vendor's whole range at one store, with the store's stock: loaded when the vendor is chosen. */
  range(storeId: string, vendor: string): Promise<Product[]>
  /** The store's current order for one vendor if one has been started (open or copied, not yet ordered in NAV). Reading it never creates one. */
  findOrder(storeId: string, vendor: string): Promise<OrderData | null>
  /** Starts the store's order for one vendor, or returns the one already there. Called when the first line is saved, not when a vendor is opened. */
  openOrder(storeId: string, vendor: string, email: string): Promise<OrderData>
  /** Every unfinished order for the store, one per vendor: what is on hold. */
  drafts(storeId: string): Promise<OrderSummary[]>
  /** Set an item's line to an absolute quantity (0 removes it). `baseRevision` is the revision this screen last saw (0 = no line yet). */
  saveLine(orderId: string, email: string, input: LineInput, baseRevision: number): Promise<OrderLine[]>
  /** Called with the full set of lines whenever any device changes them. Returns an unsubscribe. */
  subscribe(orderId: string, onLines: (lines: OrderLine[]) => void): () => void
  setStatus(orderId: string, status: OrderStatus, navRef?: string): Promise<OrderRow>
  /** Deletes an order that has not been ordered in NAV (open or copied). Its lines go with it. */
  deleteOrder(orderId: string): Promise<void>
  listOrders(storeIds: string[]): Promise<OrderSummary[]>
  orderLines(orderId: string): Promise<OrderLine[]>
  /** Latest sync result per store (admin). */
  syncRuns(): Promise<SyncRun[]>
  /** Weeks of stock the store aims to hold (its preference, or the default). */
  coverTarget(storeId: string): Promise<number>
  setCoverTarget(storeId: string, weeks: number, email: string): Promise<void>
}

const notConnected = (): never => { throw new Error('The back end is not connected yet.') }
const offline: OrdersApi = {
  vendors: async () => notConnected(), range: async () => notConnected(), findOrder: async () => notConnected(), openOrder: async () => notConnected(), drafts: async () => notConnected(), saveLine: async () => notConnected(),
  subscribe: () => notConnected(), setStatus: async () => notConnected(), deleteOrder: async () => notConnected(), listOrders: async () => notConnected(),
  orderLines: async () => notConnected(), syncRuns: async () => notConnected(), coverTarget: async () => notConnected(), setCoverTarget: async () => notConnected(),
}

export const api: OrdersApi = DEMO ? demoApi : supabase ? supabaseApi : offline

export { applyLine }
