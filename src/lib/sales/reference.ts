// The Power BI "Export data" matrix (item by store: net sales, units, rank) used as an independent check on the Detailed Sales Report of the same
// week. Nothing from it is saved. If a store's sheet agrees with it item by item, that proves the sheet belongs to that store and its sales and
// units are right, whatever else is wrong around it; if it does not agree, the sheet is blocked and the first differences are shown.
import { strFromU8, unzipSync } from 'fflate'
import { storeKey, type DetailedResult } from './parse'
import type { Check } from './validate'

export interface RefItem { net: number; qty: number }
export interface ReferenceExport { fy: number; week: number; stores: Map<string, Map<string, RefItem>>; items: number }

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

/** The export, or null when the file is not one. The name does not matter: the file says what it is (a sheet called Export, Col_Name in A1, the filters in the last row). */
export function parseReference(data: Uint8Array): ReferenceExport | null {
  let xml = ''
  try {
    const z = unzipSync(data, { filter: (f) => f.name === 'xl/workbook.xml' || f.name === 'xl/worksheets/sheet1.xml' })
    if (!z['xl/workbook.xml'] || !z['xl/worksheets/sheet1.xml'] || !/name="Export"/.test(strFromU8(z['xl/workbook.xml']))) return null
    xml = strFromU8(z['xl/worksheets/sheet1.xml'])
  } catch { return null }
  const rows = [...xml.matchAll(/<(?:x:)?row\b[^>]*>([\s\S]*?)<\/(?:x:)?row>/g)].map((m) => [...m[1].matchAll(/<(?:x:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:x:)?c>)/g)].map((c): string | number | null => {
    const inner = c[2] ?? ''
    if (/t="inlineStr"/.test(c[1] ?? '')) return decode((inner.match(/<(?:x:)?t\b[^>]*>([\s\S]*?)<\/(?:x:)?t>/) ?? [])[1] ?? '')
    const v = (inner.match(/<(?:x:)?v>([\s\S]*?)<\/(?:x:)?v>/) ?? [])[1]
    return v === undefined || v === '' ? null : Number(v)
  }))
  if (rows.length < 4 || rows[0][0] !== 'Col_Name' || rows[1][0] !== 'No.' || !rows[1].includes('Store Sales LCY') || !rows[1].includes('Store Sales Qty')) return null
  const filters = String(rows[rows.length - 1][0] ?? '')
  const m = filters.match(/FY\s*(\d{4})\s*Week\s*(\d{1,2})/i)
  if (!m) return null
  const head = rows[0], sub = rows[1]
  const stores = new Map<string, Map<string, RefItem>>()
  const cols: { name: string; net: number; qty: number }[] = []
  for (let c = 1; c < head.length; c++) {
    const name = String(head[c] ?? '')
    if (!name || name === 'Total' || name.toUpperCase() === 'ONLINE' || sub[c] !== 'Store Sales LCY') continue
    if (sub[c + 1] === 'Store Sales Qty') { cols.push({ name, net: c, qty: c + 1 }); stores.set(name, new Map()) }
  }
  let items = 0
  for (const r of rows.slice(2)) {
    const code = String(r[0] ?? '')
    if (!code || code === 'Total' || code.startsWith('Applied')) continue
    items++
    for (const col of cols) {
      const net = Number(r[col.net] ?? 0), qty = Number(r[col.qty] ?? 0)
      if (net !== 0 || qty !== 0) stores.get(col.name)!.set(code, { net, qty })
    }
  }
  return { fy: Number(m[1]), week: Number(m[2]), stores, items }
}

/** The reference's store for a sheet's store. "Macquarie Park F" in the export is the store the sheet calls "Macquarie Park". */
const refStore = (ref: ReferenceExport, name: string) => {
  const k = storeKey(name)
  const names = [...ref.stores.keys()]
  return names.find((n) => storeKey(n) === k) ?? names.find((n) => { const x = storeKey(n); return x.startsWith(k) && x.length - k.length <= 1 })
}
const TOL_NET = 0.01, TOL_QTY = 0.001

/** Compares each store's sheet with the export, item by item. `proven` holds the stores whose sheet agrees on every item. */
export function crossReference(ref: ReferenceExport, detailed: DetailedResult): { checks: Check[]; proven: Set<string> } {
  const checks: Check[] = [], proven = new Set<string>()
  if (ref.fy !== detailed.week.fy || ref.week !== detailed.week.week) return { checks, proven }
  for (const s of detailed.sheets) {
    const name = s.store_name ?? s.tab
    const rs = s.store_name ? refStore(ref, s.store_name) : undefined
    if (!rs) { checks.push({ label: `${name}: in the Power BI item export`, ok: false, blocking: false, store: storeKey(name), detail: 'The export has no columns for this store, so it could not be compared.' }); continue }
    const mine = new Map(s.items.map((i) => [i.item_code, i]))
    // Two different problems. A figure that is WRONG blocks the store: saving it would put a wrong number in front of people. An item the sheet
    // simply LEAVES OUT is shown with its sales and units but does not block: nothing that would be saved is incorrect, one item is just absent.
    const wrong: string[] = [], left: { code: string; x: RefItem }[] = []
    let shared = 0
    for (const [code, x] of ref.stores.get(rs)!) {
      const i = mine.get(code)
      if (!i) { left.push({ code, x }); continue }
      shared++
      if (Math.abs(i.net_sales - x.net) > TOL_NET || Math.abs(i.qty - x.qty) > TOL_QTY) wrong.push(`${code}: sheet sales ${i.net_sales.toFixed(2)} and units ${i.qty}, export sales ${x.net.toFixed(2)} and units ${x.qty}`)
    }
    const ok = wrong.length === 0 && shared > 0
    if (ok) proven.add(storeKey(name))
    checks.push({ label: `${name}: matches the Power BI item export`, ok, blocking: true, store: storeKey(name),
      detail: ok ? `All ${shared} items the sheet shares with the export agree on sales and units.` : `${wrong.length || shared} of ${shared} shared items disagree. For example: ${wrong.slice(0, 3).join('; ')}. The sheet probably has shifted columns or belongs to another week.` })
    if (left.length) checks.push({ label: `${name}: items the sheet leaves out`, ok: false, blocking: false, store: storeKey(name),
      detail: `The export has ${left.length} item${left.length === 1 ? '' : 's'} with sales that the Detailed sheet does not list: ${left.slice(0, 4).map((l) => `${l.code} (sales ${l.x.net.toFixed(2)}, units ${l.x.qty})`).join(', ')}${left.length > 4 ? ` and ${left.length - 4} more` : ''}. Together ${left.reduce((a, l) => a + l.x.net, 0).toFixed(2)} of sales and ${left.reduce((a, l) => a + l.x.qty, 0)} units. They will be missing from this store's item history for the week.` })
  }
  return { checks, proven }
}
