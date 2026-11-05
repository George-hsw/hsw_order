import type { ItemRow, OrderLine, StockRow } from './supabase'

/** Everything the phone shows about one item in one store. */
export interface Product { item: ItemRow; stock: StockRow | undefined }

// ---------- Money and quantities ----------

export const money = (n: number) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
const cents = (n: number) => Math.round(n * 100)

/** qty × unit cost, worked in cents so totals never drift. */
export const lineCost = (qty: number, unitCost: number) => cents(unitCost) * qty / 100

/** A quantity staff may save: a whole number from 0 to 99,999. Anything else is not a quantity. */
export function parseQty(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,5}$/.test(t)) return null
  return Number(t)
}

/** MOQ is a warning, never a block: stores sometimes order loose quantities. */
export function moqNote(qty: number, moq: number): string | null {
  if (qty <= 0 || moq <= 1) return null
  if (qty < moq) return `Below the minimum of ${moq}`
  if (qty % moq !== 0) return `Not a multiple of ${moq}`
  return null
}

// ---------- Finding an item ----------

const stripZeros = (s: string) => s.replace(/^0+/, '')

/** A scan reads UPC-A, EAN-13 or EAN-8; the same product can arrive with or without leading zeros. */
export function sameBarcode(a: string | null | undefined, b: string): boolean {
  return !!a && /^\d+$/.test(a) && /^\d+$/.test(b) && stripZeros(a) === stripZeros(b)
}

/** Exact scan: barcode, then item no. Returns null when nothing matches. */
export function findByScan(items: ItemRow[], scanned: string): ItemRow | null {
  const v = scanned.trim()
  if (!v) return null
  return items.find((i) => sameBarcode(i.barcode, v)) ?? items.find((i) => i.code.toLowerCase() === v.toLowerCase()) ?? null
}

/** Typed search: every word must appear in the code, vendor item no., barcode or description. Best matches first. */
export function searchItems(items: ItemRow[], query: string, limit = 20): ItemRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: [number, ItemRow][] = []
  for (const it of items) {
    const hay = `${it.code} ${it.vendor_item_no ?? ''} ${it.barcode ?? ''} ${it.description}`.toLowerCase()
    if (!words.every((w) => hay.includes(w))) continue
    const code = it.code.toLowerCase()
    scored.push([words.some((w) => code === w || it.barcode === w) ? 0 : words.some((w) => code.startsWith(w)) ? 1 : 2, it])
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].description.localeCompare(b[1].description)).slice(0, limit).map((s) => s[1])
}

// ---------- The order's lines ----------

export interface LineInput { item: ItemRow; qty: number; unitCost: number; vendorNo?: string | null }

/** The vendor a store orders an item from: the Replen. Qty. row for that store first, then the item card. */
export const vendorOf = (item: ItemRow, stock: StockRow | undefined): string | null => stock?.vendor_no?.trim() || item.vendor_no?.trim() || null

/** The items a store orders from one vendor: the whole range, whether or not anything is on order yet. Sorted by item no. */
export function rangeFor(items: ItemRow[], stock: StockRow[], vendor: string): Product[] {
  const byItem = new Map(stock.map((s) => [s.item_code, s]))
  return items
    .filter((i) => vendorOf(i, byItem.get(i.code)) === vendor)
    .map((item) => ({ item, stock: byItem.get(item.code) }))
    .sort((a, b) => a.item.code.localeCompare(b.item.code))
}

export interface VendorOption { vendor: string; items: number }

/** Vendors with at least one item in this store, most items first then by name, for the Vendor filter. */
export function vendorOptions(items: ItemRow[], stock: StockRow[]): VendorOption[] {
  const byItem = new Map(stock.map((s) => [s.item_code, s]))
  const count = new Map<string, number>()
  for (const it of items) { const v = vendorOf(it, byItem.get(it.code)); if (v) count.set(v, (count.get(v) ?? 0) + 1) }
  return [...count.entries()].map(([vendor, n]) => ({ vendor, items: n })).sort((a, b) => a.vendor.localeCompare(b.vendor))
}

/**
 * Done on the phone: set the line for this item to an absolute quantity. A repeat scan finds the existing line, so there is
 * never a second line for the same item. A quantity of 0 takes the line off.
 */
export function applyLine(lines: OrderLine[], orderId: string, who: string, input: LineInput, now = new Date()): OrderLine[] {
  const rest = lines.filter((l) => l.item_code !== input.item.code)
  if (input.qty <= 0) return rest
  const prev = lines.find((l) => l.item_code === input.item.code)
  const line: OrderLine = {
    id: prev?.id ?? `line-${orderId}-${input.item.code}`, order_id: orderId, item_code: input.item.code, qty: input.qty,
    unit_cost: input.unitCost, vendor_no: input.vendorNo !== undefined ? input.vendorNo : input.item.vendor_no, division: input.item.division, description: input.item.description,
    revision: (prev?.revision ?? 0) + 1, updated_by: who, updated_at: now.toISOString(),
  }
  return [...rest, line]
}

