// Pure quote logic. Mirrors the formulas in HSW_Quote_Invoice_Builder.xlsx
// (NEW QUOTE + PRINT QUOTE sheets). Money is held in integer cents.

export type DocType = 'Quote' | 'Tax Invoice'

export interface Item {
  code: string
  description: string
  price: number | null // dollars, GST inclusive
  status: string
  barcode?: string
}

export interface Store {
  name: string
  address: string
  suburb: string
  phone: string
  code: string
  email: string
}

export interface Settings {
  legalName: string
  abn: string
  website: string
  validDays: number
  dueDays: number
  howToAccept: string
  howToPay: string
  bankName: string
  bsb: string
  account: string
  terms: string
  footer: string
}

export interface Line {
  code: string
  qty: string // raw input; blank counts as 1
  ownDescription: string
  ownPrice: string // raw input dollars; blank = use LS price
  discPct: string // raw input 0-100; blank = full price
}

export interface QuoteInput {
  docType: DocType
  storeName: string
  number: string
  date: string // yyyy-mm-dd
  validUntil: string // quotes: yyyy-mm-dd, blank = date + the default validity days
  servedBy: string
  customer: {
    name: string
    company: string
    abn: string
    phone: string
    email: string
    address: string
    suburb: string
    deliverTo: string
  }
  lines: Line[]
  deliveryFee: string
  deliveryNote: string
  installFee: string
  installNote: string
  paid: string
  dueDate: string // yyyy-mm-dd, blank = settings days
  notes: string
}

export const MAX_LINES = 20

const EMAIL_RE = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/

/** Today as yyyy-mm-dd in local time. */
export const todayISO = () => new Date().toLocaleDateString('en-CA')

export const emptyLine = (): Line => ({ code: '', qty: '', ownDescription: '', ownPrice: '', discPct: '' })

export const emptyQuote = (): QuoteInput => ({
  docType: 'Quote',
  storeName: '',
  number: '',
  date: todayISO(),
  validUntil: '',
  servedBy: '',
  customer: { name: '', company: '', abn: '', phone: '', email: '', address: '', suburb: '', deliverTo: '' },
  lines: Array.from({ length: MAX_LINES }, emptyLine),
  deliveryFee: '',
  deliveryNote: '',
  installFee: '',
  installNote: '',
  paid: '',
  dueDate: '',
  notes: '',
})

export type LineState = 'empty' | 'ok' | 'warn' | 'error'

export interface ResolvedLine {
  index: number
  code: string
  description: string
  qty: number
  unitCents: number
  discount: number // 0..1
  totalCents: number
  state: LineState
  message: string
}

export interface Computed {
  lines: ResolvedLine[] // only lines that are in use (code or own description entered)
  itemsCents: number
  deliveryCents: number
  installCents: number
  totalCents: number
  gstCents: number
  paidCents: number
  balanceCents: number
  docNumber: string
  fileName: string
  date: Date
  secondDate: Date // valid-until (quote) or due date (invoice)
  store: Store | undefined
  problems: string[]
  ready: boolean
}

