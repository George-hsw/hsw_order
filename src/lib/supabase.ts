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
}

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
  doc_type: 'Quote' | 'Tax Invoice'
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
export interface OrderSummary extends OrderRow { lines: number; units: number; cost: number }

/** One nightly sync of one store's data from NAV. */
export interface SyncRun { store_id: string; finished_at: string; ok: boolean; rows: number; message: string | null }
