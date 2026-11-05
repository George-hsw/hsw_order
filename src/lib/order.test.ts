import { describe, expect, it } from 'vitest'
import { applyLine, findByScan, groupByVendor, isStale, itemWarnings, lineCost, moqNote, navText, parseQty, searchItems, totals, vendorOf, vendorOptions } from './order'
import { demoItems, demoLines, demoStock } from './demo'
import type { OrderLine } from './supabase'

const items = demoItems()
const soapDish = items.find((i) => i.code === 'ANA01092')!

describe('quantities', () => {
  it('accepts whole numbers only', () => {
    expect(parseQty('12')).toBe(12)
    expect(parseQty(' 0 ')).toBe(0)
    for (const bad of ['', '1.5', '-2', 'abc', '1e3', '100000']) expect(parseQty(bad)).toBeNull()
  })
  it('warns about MOQ without blocking', () => {
    expect(moqNote(12, 6)).toBeNull()
    expect(moqNote(4, 6)).toMatch(/minimum of 6/)
    expect(moqNote(8, 6)).toMatch(/multiple of 6/)
    expect(moqNote(3, 1)).toBeNull()
    expect(moqNote(0, 6)).toBeNull()
  })
  it('works money in cents', () => {
    expect(lineCost(3, 0.1)).toBe(0.3)
    expect(lineCost(12, 5.12)).toBe(61.44)
  })
})

describe('finding items', () => {
  it('matches a scan by barcode, with or without leading zeros', () => {
    expect(findByScan(items, '9325039010921')?.code).toBe('ANA01092')
    expect(findByScan(items, '09325039010921')?.code).toBe('ANA01092')
  })
  it('matches a scan by item no. ignoring case, and returns null for strangers', () => {
    expect(findByScan(items, 'ana01095')?.code).toBe('ANA01095')
    expect(findByScan(items, '000')).toBeNull()
    expect(findByScan(items, '  ')).toBeNull()
  })
  it('searches every word across code, vendor item no. and description', () => {
    expect(searchItems(items, 'toilet brush').map((i) => i.code)).toEqual(['ANA01394', 'ANA01095'])
    expect(searchItems(items, 'IHUW-03')[0].code).toBe('ANA01092')
    expect(searchItems(items, 'nothing like this')).toEqual([])
    expect(searchItems(items, '')).toEqual([])
  })
  it('ranks an exact item no. first', () => {
    expect(searchItems(items, 'ANA01093')[0].code).toBe('ANA01093')
  })
})

describe('order lines', () => {
  it('a repeat scan updates the same line instead of adding another', () => {
    const first = applyLine([], 'o1', 'sam@hsw.com.au', { item: soapDish, qty: 6, unitCost: 5.12 })
    const again = applyLine(first, 'o1', 'lee@hsw.com.au', { item: soapDish, qty: 12, unitCost: 5.12 })
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ qty: 12, revision: 2, updated_by: 'lee@hsw.com.au', id: first[0].id })
  })
  it('a quantity of 0 takes the line off', () => {
    const lines = applyLine([], 'o1', 'a', { item: soapDish, qty: 6, unitCost: 5.12 })
    expect(applyLine(lines, 'o1', 'a', { item: soapDish, qty: 0, unitCost: 5.12 })).toEqual([])
  })
  it('totals lines, units and cost', () => {
    expect(totals(demoLines())).toEqual({ lines: 2, units: 18, cost: 184.02 })
    expect(totals([])).toEqual({ lines: 0, units: 0, cost: 0 })
  })
})

describe('vendor groups and Copy for NAV', () => {
  const mk = (code: string, vendor: string | null, qty: number): OrderLine => ({
    id: code, order_id: 'o', item_code: code, qty, unit_cost: 1, vendor_no: vendor, division: null, description: code, revision: 1, updated_by: null, updated_at: '',
  })
  const lines = [mk('B2', 'ZED001', 2), mk('A1', 'ANAS001', 1), mk('A0', 'ANAS001', 5), mk('X9', null, 3)]
  it('orders vendors, then items, with no-vendor lines last', () => {
    const g = groupByVendor(lines)
    expect(g.map((x) => x.vendor)).toEqual(['ANAS001', 'ZED001', 'No vendor'])
    expect(g[0].lines.map((l) => l.item_code)).toEqual(['A0', 'A1'])
    expect(g[0].totals.units).toBe(6)
  })
  it('writes tab-separated item and quantity, keeping leading zeros as text', () => {
    const g = groupByVendor([mk('00123', 'V1', 4)])[0]
    expect(navText(g)).toBe('Item\t00123\t\t\t\t\t\t4')
    expect(navText(g, true)).toBe('Type\tNo.\tVendor Item No.\tVariant Code\tDescription\tUnit of Measure Code\tInventory\tQuantity\nItem\t00123\t\t\t\t\t\t4')
  })
})

describe('stock freshness', () => {
  it('is stale after 36 hours or when never synced', () => {
    const now = new Date('2026-11-05T12:00:00Z')
    expect(isStale('2026-11-05T06:00:00Z', now)).toBe(false)
    expect(isStale('2026-11-03T06:00:00Z', now)).toBe(true)
    expect(isStale(undefined, now)).toBe(true)
  })
})

describe('vendors', () => {
  const stock = demoStock('s')
  it('takes the vendor from the store stock row first, then the item card', () => {
    const brush = items.find((i) => i.code === 'ANA01394')!
    expect(vendorOf(brush, stock.find((s) => s.item_code === 'ANA01394'))).toBe('MYHO001')
    expect(vendorOf(brush, undefined)).toBe('ANAS001')
    expect(vendorOf({ ...brush, vendor_no: null }, undefined)).toBeNull()
  })
  it('lists each vendor once with its item count', () => {
    expect(vendorOptions(items, stock)).toEqual([{ vendor: 'ANAS001', items: 5 }, { vendor: 'MYHO001', items: 2 }])
  })
  it('puts the chosen vendor on the line', () => {
    const l = applyLine([], 'o1', 'a', { item: soapDish, qty: 6, unitCost: 5.12, vendorNo: 'MYHO001' })
    expect(l[0].vendor_no).toBe('MYHO001')
  })
})

describe('warnings', () => {
  it('blocked items, MOQ and missing data are warnings, never errors', () => {
    const blocked = items.find((i) => i.blocked)!
    expect(itemWarnings(blocked, undefined, 6).map((w) => w.text)).toContain('Blocked in NAV. Check before you order it')
    expect(itemWarnings(blocked, undefined, 6).every((w) => w.level === 'warn')).toBe(true)
    const stock = { store_id: 's', item_code: soapDish.code, inventory: 0, qty_on_po: 0, moq: 6, store_cost: 5.12, sales_qty: 3, vendor_no: 'ANAS001', po_blocked: false, synced_at: '' }
    expect(itemWarnings(soapDish, stock, 12)).toEqual([])
    expect(itemWarnings(soapDish, stock, 4)[0]).toMatchObject({ level: 'warn' })
    expect(itemWarnings(soapDish, undefined, 6).map((w) => w.text)).toContain('No stock record for this store')
    expect(itemWarnings({ ...soapDish, vendor_no: null }, { ...stock, vendor_no: null }, 6).map((w) => w.text)).toContain('No vendor on this item')
    expect(itemWarnings(soapDish, { ...stock, po_blocked: true }, 6).map((w) => w.text)).toContain('PO blocked at this store in NAV. Check before you order it')
  })
})
