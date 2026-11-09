import { describe, expect, it } from 'vitest'
import { compute, emptyQuote, firstNameOf, type Item, type Settings, type Store } from './quote'

const stores: Store[] = [
  { name: 'Mornington', address: '1128 Nepean Hwy', suburb: 'Mornington VIC 3931', phone: '', code: 'MOR', email: '' },
]
const settings: Settings = {
  legalName: 'ABC Pty Ltd', abn: '12 345 678 901', website: 'hsw.com.au', validDays: 30, dueDays: 7,
  howToAccept: '', howToPay: '', bankName: '', bsb: '', account: '', terms: '', footer: '',
}
const items = new Map<string, Item>([
  ['ANA0001', { code: 'ANA0001', description: 'TOWEL', price: 59.95, status: 'ACTIVE' }],
  ['OLD1', { code: 'OLD1', description: 'OLD', price: 10, status: 'EX-APL' }],
  ['ZERO', { code: 'ZERO', description: 'ZERO', price: 0, status: 'ACTIVE' }],
])

const base = () => {
  const q = emptyQuote()
  q.storeName = 'Mornington'
  q.number = '1001'
  q.customer.name = 'Jo Smith'
  q.customer.phone = '0400 000 000'
  q.customer.email = 'jo@example.com'
  q.date = '2026-01-10'
  return q
}

