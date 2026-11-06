import { describe, expect, it } from 'vitest'
import type { StoreRow } from '../supabase'
import { dailyRows, detailedRows, findStore, indexStores, weeklyRows } from './import'

const st = (id: string, name: string, code: string) => ({ id, name, code, address: '', suburb: '', phone: '', email: null, active: true, password_set_at: null }) as StoreRow
const ix = indexStores([st('1', 'Artarmon', '12064'), st('2', 'Mt. Gravatt', '14122'), st('3', 'South Wharf', '13006C')])

const totals = { header_net: 0, header_qty: 0, sum_net: 0, sum_qty: 0, kept_net: 0, kept_qty: 0, rows: 0, sheet_week: 10 }
describe('matching stores', () => {
  it('finds a store by name however it is written, then by code', () => {
    expect(findStore(ix, 'Mt Gravatt')?.id).toBe('2')
    expect(findStore(ix, 'Wharf South', '13006c')?.id).toBe('3')
    expect(findStore(ix, 'Nowhere')).toBeUndefined()
  })
  it('keeps closed stores and the eShop out of the unmatched list', () => {
    const base = { fy: 2027, week: 10, store_id: null, co_fran: 'Company', state: '', region: '', centre_type: '', retail_sqm: 0, ty_sales: 1, ly_sales: 1, ty_trans: 1, ly_trans: 1, member_sales: 0, member_trans: 0, stock: 0, sys_sales: 0, gp_ty: 0, gp_ly: 0, qty_sold: 0, basket: 0, l4l_adjust: 0 }
    const r = weeklyRows({ weeks: [], current: { fy: 2027, week: 10 }, warnings: [], summary: null, rows: [
      { ...base, store_name: 'Artarmon' }, { ...base, store_name: 'Glen Waverley' }, { ...base, store_name: 'Bondi', co_fran: 'Closed' }, { ...base, store_name: 'EShop', co_fran: 'eShop' },
    ] }, ix)
    expect(r.rows.map((x) => x.store_id)).toEqual(['1', null, null, null])
    expect(r.preview).toMatchObject({ matched: 1, total: 2, unmatched: ['Glen Waverley'] })
  })
  it('puts each detailed sheet\'s items on its store and names the stores it could not place', () => {
    const item = { item_code: 'A', description: '', vendor_no: null, division: null, qty: 1, net_sales: 1, store_rank: 1, group_qty: 1, group_net: 1, stores_stocking: 1, business_rank: 1, potential_sales: 0, potential_loss: 0, moq: 1 }
    const r = detailedRows({ week: { fy: 2027, week: 10 }, warnings: [], sheets: [{ tab: 'ARTA', store_name: 'Artarmon', a1: '', totals, items: [item, item] }, { tab: 'RHOD', store_name: 'Rhodes', a1: '', totals, items: [item] }] }, ix)
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ store_id: '1', fy: 2027, week: 10 })
    expect(r.preview).toMatchObject({ matched: 1, total: 2, unmatched: ['Rhodes'] })
  })
  it('matches daily locations by name or code', () => {
    const r = dailyRows({ week: { fy: 2027, week: 10 }, dates: { fy: 2027, week: 10, week_start: '', week_end: '' }, warnings: [], totals: [],
      days: [{ location: '12064', store_name: 'Artarmon', weekday: 1, ty: 1, ly: 1 }, { location: '3006C', store_name: 'Unknown', weekday: 1, ty: 1, ly: 1 }, { location: '13006C', store_name: '', weekday: 2, ty: 1, ly: 1 }] }, ix)
    expect(r.rows.map((x) => x.store_id)).toEqual(['1', '3'])
  })
})
