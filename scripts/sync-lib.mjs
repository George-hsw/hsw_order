// Pure helpers for the NAV sync (no network, so they are unit-tested in sync-lib.test.mjs).
import { createHash } from 'node:crypto'

export const str = (v) => (v === null || v === undefined ? null : String(v).trim() || null)

/** A NAV number: a JS number, or text like "12.5". Anything else is 0, or `fallback`. */
export function num(v, fallback = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v.replace(/,/g, '')); return Number.isFinite(n) ? n : fallback }
  return fallback
}

/** NAV Yes/No, true/false, 1/0. */
export const bool = (v) => v === true || (typeof v === 'string' && /^(yes|true|1)$/i.test(v.trim())) || v === 1

export const hash = (parts) => createHash('sha1').update(JSON.stringify(parts)).digest('hex')

/** The names of the fields on YOUR web services. Override either with DYN_ITEMS_FIELD_MAP / DYN_STOCK_FIELD_MAP (JSON). */
export const ITEM_FIELDS = {
  code: 'No', description: 'Description', vendor_no: 'Vendor_No', vendor_item_no: 'Vendor_Item_No', barcode: 'BarcodeNo',
  division: 'Division_Code', category: 'Item_Category_Code', status: 'Status_Code', price: 'Unit_Price_Including_VAT',
  sales_uom: 'Sales_Unit_of_Measure', base_uom: 'Base_Unit_of_Measure', exclude_from_replen: 'Exclude_from_Replenishment',
  blocked: null, // the Power_BI_Retail_Items service has no Blocked field
  moq: 'Minimum_Order_Quantity', store_cost: 'Store_Cost', // item-level: the same for every store
}
export const STOCK_FIELDS = {
  item_code: 'Item_No', location: 'Location_Code', variant: 'Variant_Code', inventory: 'Inventory', qty_on_po: 'Quantity_on_Purchase_Order',
  vendor_no: 'Vendor_No',
  po_blocked: null, // the Uber_Automation_Replen_Item_Quantities service has no PO Blocked field
  moq: null, store_cost: null, // taken from the item list unless the stock service has its own
  sales_qty: null, // no per-store weekly sales field on this service (Daily_Sales is not filled in)
}

/** One OData row -> an item. */
export function toItem(row, F) {
  return {
    code: String(row[F.code] ?? '').trim(),
    description: str(row[F.description]) ?? '',
    vendor_no: str(row[F.vendor_no]),
    vendor_item_no: str(row[F.vendor_item_no]),
    barcode: str(row[F.barcode]),
    division: str(row[F.division]),
    category: str(row[F.category]),
    status: str(row[F.status]) ?? '',
    price: F.price && row[F.price] !== undefined && row[F.price] !== null && row[F.price] !== '' ? Math.round(num(row[F.price]) * 100) / 100 : null,
    sales_uom: str(row[F.sales_uom]),
    base_uom: str(row[F.base_uom]),
    blocked: bool(row[F.blocked]),
    exclude_from_replen: bool(row[F.exclude_from_replen]),
    // Kept apart from the stored columns: applied to every store's stock row that has none of its own.
    _moq: F.moq ? num(row[F.moq], null) : null,
    _store_cost: F.store_cost ? num(row[F.store_cost], null) : null,
  }
}

export const itemFingerprint = (i) =>
  hash([i.code, i.description, i.vendor_no, i.vendor_item_no, i.barcode, i.division, i.category, i.status, i.price, i.sales_uom, i.base_uom, i.blocked, i.exclude_from_replen])

/** One OData row -> a stock row for a store (the store is worked out from the location code by the caller). */
export function toStock(row, F, itemsByCode) {
  const item_code = String(row[F.item_code] ?? '').trim()
  const item = itemsByCode.get(item_code)
  const moq = F.moq ? num(row[F.moq], null) : null
  const cost = F.store_cost ? num(row[F.store_cost], null) : null
  return {
    location: String(row[F.location] ?? '').trim(),
    variant: str(row[F.variant]),
    item_code,
    inventory: num(row[F.inventory]),
    qty_on_po: num(row[F.qty_on_po]),
    moq: moq ?? item?._moq ?? 1,
    store_cost: cost ?? item?._store_cost ?? 0,
    sales_qty: F.sales_qty ? num(row[F.sales_qty]) : 0,
    vendor_no: str(row[F.vendor_no]),
    po_blocked: bool(row[F.po_blocked]),
  }
}

