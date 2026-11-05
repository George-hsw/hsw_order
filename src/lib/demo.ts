import storesJson from '../data/stores.json'
import type { AppUser, ItemRow, Member, OrderLine, OrderRow, StockRow, StoreRow } from './supabase'

const dayAgo = (n: number) => new Date(Date.now() - n * 864e5)

export const demoStores = (): StoreRow[] =>
  storesJson.map((s, i) => ({
    id: 'demo-' + i, name: s.name, code: s.code, address: s.address, suburb: s.suburb, phone: s.phone,
    email: i < 3 ? s.code.toLowerCase() + '@hsw.com.au' : null, active: true, password_set_at: i < 3 ? new Date().toISOString() : null,
  }))

export const demoUsers = (): AppUser[] => [
  { user_id: 'u1', email: 'priya@hsw.com.au', full_name: 'Priya Nair', active: true, password_set_at: dayAgo(20).toISOString(), created_at: dayAgo(20).toISOString() },
  { user_id: 'u2', email: 'sam@hsw.com.au', full_name: 'Sam Carter', active: true, password_set_at: dayAgo(12).toISOString(), created_at: dayAgo(12).toISOString() },
  { user_id: 'u3', email: 'lee@hsw.com.au', full_name: 'Lee Tran', active: false, password_set_at: dayAgo(30).toISOString(), created_at: dayAgo(30).toISOString() },
]
export const demoMembers = (): Member[] => [
  { user_id: 'u1', store_id: 'demo-0', role: 'manager' },
  { user_id: 'u1', store_id: 'demo-1', role: 'manager' },
  { user_id: 'u2', store_id: 'demo-0', role: 'staff' },
  { user_id: 'u3', store_id: 'demo-1', role: 'staff' },
]

// Real rows from the ordering feed, so the demo reads like the real thing.
const I = (code: string, description: string, vendor_no: string, vendor_item_no: string, barcode: string, division: string, category: string, price: number, extra: Partial<ItemRow> = {}): ItemRow => ({
  code, description, vendor_no, vendor_item_no, barcode, division, category, status: 'ACTIVE', price,
  sales_uom: 'EA', base_uom: 'EA', blocked: false, exclude_from_replen: false, ...extra,
})
export const demoItems = (): ItemRow[] => [
  I('ANA01091', 'HUSH SOAP DISPENSER WHT', 'ANAS001', 'IHUW-06', '9325039010914', 'BATHROOM', 'BATH-SETS_ACCS', 24.95),
  I('ANA01092', 'HUSH SOAP DISH WHT', 'ANAS001', 'IHUW-03', '9325039010921', 'BATHROOM', 'BATH-SETS_ACCS', 12.95),
  I('ANA01093', 'HUSH TUMBLER WHT', 'ANAS001', 'IHUW-05', '9325039010938', 'BATHROOM', 'BATH-SETS_ACCS', 12.95),
  I('ANA01095', 'HUSH TOILET BRUSH WHT', 'ANAS001', 'IHUW-17', '9325039010952', 'BATHROOM', 'BATH-TOILET_BRUSH', 49.95),
  I('ANA01096', 'HUSH ROLL CANISTER WHT', 'ANAS001', 'IHUW-15', '9325039010969', 'BATHROOM', 'BATH-TOILET_BRUSH', 69.95),
  I('ANA01394', 'HUSH TOILET BRUSH BLACK', 'ANAS001', 'IHUB-17', '9325039013946', 'BATHROOM', 'BATH-TOILET_BRUSH', 49.95, { blocked: true }),
  I('ANA0001', 'TOWEL TO GO BALI ANTHRACITE', 'ANAS001', 'TTG-01', '9325039000011', 'ON_THE_GO', 'OTG-TRAVEL_OUTDOOR', 54.5, { status: 'NEW' }),
]
const S = (store_id: string, item_code: string, inventory: number, qty_on_po: number, moq: number, store_cost: number, sales_qty: number, vendor_no = 'ANAS001', po_blocked = false): StockRow =>
  ({ store_id, item_code, inventory, qty_on_po, transfer_in: item_code === 'ANA01095' ? 4 : 0, unavailable: item_code === 'ANA01092' ? 1 : 0, moq, store_cost, sales_qty, vendor_no, po_blocked, synced_at: new Date(new Date().setHours(6, 0, 0, 0)).toISOString() })
export const demoStock = (storeId: string): StockRow[] => [
  S(storeId, 'ANA01091', 6, 0, 6, 9.78, 0), S(storeId, 'ANA01092', 0, 0, 6, 5.12, 3), S(storeId, 'ANA01093', 6, 0, 6, 5.12, 0),
  S(storeId, 'ANA01095', 1, 0, 6, 20.43, 4), S(storeId, 'ANA01096', 5, 6, 6, 29.04, 3),
  S(storeId, 'ANA0001', 0, 0, 1, 24.1, 0, 'MYHO001'), S(storeId, 'ANA01394', 2, 0, 6, 20.43, 1, 'MYHO001', true),
]

export const demoOrder = (): OrderRow => ({
  id: 'o1', store_id: 'demo-0', vendor_no: 'ANAS001', status: 'open', nav_ref: null, created_by: 'sam@hsw.com.au',
  created_at: dayAgo(0).toISOString(), copied_at: null, ordered_at: null, stores: { name: 'Artarmon' },
})
export const demoLines = (): OrderLine[] => [
  { id: 'l1', order_id: 'o1', item_code: 'ANA01092', qty: 12, unit_cost: 5.12, vendor_no: 'ANAS001', division: 'BATHROOM', vendor_item_no: null, uom: 'EA', description: 'HUSH SOAP DISH WHT', revision: 1, updated_by: 'sam@hsw.com.au', updated_at: dayAgo(0).toISOString() },
  { id: 'l2', order_id: 'o1', item_code: 'ANA01095', qty: 6, unit_cost: 20.43, vendor_no: 'ANAS001', division: 'BATHROOM', vendor_item_no: null, uom: 'EA', description: 'HUSH TOILET BRUSH WHT', revision: 1, updated_by: 'sam@hsw.com.au', updated_at: dayAgo(0).toISOString() },
]
