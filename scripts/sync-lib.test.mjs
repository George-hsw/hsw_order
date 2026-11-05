import { describe, expect, it } from 'vitest'
import { ITEM_FIELDS, STOCK_FIELDS, bool, groupStock, itemFingerprint, num, planChanges, removalLooksWrong, stockFingerprint, storeProblem, toItem, toStock } from './sync-lib.mjs'

describe('values', () => {
  it('reads NAV numbers and Yes/No', () => {
    expect(num('1,250.5')).toBe(1250.5)
    expect(num(null)).toBe(0)
    expect(num('x', null)).toBeNull()
    expect(bool('Yes')).toBe(true)
    expect(bool('No')).toBe(false)
    expect(bool(true)).toBe(true)
    expect(bool(undefined)).toBe(false)
  })
})

describe('items', () => {
  it('keeps item numbers as text, leading zeros and all', () => {
    const i = toItem({ No: '00123', Description: ' Soap dish ', Price: '12.949', Blocked: 'Yes', Barcode_No: '' }, ITEM_FIELDS)
    expect(i).toMatchObject({ code: '00123', description: 'Soap dish', price: 12.95, blocked: true, barcode: null })
  })
  it('a changed field changes the fingerprint, an unrelated one does not', () => {
    const a = toItem({ No: 'A', Description: 'x' }, ITEM_FIELDS)
    expect(itemFingerprint(a)).toBe(itemFingerprint({ ...a, _moq: 6 }))
    expect(itemFingerprint(a)).not.toBe(itemFingerprint({ ...a, blocked: true }))
  })
})

describe('stock', () => {
  const items = new Map([['A1', { _moq: 6, _store_cost: 5.12 }]])
  it('takes MOQ and cost from the item list when the stock service has none', () => {
    const s = toStock({ Item_No: 'A1', Location_Code: '14122', Inventory: 6, Quantity_on_Purchase_Order: '2', Vendor_No: 'MYHO001', PO_Blocked: 'No' }, STOCK_FIELDS, items)
    expect(s).toMatchObject({ location: '14122', inventory: 6, qty_on_po: 2, moq: 6, store_cost: 5.12, vendor_no: 'MYHO001', po_blocked: false, sales_qty: 0 })
  })
  it('falls back to MOQ 1 and cost 0 when neither has them', () => {
    expect(toStock({ Item_No: 'ZZ', Location_Code: '1' }, STOCK_FIELDS, new Map())).toMatchObject({ moq: 1, store_cost: 0 })
  })
  it('groups by store, and keeps out unknown locations, variants and unknown items', () => {
    const stores = [{ id: 's1', code: '14122' }, { id: 's2', code: '12064' }]
    const mk = (location, item_code, variant = null) => ({ location, item_code, variant, inventory: 1 })
    const { byStore, skipped } = groupStock([mk('14122', 'A1'), mk('14122', 'A2'), mk('99999', 'A1'), mk('12064', 'A1', 'RED'), mk('12064', 'NOPE'), mk('12064', 'A1')], stores, new Set(['A1', 'A2']))
    expect([...byStore.get('s1').rows.keys()]).toEqual(['A1', 'A2'])
    expect([...byStore.get('s2').rows.keys()]).toEqual(['A1'])
    expect(skipped).toEqual({ unknownLocation: 1, variant: 1, unknownItem: 1 })
  })
  it('reports an item that appears twice for one store', () => {
    const { byStore } = groupStock([{ location: '1', item_code: 'A1' }, { location: '1', item_code: 'A1' }], [{ id: 's', code: '1' }], new Set(['A1']))
    expect(byStore.get('s').duplicates).toEqual(['A1'])
  })
})

describe('keeping yesterday when today looks wrong', () => {
  it('refuses duplicates, an empty feed and a feed that halved', () => {
    expect(storeProblem(100, 100, ['A1'])).toMatch(/more than once/)
    expect(storeProblem(0, 100, [])).toMatch(/empty/)
    expect(storeProblem(40, 100, [])).toMatch(/partial/)
    expect(storeProblem(95, 100, [])).toBeNull()
    expect(storeProblem(10, 20, [])).toBeNull() // small stores are not judged by the 50% rule
    expect(storeProblem(5, 0, [])).toBeNull() // first sync
  })
  it('refuses a mass removal', () => {
    expect(removalLooksWrong(30, 100)).toBe(false)
    expect(removalLooksWrong(3000, 10000)).toBe(true)
  })
})

describe('planChanges', () => {
  const row = (item_code, inventory) => ({ item_code, inventory, qty_on_po: 0, moq: 1, store_cost: 0, sales_qty: 0, vendor_no: null, po_blocked: false })
  it('writes only new and changed rows, and lists what has gone', () => {
    const a = row('A', 1), b = row('B', 2)
    const existing = new Map([['A', { fingerprint: stockFingerprint(a) }], ['B', { fingerprint: 'old' }], ['C', { fingerprint: 'x' }], ['D', { fingerprint: 'y', removed: true }]])
    const plan = planChanges([a, b, row('E', 5)], existing, 'item_code', stockFingerprint)
    expect(plan.toUpsert.map((r) => r.item_code)).toEqual(['B', 'E'])
    expect(plan.unchanged).toBe(1)
    expect(plan.toRemove).toEqual(['C'])
  })
})