export const stockFingerprint = (s) => hash([s.item_code, s.inventory, s.qty_on_po, s.moq, s.store_cost, s.sales_qty, s.vendor_no, s.po_blocked])

/**
 * Group raw stock rows by store. Rows are kept out (and counted) when:
 *   - the location is not one of our stores,
 *   - the row is for a variant (ordering by variant is not supported yet),
 *   - the item is not in the item list (the database needs the item to exist).
 * A store with the same item twice is a problem with the feed: it is reported, not guessed at.
 * stores: [{ id, code }]. Returns { byStore: Map(storeId -> { rows, duplicates }), skipped: {...} }.
 */
export function groupStock(rows, stores, itemCodes) {
  const idOf = new Map(stores.map((s) => [String(s.code).toUpperCase(), s.id]))
  const byStore = new Map()
  const skipped = { unknownLocation: 0, variant: 0, unknownItem: 0 }
  for (const r of rows) {
    const storeId = idOf.get(r.location.toUpperCase())
    if (!storeId) { skipped.unknownLocation++; continue }
    if (r.variant) { skipped.variant++; continue }
    if (!r.item_code || !itemCodes.has(r.item_code)) { skipped.unknownItem++; continue }
    const entry = byStore.get(storeId) ?? { rows: new Map(), duplicates: [] }
    if (entry.rows.has(r.item_code)) entry.duplicates.push(r.item_code)
    else entry.rows.set(r.item_code, r)
    byStore.set(storeId, entry)
  }
  return { byStore, skipped }
}

/**
 * Is this store's new data safe to publish over the old? Refuse an empty or much smaller feed (a failed overnight
 * replication looks like that) and any duplicate rows. Returns an error message, or null when fine.
 */
export function storeProblem(newCount, previousCount, duplicates) {
  if (duplicates.length) return `The feed has ${duplicates.length} items more than once (for example ${duplicates.slice(0, 3).join(', ')}), so the previous data was kept.`
  if (newCount === 0) return 'The feed came back empty, so the previous data was kept.'
  if (previousCount >= 50 && newCount < previousCount * 0.5) return `The feed has ${newCount} rows against ${previousCount} yesterday, which looks like a partial copy, so the previous data was kept.`
  return null
}

/**
 * The smallest set of writes. existing: Map(key -> { fingerprint, removed? }). `key` names the field that identifies a row.
 * fullPull: items missing from the new data are returned in toRemove.
 */
export function planChanges(rows, existing, key, fingerprint, { fullPull = true } = {}) {
  const toUpsert = []
  const seen = new Set()
  let unchanged = 0
  for (const row of rows) {
    seen.add(row[key])
    const fp = fingerprint(row)
    const old = existing.get(row[key])
    if (!old || old.fingerprint !== fp || old.removed) toUpsert.push({ ...row, fingerprint: fp })
    else unchanged++
  }
  const toRemove = fullPull ? [...existing].filter(([k, e]) => !seen.has(k) && !e.removed).map(([k]) => k) : []
  return { toUpsert, unchanged, toRemove }
}

/** A sudden mass removal is far more likely a partial response than a real clear-out. */
export const removalLooksWrong = (removeCount, activeCount) => activeCount > 0 && removeCount > Math.max(50, activeCount * 0.2)

/** OData filter for just our stores' locations, so NAV sends a few tens of thousands of rows instead of every location's. */
export const locationFilter = (field, codes) => (codes.length ? codes.map((c) => `${field} eq '${String(c).replace(/'/g, "''")}'`).join(' or ') : '')
