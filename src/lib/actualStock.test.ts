import { describe, expect, it } from 'vitest'
import { actualStock } from './supabaseApi'
import type { StockRow } from './supabase'

const row = (inventory: number, sold?: number) => ({ store_id: 's', item_code: 'A', inventory, qty_on_po: 0, transfer_in: 0, unavailable: 0, qty_sold_not_posted: sold, moq: 1, store_cost: 1, sales_qty: 0, vendor_no: null, po_blocked: false, synced_at: '' }) as StockRow

describe('actualStock', () => {
  it('takes what is sold but not posted off the inventory, whichever sign the feed gives', () => {
    expect(actualStock(row(14, -3)).inventory).toBe(11)
    expect(actualStock(row(24, 2)).inventory).toBe(22)
    expect(actualStock(row(24, -1)).inventory).toBe(23)
  })
  it('leaves stock alone when nothing is unposted', () => expect(actualStock(row(10)).inventory).toBe(10))
  it('can go below zero, which shows an over-sold item', () => expect(actualStock(row(2, -5)).inventory).toBe(-3))
})
