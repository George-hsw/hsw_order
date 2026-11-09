import { describe, expect, it } from 'vitest'
import { findByScan, indexBarcodes, indexItems, searchItems } from './items'
import type { Item } from './quote'

const items: Item[] = [
  { code: 'ANA0001', description: 'TOWEL TO GO BALI', price: 59.95, status: 'ACTIVE', barcode: '8595734100000' },
  { code: 'UPC1', description: 'UPC ITEM', price: 5, status: 'ACTIVE', barcode: '0123456789012' },
  { code: 'NOBC', description: 'NO BARCODE', price: 1, status: 'ACTIVE' },
]
const byCode = indexItems(items)
const byBc = indexBarcodes(items)

describe('findByScan', () => {
  it('matches barcode, item code, and padded/stripped zeros', () => {
    expect(findByScan('8595734100000', byCode, byBc)?.code).toBe('ANA0001')
    expect(findByScan(' nobc ', byCode, byBc)?.code).toBe('NOBC')
    expect(findByScan('123456789012', byCode, byBc)?.code).toBe('UPC1') // scanner dropped leading 0
    expect(findByScan('999', byCode, byBc)).toBeUndefined()
  })
  it('search covers barcode', () => {
    expect(searchItems(items, '859573')[0].code).toBe('ANA0001')
  })
})
