import storesJson from '../data/stores.json'
import { isoDate, type AppUser, type DocRow, type ItemRow, type Member, type OrderLine, type OrderRow, type StockRow, type StoreRow } from './supabase'

const dayAgo = (n: number) => new Date(Date.now() - n * 864e5)

export const demoStores = (): StoreRow[] =>
  storesJson.map((s, i) => ({
    id: 'demo-' + i, name: s.name, code: s.code, address: s.address, suburb: s.suburb, phone: s.phone,
    email: i < 3 ? s.code.toLowerCase() + '@hsw.com.au' : null,
    owner_email: i < 3 ? 'owner.' + s.code.toLowerCase() + '@example.com' : null,
    legal_name: i < 3 ? 'Demo Pty Ltd t/a Howards Storage World' : '', abn: i < 3 ? '12 345 678 901' : '',
    bank_name: '', bsb: '', account: '', active: true, password_set_at: i < 3 ? new Date().toISOString() : null,
  }))

// Sample quotes and invoices for the Quote tab, on the first two demo stores.
export const demoDocs = (): DocRow[] => [
  { id: 'd1', store_id: 'demo-0', doc_type: 'Tax Invoice', doc_number: 'INV-' + storesJson[0].code + '-1001', customer_name: 'Jo Smith', total_cents: 247187,
    due_date: isoDate(dayAgo(-4)), status: 'part_paid', created_by: 'sam@hsw.com.au', created_at: dayAgo(3).toISOString(), payload: {}, stores: { name: storesJson[0].name },
    payments: [{ amount_cents: 50000, kind: 'deposit', paid_on: isoDate(dayAgo(3)) }] },
  { id: 'd2', store_id: 'demo-1', doc_type: 'Tax Invoice', doc_number: 'INV-' + storesJson[1].code + '-2040', customer_name: 'A. Nguyen', total_cents: 89900,
    due_date: isoDate(dayAgo(2)), status: 'open', created_by: 'lee@hsw.com.au', created_at: dayAgo(9).toISOString(), payload: {}, stores: { name: storesJson[1].name }, payments: [] },
  { id: 'd3', store_id: 'demo-0', doc_type: 'Quote', doc_number: 'Q-' + storesJson[0].code + '-1002', customer_name: 'Pat Lee', total_cents: 129500,
    due_date: null, status: 'open', created_by: 'priya@hsw.com.au', created_at: dayAgo(1).toISOString(), payload: {}, stores: { name: storesJson[0].name }, payments: [] },
  { id: 'd4', store_id: 'demo-0', doc_type: 'Customer Order', fulfilment: 'to_order', doc_number: 'CO-' + storesJson[0].code + '-1003', customer_name: 'Mia Chen', total_cents: 9900,
    due_date: null, status: 'part_paid', created_by: 'sam@hsw.com.au', created_at: dayAgo(2).toISOString(), payload: { lines: [{ code: 'ANA01093', qty: '2' }, { code: 'ANA01096', qty: '1' }] }, stores: { name: storesJson[0].name },
    payments: [{ amount_cents: 2000, kind: 'deposit', paid_on: isoDate(dayAgo(2)) }] },
]

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
  I('TAN009', 'S/S BASKET 500W X 100H X 485D', '', 'TAN009', '9325039020091', 'KITCHEN', 'KIT-PULL_OUTS', 64.95),
  I('TAN029', 'S/S BASKET 500W X 150H X 485D', '', 'TAN029', '9325039020299', 'KITCHEN', 'KIT-PULL_OUTS', 74.95),
  I('TAN088', 'ACRYLIC NON-SLIP BASE 500MM', '', 'TAN088', '9325039020886', 'KITCHEN', 'KIT-PULL_OUTS', 14.95),
  I('TAN070', 'SIDE MOUNT SLIDES ADJ SPACER PAIR', '', 'TAN070', '9325039020701', 'KITCHEN', 'KIT-PULL_OUTS', 39.95),
  I('ANA01091', 'HUSH SOAP DISPENSER WHT', 'ANAS001', 'IHUW-06', '9325039010914', 'BATHROOM', 'BATH-SETS_ACCS', 24.95),
  I('ANA01092', 'HUSH SOAP DISH WHT', 'ANAS001', 'IHUW-03', '9325039010921', 'BATHROOM', 'BATH-SETS_ACCS', 12.95),
  I('ANA01093', 'HUSH TUMBLER WHT', 'ANAS001', 'IHUW-05', '9325039010938', 'BATHROOM', 'BATH-SETS_ACCS', 12.95),
  I('ANA01095', 'HUSH TOILET BRUSH WHT', 'ANAS001', 'IHUW-17', '9325039010952', 'BATHROOM', 'BATH-TOILET_BRUSH', 49.95),
  I('ANA01096', 'HUSH ROLL CANISTER WHT', 'ANAS001', 'IHUW-15', '9325039010969', 'BATHROOM', 'BATH-TOILET_BRUSH', 69.95, { status: 'NEW' }),
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