describe('compute', () => {
  it('builds numbers and file name like the workbook', () => {
    const q = base()
    q.lines[0].code = 'ANA0001'
    const c = compute(q, items, stores, settings, items.size)
    expect(c.docNumber).toBe('Q-MOR-1001')
    expect(c.fileName).toBe('Q-MOR-1001 Jo Smith')
    q.docType = 'Tax Invoice'
    expect(compute(q, items, stores, settings, items.size).docNumber).toBe('INV-MOR-1001')
  })

  it('line total = ROUND(qty*price*(1-disc),2), blank qty counts as 1', () => {
    const q = base()
    q.lines[0] = { code: 'ANA0001', qty: '3', ownDescription: '', ownPrice: '', discPct: '10' }
    q.lines[1] = { code: 'ANA0001', qty: '', ownDescription: '', ownPrice: '', discPct: '' }
    const c = compute(q, items, stores, settings, items.size)
    expect(c.lines[0].totalCents).toBe(16187) // 3*59.95*0.9 = 161.865 -> 161.87
    expect(c.lines[1].totalCents).toBe(5995)
    expect(c.lines[1].message).toBe('Qty blank – counted as 1')
  })

  it('totals: prices include GST (GST = total / 11), a deposit shows on quotes and invoices', () => {
    const q = base()
    q.lines[0] = { code: '', qty: '2', ownDescription: 'Custom wardrobe', ownPrice: '1000', discPct: '' }
    q.deliveryFee = '100'
    q.installFee = '210'
    q.paid = '500'
    let c = compute(q, items, stores, settings, items.size)
    expect(c.totalCents).toBe(231000)
    expect(c.gstCents).toBe(21000)
    expect(c.paidCents).toBe(50000)
    expect(c.balanceCents).toBe(181000)
    q.docType = 'Tax Invoice'
    c = compute(q, items, stores, settings, items.size)
    expect(c.paidCents).toBe(50000)
    expect(c.balanceCents).toBe(181000)
  })

  it('own price overrides LS price; own description overrides LS description', () => {
    const q = base()
    q.lines[0] = { code: 'ANA0001', qty: '1', ownDescription: 'Special', ownPrice: '50', discPct: '' }
    const c = compute(q, items, stores, settings, items.size)
    expect(c.lines[0].description).toBe('Special')
    expect(c.lines[0].unitCents).toBe(5000)
  })

  it('flags unknown code, $0 price, non-ACTIVE status', () => {
    const q = base()
    q.lines[0].code = 'NOPE'
    q.lines[1].code = 'ZERO'
    q.lines[2].code = 'OLD1'
    q.lines[2].qty = '1'
    const c = compute(q, items, stores, settings, items.size)
    expect(c.lines[0].state).toBe('error')
    expect(c.lines[1].message).toBe('Price is $0 in LS – type an own price')
    expect(c.lines[2].message).toBe('OK · EX-APL')
    expect(c.ready).toBe(false)
    expect(c.problems).toContain('Fix the red item checks')
  })

  it('discount is clamped to 0-100%', () => {
    const q = base()
    q.lines[0] = { code: 'ANA0001', qty: '1', ownDescription: '', ownPrice: '', discPct: '250' }
    expect(compute(q, items, stores, settings, items.size).lines[0].totalCents).toBe(0)
  })

  it('invoice needs ABN and legal name in settings', () => {
    const q = base()
    q.docType = 'Tax Invoice'
    q.lines[0] = { code: 'ANA0001', qty: '1', ownDescription: '', ownPrice: '', discPct: '' }
    const c = compute(q, items, stores, { ...settings, abn: '[Enter your ABN]' }, items.size)
    expect(c.problems).toContain('This store has no ABN / legal name set – ask the admin')
  })

  it('valid-until = date + 30; due = date + 7 unless overridden', () => {
    const q = base()
    q.lines[0].code = 'ANA0001'
    expect(compute(q, items, stores, settings, 1).secondDate.getDate()).toBe(9) // 10 Jan + 30 = 9 Feb
    q.docType = 'Tax Invoice'
    expect(compute(q, items, stores, settings, 1).secondDate.getDate()).toBe(17)
    q.dueDate = '2026-03-01'
    expect(compute(q, items, stores, settings, 1).secondDate.getMonth()).toBe(2)
  })

  it('customer phone and email are required, and the email must be valid', () => {
    const q = base()
    q.lines[0] = { code: 'ANA0001', qty: '1', ownDescription: '', ownPrice: '', discPct: '' }
    q.customer.phone = ''
    q.customer.email = ''
    let c = compute(q, items, stores, settings, items.size)
    expect(c.problems).toContain('Enter the customer phone number')
    expect(c.problems).toContain('Enter the customer email')
    q.customer.phone = '0400 000 000'
    q.customer.email = 'not-an-email'
    c = compute(q, items, stores, settings, items.size)
    expect(c.problems).toContain('The customer email is not valid')
    expect(c.ready).toBe(false)
  })

  it('a quote can carry its own valid-until date, which cannot be before the quote date', () => {
    const q = base()
    q.lines[0] = { code: 'ANA0001', qty: '1', ownDescription: '', ownPrice: '', discPct: '' }
    q.validUntil = '2026-03-15'
    let c = compute(q, items, stores, settings, items.size)
    expect(c.secondDate.getMonth()).toBe(2)
    expect(c.secondDate.getDate()).toBe(15)
    expect(c.ready).toBe(true)
    q.validUntil = '2026-01-05'
    c = compute(q, items, stores, settings, items.size)
    expect(c.problems).toContain('Valid until is before the quote date')
  })

  it('ready when everything is filled', () => {
    const q = base()
    q.lines[0] = { code: 'ANA0001', qty: '1', ownDescription: '', ownPrice: '', discPct: '' }
    expect(compute(q, items, stores, settings, items.size).ready).toBe(true)
  })
})

describe('firstNameOf', () => {
  it('picks the first name for the email greeting', () => {
    expect(firstNameOf('Jo Smith')).toBe('Jo')
    expect(firstNameOf('Smith, Jo')).toBe('Jo')
    expect(firstNameOf('Mr Jo Smith')).toBe('Jo')
    expect(firstNameOf('Dr. Priya Nair')).toBe('Priya')
    expect(firstNameOf('JO SMITH')).toBe('Jo')
    expect(firstNameOf('jo smith')).toBe('Jo')
    expect(firstNameOf('Jo-Anne McDonald')).toBe('Jo-Anne')
    expect(firstNameOf('  ')).toBe('there')
  })
})