export interface Totals { lines: number; units: number; cost: number }
export function totals(lines: OrderLine[]): Totals {
  return {
    lines: lines.length,
    units: lines.reduce((n, l) => n + l.qty, 0),
    cost: lines.reduce((n, l) => n + cents(lineCost(l.qty, l.unit_cost)), 0) / 100,
  }
}

export const NO_VENDOR = 'No vendor'
export interface VendorGroup { vendor: string; lines: OrderLine[]; totals: Totals }

/** Lines grouped by vendor no., vendors in order, lines by item no. Lines with no vendor are kept together at the end. */
export function groupByVendor(lines: OrderLine[]): VendorGroup[] {
  const map = new Map<string, OrderLine[]>()
  for (const l of lines) {
    const key = l.vendor_no?.trim() || NO_VENDOR
    map.set(key, [...(map.get(key) ?? []), l])
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === NO_VENDOR ? 1 : b === NO_VENDOR ? -1 : a.localeCompare(b)))
    .map(([vendor, ls]) => {
      const sorted = [...ls].sort((x, y) => x.item_code.localeCompare(y.item_code))
      return { vendor, lines: sorted, totals: totals(sorted) }
    })
}

// ---------- Copy for NAV ----------

/**
 * The columns of a NAV purchase order line, in the order the lines grid shows them. Only Type, No. and Quantity are filled:
 * NAV supplies the unit of measure, description and cost when the item number is validated, and Inventory is a calculated
 * field that cannot be pasted into. Columns after the last one filled are left off the pasted rows.
 */
export const NAV_COLUMNS: { header: string; value?: (l: OrderLine) => string }[] = [
  { header: 'Type', value: () => 'Item' },
  { header: 'No.', value: (l) => l.item_code },
  { header: 'Vendor Item No.' }, { header: 'Variant Code' }, { header: 'Description' }, { header: 'Unit of Measure Code' }, { header: 'Inventory' },
  { header: 'Quantity', value: (l) => String(l.qty) },
  { header: 'Qty. to Receive' }, { header: 'Qty. To Invoice' }, { header: 'Description 2' }, { header: 'Location Code' },
  { header: 'Direct Unit Cost Excl. VAT' }, { header: 'Line Amount Excl. VAT' }, { header: 'Vendor Invoice Cost' }, { header: 'Vendor Invoice Qty' },
  { header: 'MOQ' }, { header: 'Department Code' }, { header: 'Area Code' },
]
const NAV_WIDTH = NAV_COLUMNS.reduce((n, c, i) => (c.value ? i + 1 : n), 0)

/** Tab-separated purchase lines, one per item, ready to paste into the NAV lines grid. Item numbers stay text so leading zeros survive. */
export function navText(group: VendorGroup, withHeader = false): string {
  const cols = NAV_COLUMNS.slice(0, NAV_WIDTH)
  const rows = group.lines.map((l) => cols.map((c) => c.value?.(l) ?? '').join('\t'))
  return [...(withHeader ? [cols.map((c) => c.header).join('\t')] : []), ...rows].join('\n')
}

// ---------- Stock freshness ----------

const STALE_HOURS = 36

export function isStale(syncedAt: string | undefined, now = new Date()): boolean {
  if (!syncedAt) return true
  return now.getTime() - new Date(syncedAt).getTime() > STALE_HOURS * 36e5
}

/** "Stock as at 6:00 am" for today, "Stock as at Tue 6:00 am" for earlier days. */
export function syncedLabel(syncedAt: string | undefined, now = new Date()): string {
  if (!syncedAt) return 'Stock has not synced yet'
  const d = new Date(syncedAt)
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, ' ')
  const today = d.toDateString() === now.toDateString()
  return `Stock as at ${today ? '' : d.toLocaleDateString('en-AU', { weekday: 'short' }) + ' '}${time}`
}

// ---------- Things worth a second look ----------

export interface Warning { text: string; level: 'warn' | 'error' }

/** Why a line (or an item about to be added) needs a look. Warnings only say so; nothing stops an order. */
export function itemWarnings(item: ItemRow, stock: StockRow | undefined, qty: number): Warning[] {
  const out: Warning[] = []
  if (item.blocked) out.push({ text: 'Blocked in NAV. Check before you order it', level: 'warn' })
  const moq = moqNote(qty, stock?.moq ?? 1)
  if (moq) out.push({ text: moq, level: 'warn' })
  if (!vendorOf(item, stock)) out.push({ text: 'No vendor on this item', level: 'warn' })
  if (stock?.po_blocked) out.push({ text: 'PO blocked at this store in NAV. Check before you order it', level: 'warn' })
  if (!stock) out.push({ text: 'No stock record for this store', level: 'warn' })
  if (item.exclude_from_replen) out.push({ text: 'Excluded from replenishment', level: 'warn' })
  return out
}