/** Excel N(): numbers only, anything else is 0. Accepts "1,234.50" and "$12". */
export function num(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const t = v.replace(/[$,\s]/g, '')
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

const toCents = (dollars: number) => Math.round(dollars * 100)

export function parseDate(s: string): Date | undefined {
  if (!s) return undefined
  const d = new Date(s + 'T00:00:00')
  return isNaN(d.getTime()) ? undefined : d
}

const addDays = (d: Date, n: number) => {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export const isPlaceholder = (s: string) => s.trim() === '' || s.trim().startsWith('[')

export function compute(
  q: QuoteInput,
  itemIndex: Map<string, Item>,
  stores: Store[],
  settings: Settings,
  itemCount: number,
): Computed {
  const store = stores.find((s) => s.name === q.storeName)
  const storeCode = store ? store.code.trim().toUpperCase() : ''
  const isInvoice = q.docType === 'Tax Invoice'
  const number = q.number.trim()
  const docNumber = !number || !storeCode ? '' : `${isInvoice ? 'INV' : 'Q'}-${storeCode}-${number}`
  const date = parseDate(q.date) ?? startOfToday()

  const lines: ResolvedLine[] = []
  q.lines.forEach((l, index) => {
    const code = l.code.trim()
    const own = l.ownDescription.trim()
    if (!code && !own) return // not in use

    const item = code ? itemIndex.get(code) : undefined
    const description = own || item?.description || ''
    const ownPrice = num(l.ownPrice)
    const lsPrice = item?.price ?? undefined
    const price = ownPrice ?? lsPrice

    const qtyRaw = num(l.qty)
    const qty = qtyRaw !== undefined && qtyRaw > 0 ? qtyRaw : 1
    const discRaw = num(l.discPct) ?? 0
    const discount = Math.min(1, Math.max(0, discRaw / 100))

    let state: LineState = 'ok'
    let message = 'OK'
    if (code && !item) {
      state = 'error'
      message = 'Code not found – check it, or type own description & price'
    } else if (price === undefined || price === null) {
      state = 'error'
      message = 'No price – type an own price'
    } else if (price === 0) {
      state = 'error'
      message = 'Price is $0 in LS – type an own price'
    } else if (qtyRaw === undefined || qtyRaw < 1) {
      state = 'warn'
      message = 'Qty blank – counted as 1'
    } else if (!item) {
      state = 'warn'
      message = 'Manual line (not in LS)'
    } else if (item.status && item.status.toUpperCase() !== 'ACTIVE') {
      message = `OK · ${item.status}`
    }

    const unitCents = price !== undefined && price !== null ? toCents(price) : 0
    const totalCents = price !== undefined && price !== null ? Math.round(qty * unitCents * (1 - discount)) : 0
    lines.push({ index, code, description, qty, unitCents, discount, totalCents, state, message })
  })

  const itemsCents = lines.reduce((a, l) => a + l.totalCents, 0)
  const deliveryCents = toCents(num(q.deliveryFee) ?? 0)
  const installCents = toCents(num(q.installFee) ?? 0)
  const totalCents = itemsCents + deliveryCents + installCents
  const gstCents = Math.round(totalCents / 11) // prices include GST, as on hsw.com.au: GST = total / 11
  const paidCents = toCents(num(q.paid) ?? 0) // a deposit taken on a quote shows too
  const balanceCents = totalCents - paidCents

  const dueOverride = parseDate(q.dueDate)
  const validOverride = parseDate(q.validUntil)
  const secondDate = isInvoice ? dueOverride ?? addDays(date, settings.dueDays) : validOverride ?? addDays(date, settings.validDays)

  const problems: string[] = []
  if (!q.storeName.trim()) problems.push('Pick a store')
  else if (!storeCode) problems.push('Store has no code in settings')
  if (!number) problems.push('Enter a number')
  if (!q.customer.name.trim()) problems.push('Enter the customer name')
  if (!q.customer.phone.trim()) problems.push('Enter the customer phone number')
  if (!EMAIL_RE.test(q.customer.email.trim())) problems.push(q.customer.email.trim() ? 'The customer email is not valid' : 'Enter the customer email')
  if (!isInvoice && validOverride && secondDate < date) problems.push('Valid until is before the quote date')
  if (isInvoice && dueOverride && secondDate < date) problems.push('The due date is before the invoice date')
  if (lines.length === 0) problems.push('Add at least one item')
  else if (lines.some((l) => l.state === 'error')) problems.push('Fix the red item checks')
  if (isInvoice && (isPlaceholder(settings.abn) || isPlaceholder(settings.legalName)))
    problems.push('This store has no ABN / legal name set – ask the admin')
  if (itemCount === 0) problems.push('The price list is empty')

  const fileName = docNumber ? `${docNumber} ${q.customer.name.trim()}`.trim() : ''

  return {
    lines, itemsCents, deliveryCents, installCents, totalCents, gstCents, paidCents, balanceCents,
    docNumber, fileName, date, secondDate, store, problems, ready: problems.length === 0,
  }
}

export const money = (cents: number) =>
  '$' + (cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const dateAU = (d: Date) =>
  d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })

/** Customer block on the printed page: non-empty lines packed top to bottom (PRINT QUOTE E12:E17). */
export function customerBlock(q: QuoteInput): string[] {
  const c = q.customer
  const contact = [c.phone.trim(), c.email.trim()].filter(Boolean).join(' · ')
  return [
    c.name.trim(),
    c.company.trim(),
    c.abn.trim() ? `ABN ${c.abn.trim()}` : '',
    c.address.trim(),
    c.suburb.trim(),
    contact,
  ].filter(Boolean)
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof'])

/** The name to greet: "Jo Smith" gives Jo, "Smith, Jo" gives Jo, "Mr Jo Smith" gives Jo. Blank gives "there". */
export function firstNameOf(full: string): string {
  let name = full.trim()
  if (!name) return 'there'
  if (name.includes(',')) name = name.split(',').slice(1).join(' ').trim() || name.split(',')[0].trim() // "Smith, Jo"
  const words = name.split(/\s+/).filter((w) => !TITLES.has(w.replace(/\./g, '').toLowerCase()))
  const first = words[0] ?? name.split(/\s+/)[0]
  // tidy ALL CAPS or all lower case, leave "McDonald" and "Jo-Anne" alone
  return first === first.toUpperCase() || first === first.toLowerCase()
    ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
    : first
}
