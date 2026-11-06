import { DEMO, supabase, type StoreRow } from '../supabase'
import type { ChainWeek, ItemSale, RankRow, StoreDay, StoreWeek, WeekDates, WeekRef } from './model'
import type { DailyResult, DetailedResult, ReportKind, WeeklyResult } from './parse'
import { demoSalesApi } from './demoSales'
import { supabaseSalesApi } from './supabaseSales'

export interface UploadRecord { id: number; kind: ReportKind; fy: number; week: number; row_count: number; uploaded_by: string; uploaded_at: string }
export interface ImportResult { rows: number; unmatched: string[] }

/** Everything the Sales tab reads and the admin's upload writes. Row Level Security decides what a store may see; the screens never filter for it. */
export interface SalesApi {
  /** Every week that has been loaded, newest first. */
  weeks(): Promise<WeekDates[]>
  /** One store's week-by-week results, oldest first. */
  history(storeId: string): Promise<StoreWeek[]>
  days(storeId: string, w: WeekRef): Promise<StoreDay[]>
  /** The store's place in each league. Never anyone else's figures. */
  ranks(storeId: string, w: WeekRef): Promise<RankRow[]>
  /** Chain totals and averages, or null when fewer than three stores are in the week. */
  chain(w: WeekRef): Promise<ChainWeek | null>
  items(storeId: string, w: WeekRef): Promise<ItemSale[]>
  /** Admin only: every store's week. */
  league(w: WeekRef): Promise<StoreWeek[]>
  uploads(): Promise<UploadRecord[]>
  importWeekly(r: WeeklyResult, stores: StoreRow[], by: string): Promise<ImportResult>
  importDetailed(r: DetailedResult, stores: StoreRow[], by: string, onProgress: (done: number, total: number) => void): Promise<ImportResult>
  importDaily(r: DailyResult, stores: StoreRow[], by: string): Promise<ImportResult>
}

const notConnected = (): never => { throw new Error('The back end is not connected yet.') }
const offline: SalesApi = {
  weeks: async () => notConnected(), history: async () => notConnected(), days: async () => notConnected(), ranks: async () => notConnected(), chain: async () => notConnected(),
  items: async () => notConnected(), league: async () => notConnected(), uploads: async () => notConnected(), importWeekly: async () => notConnected(),
  importDetailed: async () => notConnected(), importDaily: async () => notConnected(),
}

export const salesApi: SalesApi = DEMO ? demoSalesApi : supabase ? supabaseSalesApi : offline
