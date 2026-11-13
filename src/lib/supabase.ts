import type { Fulfilment } from './customerOrders'
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** null when the build has no Supabase settings (the app then shows a setup message). */
export const supabase = url && key ? createClient(url, key) : null

/** `npm run demo`: no login, sample data, nothing is saved. For looking at the UI locally. */
export const DEMO = import.meta.env.VITE_DEMO === '1'

// UI hint only. The real check is Row Level Security in the database.
export const ADMIN_EMAIL = 'george.mridun@hsw.com.au'
export const MAX_STORES = 25

/** admin: every store, and people. manager and staff (shown as "Store"): the same access inside their own store, for quotes, invoices and orders. */
export type Role = 'admin' | 'manager' | 'staff'
export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', manager: 'Manager', staff: 'Store' }

/** One person, one login. Which stores they are in, and as what, is in store_members. */
export interface AppUser {
  user_id: string
  email: string
  full_name: string
  active: boolean
  password_set_at: string | null
  created_at: string
  is_admin?: boolean // made an admin by the main admin: sees and does everything
  sees_all_sales?: boolean // manager: reads every store's sales and nothing else
}

/** A store as a manager sees it: name and code only (the stores_basic view), never an address or bank detail. */
export const basicStore = (r: { id: string; name: string; code: string; active: boolean }): StoreRow => ({
  ...r, address: '', suburb: '', phone: '', email: null, owner_email: null, legal_name: '', abn: '', bank_name: '', bsb: '', account: '', password_set_at: null,
})

/** A person's place in one store. A person can have several. */
export interface Member {
  user_id: string
  store_id: string
  role: 'manager' | 'staff'
}

export interface StoreRow {
  id: string
  name: string
  code: string
  address: string
  suburb: string
  phone: string
  email: string | null
  owner_email: string | null
  legal_name: string
  abn: string
  bank_name: string
  bsb: string
  account: string
  active: boolean
  password_set_at: string | null
}

export interface PaymentRow {
  amount_cents: number
  kind: 'payment' | 'deposit'
  paid_on: string
}

export interface DocRow {
  id: string
  store_id: string
  doc_type: 'Quote' | 'Tax Invoice' | 'Customer Order'
  fulfilment?: Fulfilment | null // customer orders only: where the order is up to
  doc_number: string
  customer_name: string
  total_cents: number
  due_date: string | null
  status: 'open' | 'part_paid' | 'paid' | 'void'
  created_by: string | null
  created_at: string
  payload: unknown
  stores: { name: string } | null
  payments: PaymentRow[]
}

/** A product, the same for every store. Synced from NAV (Retail Items). */
export interface ItemRow {
  code: string // NAV "No." - always text, leading zeros kept
  description: string
  vendor_no: string | null
  vendor_item_no: string | null
  barcode: string | null
  division: string | null
  category: string | null
  status: string // ACTIVE, NEW, ...
  price: number | null // RRP
  sales_uom: string | null
  base_uom: string | null
  blocked: boolean
  exclude_from_replen: boolean
  promotion?: string | null // NAV's Shelf No.: when there is a value, the supplier has the item on promotion
}

/** What one store holds of one item, as at the last sync. Synced from NAV (Replen. Qty.). */
export interface StockRow {
  store_id: string
  item_code: string
  inventory: number
  qty_on_po: number
  transfer_in: number // Quantity in Transfer In: already on its way to the store
  unavailable: number // Unavailable Qty
  moq: number
  store_cost: number
  sales_qty: number // units sold last week (information only)
  vendor_no: string | null // Replen. Qty. Vendor No. (33): the vendor this store orders the item from
  po_blocked: boolean // Replen. Qty. PO Blocked (41)
  synced_at: string
}

export type OrderStatus = 'open' | 'copied' | 'ordered'
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = { open: 'Open', copied: 'Copied', ordered: 'Ordered in NAV' }

export interface OrderRow {
  id: string
  store_id: string
  vendor_no: string // an order is for one vendor, like the NAV purchase order it becomes
  status: OrderStatus
  nav_ref: string | null // the NAV order number(s), once entered
  created_by: string | null
  created_at: string
  copied_at: string | null
  ordered_at: string | null
  stores?: { name: string } | null
}

export interface OrderLine {
  id: string
  order_id: string
  item_code: string
  qty: number
  unit_cost: number // store cost when the line was saved
  vendor_no: string | null
  division: string | null
  vendor_item_no: string | null // for Copy for NAV
  uom: string | null // unit of measure, for Copy for NAV
  description: string
  revision: number
  updated_by: string | null
  updated_at: string
}

/** yyyy-mm-dd in local time. */
export const isoDate = (d: Date) => d.toLocaleDateString('en-CA')

/** An order with its line totals, for lists and reports. */
/** An item a store has chosen not to order. */
export interface BlockedItem { item_code: string; description: string; vendor_no: string | null; reason: string; blocked_by: string | null; blocked_at: string }

export interface OrderSummary extends OrderRow { lines: number; units: number; cost: number }

/** A stock take: a full count of a store, or a rolling count of one vendor or category. open: counting. saved: finished, waiting for NAV. posted: both journals entered. */
export type CountKind = 'full' | 'rolling'
export type CountStatus = 'open' | 'saved' | 'posted'
export type CountScopeType = 'none' | 'vendor' | 'category'
export interface CountRow {
  id: string
  store_id: string
  kind: CountKind
  name: string
  scope_type: CountScopeType
  scope_value: string | null
  status: CountStatus
  nav_pos_ref: string | null
  nav_neg_ref: string | null
  created_by: string | null
  created_at: string
  saved_at: string | null
  posted_at: string | null
}
export interface CountSummary extends CountRow { store_name: string; lines: number; differ: number; gain_value: number; loss_value: number }

/** One counted item. system_qty is the store's stock when it was counted, so the adjustment stays the same whenever it is copied. */
export interface CountLine {
  id: string
  count_id: string
  item_code: string
  counted: number
  system_qty: number
  unit_cost: number
  description: string
  division: string | null
  category: string | null
  vendor_no: string | null
  vendor_item_no: string | null
  uom: string | null
  revision: number
  updated_by: string | null
  updated_at: string
}

/** A full-count item with stock on the system that nobody has scanned yet. */
export interface UncountedItem { item_code: string; description: string; division: string | null; category: string | null; inventory: number; store_cost: number }

/** One nightly sync of one store's data from NAV. */
export interface SyncRun { store_id: string; finished_at: string; ok: boolean; rows: number; message: string | null }
