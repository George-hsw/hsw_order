import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildPdf } from './pdf'
import { compute, emptyQuote, type Item, type Settings, type Store } from './quote'

const store: Store = { name: 'Mornington', address: '1128-1132 Nepean Highway', suburb: 'Mornington VIC 3931', phone: '(03) 5973 5399', code: 'MOR', email: '' }
const settings: Settings = {
  legalName: 'ABC Pty Ltd t/a Howards Storage World', abn: '12 345 678 901', website: 'hsw.com.au', validDays: 30, dueDays: 7,
  howToAccept: 'To accept, reply to this email or visit the store with your quote number.', howToPay: 'Pay in store or by bank transfer.',
  bankName: 'ABC Pty Ltd', bsb: '000-000', account: '12345678', terms: 'All prices are in AUD and include GST.', footer: 'Thank you for choosing Howards Storage World',
}
const items = new Map<string, Item>([['ANA0001', { code: 'ANA0001', description: 'TOWEL TO GO BALI ANTHRACITE', price: 59.95, status: 'ACTIVE' }]])

describe('buildPdf', () => {
  it('renders a quote and an invoice; writes PDF_OUT when set for eyeballing', () => {
    const q = emptyQuote()
    q.storeName = 'Mornington'; q.number = '1001'; q.date = '2026-01-10'; q.servedBy = 'George'
    q.customer = { ...q.customer, name: 'Jo Smith', phone: '0400 000 000', email: 'jo@example.com', address: '1 Test St', suburb: 'Mornington VIC 3931' }
    q.lines[0] = { code: 'ANA0001', qty: '3', ownDescription: '', ownPrice: '', discPct: '10' }
    q.lines[1] = { code: '', qty: '2', ownDescription: 'Custom wardrobe fit-out', ownPrice: '1000', discPct: '' }
    q.deliveryFee = '100'; q.installNote = 'two installers'; q.installFee = '210'; q.paid = '500'
    q.notes = 'Measurements to be confirmed on site.'
    for (const docType of ['Quote', 'Tax Invoice'] as const) {
      q.docType = docType
      const c = compute(q, items, [store], settings, 1)
      expect(c.ready).toBe(true)
      const logo = { data: `data:image/png;base64,${readFileSync('public/logo.png').toString('base64')}`, width: 861, height: 230 }
      const doc = buildPdf(q, c, settings, logo)
      expect(doc.getNumberOfPages()).toBe(1)
      if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}-${docType.replace(' ', '')}.pdf`, Buffer.from(doc.output('arraybuffer')))
    }
  })
})
