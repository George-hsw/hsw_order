import { useEffect, useMemo, useRef, useState } from 'react'
import defaultSettings from './data/settings.json'
import { useConfirm } from './Confirm'
import { beep, primeAudio } from './lib/beep'
import { AddressInput } from './AddressInput'
import { clearRemoteDraft, useDraftSync } from './lib/draftSync'
import EmailDialog from './EmailDialog'
import { PaymentDialog, paidOf } from './PaymentDialog'
import Scanner from './Scanner'
import { useToast } from './Toast'
import { findByScan, indexBarcodes, indexItems, loadPriceList, searchItems, type PriceList } from './lib/items'
import { buildPdf } from './lib/pdf'
import {
  MAX_LINES, compute, dateAU, emptyLine, emptyQuote, firstNameOf, money, parseDate,
  type Item, type Line, type QuoteInput, type Settings, type Store,
} from './lib/quote'
import { loadLogo, type Logo } from './lib/logo'
import { DEMO, isoDate, supabase, type DocRow, type PaymentRow, type StoreRow } from './lib/supabase'

interface Props {
  email: string
  isAdmin: boolean
  stores: StoreRow[] // active stores this user may use (one for a store login, all for admin)
  openDoc: DocRow | null // a saved document to edit, or null for a new one
  canPay: (storeId: string) => boolean // anyone in the store, and the admin, can record a deposit or payment
  onSaved: () => void
  onNew: () => void // reset to a fresh builder
}

const normalise = (d: Partial<QuoteInput> | undefined): QuoteInput => {
  const base = emptyQuote()
  return {
    ...base, ...d,
    date: d?.date || base.date,
    customer: { ...base.customer, ...d?.customer },
    lines: Array.from({ length: MAX_LINES }, (_, i) => d?.lines?.[i] ?? emptyLine()),
  }
}

export default function Builder({ email, isAdmin, stores: storeRows, openDoc, canPay, onSaved, onNew }: Props) {
  const draftKey = `hsw-quote-draft:${email}`
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [quote, setQuote] = useState<QuoteInput>(() => {
    if (openDoc) return normalise(openDoc.payload as QuoteInput)
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) return normalise(JSON.parse(raw))
    } catch { /* ignore */ }
    return emptyQuote()
  })
  const [docId, setDocId] = useState<string | null>(openDoc?.id ?? null)
  const docIdRef = useRef<string | null>(openDoc?.id ?? null)
  const [emailOpen, setEmailOpen] = useState(false)
  const [downloadedStamp, setDownloadedStamp] = useState('') // the PDF content last downloaded, to avoid a duplicate download
  const [savedType, setSavedType] = useState(openDoc?.doc_type ?? null)
  // Money recorded on this document. A quote that holds a deposit, or an invoice with payments, is frozen; making the
  // quote into an invoice unfreezes the form (the deposit moves across to the new invoice when it is saved).
  const [payments, setPayments] = useState<PaymentRow[]>(openDoc?.payments ?? [])
  const [paying, setPaying] = useState(false)
  const convertFrom = useRef<string | null>(null) // the quote being turned into this invoice
  const locked = payments.length > 0 && quote.docType === savedType
  const [priceList, setPriceList] = useState<PriceList | null>(null)
  const [find, setFind] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [logo, setLogo] = useState<Logo | null>(null)
  useEffect(() => { loadLogo().then(setLogo) }, [])

  useEffect(() => { loadPriceList().then(setPriceList).catch((e) => toast.error(`Could not load the price list. ${e.message ?? e}`)) }, [])
  useEffect(() => {
    if (docId || openDoc) return
    try { localStorage.setItem(draftKey, JSON.stringify(quote)); localStorage.setItem(`${draftKey}:at`, String(Date.now())) } catch { /* ignore */ }
  }, [quote, docId, openDoc, draftKey])
  // The unsaved quote is shared live with the same person's other devices: a scan on the phone shows on the computer, and a line deleted on one goes from both.
  useDraftSync({ enabled: !docId && !openDoc && !DEMO, quote, setQuote, normalise, draftKey })

  // A store login can only ever use its own store.
  useEffect(() => {
    if (!isAdmin && storeRows[0] && quote.storeName !== storeRows[0].name) setQuote((q) => ({ ...q, storeName: storeRows[0].name }))
  }, [isAdmin, storeRows, quote.storeName])

  const stores: Store[] = useMemo(
    () => storeRows.map((s) => ({ name: s.name, address: s.address, suburb: s.suburb, phone: s.phone, code: s.code, email: s.email ?? '' })),
    [storeRows],
  )
  const selRow = storeRows.find((s) => s.name === quote.storeName)
  const settings: Settings = useMemo(
    () => ({
      ...(defaultSettings as Settings),
      legalName: selRow?.legal_name ?? '', abn: selRow?.abn ?? '',
      bankName: selRow?.bank_name ?? '', bsb: selRow?.bsb ?? '', account: selRow?.account ?? '',
    }),
    [selRow],
  )

  const itemIndex = useMemo(() => indexItems(priceList?.items ?? []), [priceList])
  const barcodeIndex = useMemo(() => indexBarcodes(priceList?.items ?? []), [priceList])
  // Payments recorded in the database feed the printed Paid / Balance due lines.
  const paidCents = savedType === quote.docType || (savedType !== null && savedType !== 'Tax Invoice' && quote.docType === 'Tax Invoice') ? paidOf({ payments }) : 0
  const quoteEff = useMemo(() => (paidCents > 0 ? { ...quote, paid: String(paidCents / 100) } : quote), [quote, paidCents])
  const c = useMemo(
    () => compute(quoteEff, itemIndex, stores, settings, priceList?.items.length ?? 0),
    [quoteEff, itemIndex, stores, settings, priceList],
  )
  const matches = useMemo(() => searchItems(priceList?.items ?? [], find), [priceList, find])
  const isInvoice = quote.docType === 'Tax Invoice'
  const isOrder = quote.docType === 'Customer Order'
  // the valid-until and due dates show their real default, so there is nothing to guess at
  const addIso = (n: number) => { const d = parseDate(quote.date) ?? new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
  const validDefault = addIso(settings.validDays)
  const dueDefault = addIso(settings.dueDays)

  const set = <K extends keyof QuoteInput>(k: K, v: QuoteInput[K]) => setQuote((q) => ({ ...q, [k]: v }))
  const setCust = (k: keyof QuoteInput['customer'], v: string) =>
    setQuote((q) => ({ ...q, customer: { ...q.customer, [k]: v } }))
  const setLine = (i: number, patch: Partial<Line>) =>
    setQuote((q) => ({ ...q, lines: q.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) }))

  // Converting a saved quote to an invoice creates a NEW document (same digits, INV- prefix); its deposit moves across.
  const changeType = (t: QuoteInput['docType']) => {
    set('docType', t)
    if (savedType && t !== savedType) {
      convertFrom.current = (savedType === 'Quote' || savedType === 'Customer Order') && t === 'Tax Invoice' ? (docIdRef.current ?? docId) : null
      setDocId(null)
    } else {
      convertFrom.current = null
      if (docIdRef.current) setDocId(docIdRef.current)
    }
  }

  /** Add an item by scan/search. Re-scanning an item already on the quote adds 1 to its qty. */
  const addItem = (it: Item): string => {
    const existing = quote.lines.findIndex((l) => l.code.trim() === it.code && !l.ownDescription.trim() && !l.ownPrice.trim())
    if (existing !== -1) {
      const q = Number(quote.lines[existing].qty) || 1
      setLine(existing, { qty: String(q + 1) })
      return `${it.description} – qty ${q + 1}`
    }
    const i = quote.lines.findIndex((l) => !l.code.trim() && !l.ownDescription.trim())
    if (i === -1) return `All ${MAX_LINES} lines are in use.`
    setLine(i, { code: it.code, qty: '1' })
    return `Added ${it.description}`
  }
  const handleScan = (value: string) => {
    const it = findByScan(value, itemIndex, barcodeIndex)
    if (!it) { beep('miss'); setScanMsg(`${value} – not in the price list`); return }
    const msg = addItem(it)
    beep(msg.startsWith('All') ? 'miss' : 'ok')
    setScanMsg(msg)
  }
  const addFromSearch = (it: Item) => {
    const msg = addItem(it)
    if (msg.startsWith('All')) toast.error(msg)
    setFind('')
  }
  // USB / Bluetooth scanners type the code then press Enter.
  const onFinderEnter = () => {
    const it = findByScan(find, itemIndex, barcodeIndex)
    if (it) addFromSearch(it)
    else if (matches.length === 1) addFromSearch(matches[0])
  }
  const clearLine = (i: number) => setLine(i, emptyLine())
  const visible = (() => {
    const used = quote.lines.map((l) => !!(l.code.trim() || l.ownDescription.trim() || l.qty || l.ownPrice))
    const firstBlank = used.indexOf(false)
    return quote.lines.map((_, i) => used[i] || i === firstBlank)
  })()

  /** Saves to Supabase. Returns the document id, or null (and shows why). */
  const save = async (): Promise<boolean> => {
    if (locked) return true
    if (DEMO) { toast.success('Demo mode: not saved.'); return true }
    if (!supabase || !selRow) { toast.error('Pick a store first.'); return false }
    if (!c.docNumber || !quote.customer.name.trim()) {
      toast.error('Enter the number and customer name before saving.'); return false
    }
    const row = {
      store_id: selRow.id, doc_type: quote.docType, doc_number: c.docNumber,
      customer_name: quote.customer.name.trim(), customer_email: quote.customer.email.trim() || null,
      total_cents: c.totalCents, due_date: isInvoice ? isoDate(c.secondDate) : null,
      payload: quote, created_by: email,
    }
    const q = docId
      ? supabase.from('documents').update(row).eq('id', docId).select('id').single()
      : supabase.from('documents').insert({ ...row, ...(isOrder ? { fulfilment: 'to_order' } : {}), ...(convertFrom.current ? { from_quote: convertFrom.current } : {}) } as typeof row).select('id').single()
    const { data, error } = await q
    if (error) {
      toast.error(error.code === '23505' ? `${c.docNumber} already exists for this store, so use a different number.` : error.message)
      return false
    }
    docIdRef.current = data.id
    convertFrom.current = null
    setDocId(data.id); setSavedType(quote.docType)
    try { localStorage.removeItem(draftKey); localStorage.removeItem(`${draftKey}:at`) } catch { /* ignore */ }
    void clearRemoteDraft()
    toast.success(`Saved ${c.docNumber}.`)
    onSaved()
    return true
  }

  /** Preview/Download stay clickable; when something is missing we say exactly what. */
  const showProblems = () => toast.error(c.problems)
  const doSave = async () => { setBusy(true); await save(); setBusy(false) }
  /** A deposit or payment is taken against the saved document, so save any changes first. */
  const openPay = async () => {
    setBusy(true)
    const ok = await save()
    setBusy(false)
    if (ok) setPaying(true)
  }
  const afterPayment = async () => {
    setPaying(false)
    if (!DEMO && supabase && docIdRef.current) {
      const { data } = await supabase.from('payments').select('amount_cents,kind,paid_on').eq('document_id', docIdRef.current)
      if (data) setPayments(data as PaymentRow[])
    }
    onSaved()
  }
  const download = async () => {
    if (!c.ready) return showProblems()
    setBusy(true)
    const ok = await save()
    setBusy(false)
    if (ok) {
      buildPdf(quoteEff, c, settings, logo).save(`${c.fileName || 'quote'}.pdf`)
      setDownloadedStamp(JSON.stringify(quoteEff))
      setEmailOpen(true)
    }
  }
  const preview = () => c.ready ? window.open(URL.createObjectURL(buildPdf(quoteEff, c, settings, logo).output('blob')), '_blank') : showProblems()
  /** Saves, builds the PDF and sends it through the send-document function. */
  const sendEmail = async (to: 'customer' | 'store', toEmail: string, message: string): Promise<boolean> => {
    if (!c.ready) { showProblems(); return false }
    if (!(await save())) return false
    if (DEMO) {
      toast.success(`Demo mode: the email to ${to === 'store' ? 'the store' : toEmail} was not sent.`)
      return true
    }
    if (!supabase || !docIdRef.current) return false
    const pdf = buildPdf(quoteEff, c, settings, logo).output('datauristring').split(',')[1]
    const { data, error } = await supabase.functions.invoke('send-document', {
      body: { document_id: docIdRef.current, to, to_email: toEmail, message, pdf_base64: pdf },
    })
    if (error || data?.error) {
      let msg = data?.error as string | undefined
      if (!msg && error && 'context' in error) msg = (await (error as { context: Response }).context.json().catch(() => null))?.error
      toast.error(msg ?? 'The email could not be sent.')
      return false
    }
    toast.success(`Sent to ${data.sent_to}${data.bcc ? `, with a copy to ${data.bcc}` : ''}.`)
    return true
  }
  const firstName = firstNameOf(quote.customer.name)
  const docWord = isInvoice ? 'tax invoice' : isOrder ? 'customer order' : 'quote'
  const emailSubject = `${isInvoice ? 'Tax invoice' : isOrder ? 'Customer order' : 'Quote'} ${c.docNumber} from Howards Storage World${selRow ? ` ${selRow.name}` : ''}`
  const emailBody = [
    `Hi ${firstName},`,
    '',
    `Please find your ${docWord} ${c.docNumber} attached.`,
    '',
    `Total (incl GST): ${money(c.totalCents)}`,
    ...(isInvoice
      ? [c.balanceCents > 0 ? `Balance due: ${money(c.balanceCents)} by ${dateAU(c.secondDate)}` : 'Paid in full']
      : [`${isOrder ? 'Expected by' : 'Valid until'}: ${dateAU(c.secondDate)}`]),
    '',
    selRow?.phone
      ? `If you have any questions, reply to this email or call us on ${selRow.phone}.`
      : 'If you have any questions, reply to this email.',
    '',
    'Kind regards,',
    ...(quote.servedBy.trim() ? [quote.servedBy.trim()] : []),
    `Howards Storage World${selRow ? ` ${selRow.name}` : ''}`,
    ...(selRow?.phone ? [`Phone: ${selRow.phone}`] : []),
    ...(selRow?.email ? [`Email: ${selRow.email}`] : []),
  ].join('\n')
  /** Saves the document and builds the PDF for the email dialog. */
  const prepareEmail = async (): Promise<{ fileName: string; blob: Blob } | null> => {
    if (!c.ready) { showProblems(); return null }
    if (!(await save())) return null
    return { fileName: `${c.fileName || 'quote'}.pdf`, blob: buildPdf(quoteEff, c, settings, logo).output('blob') }
  }
  const openEmail = () => (c.ready ? setEmailOpen(true) : showProblems())
  const newQuote = async () => {
    if (!(await ask({ title: 'Start a new one?', body: <p>This clears everything on the form.</p>, confirmLabel: 'Clear and start new' }))) return
    try { localStorage.removeItem(draftKey); localStorage.removeItem(`${draftKey}:at`) } catch { /* ignore */ }
    void clearRemoteDraft()
    onNew()
  }

  return (
    <div className="builder">
      <div className="pagehead">
        <div>
          <h1>{openDoc ? openDoc.doc_number : 'New quote or invoice'}</h1>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={newQuote}>Clear form</button></div>
      </div>

      {locked && (
        <div className="note">
          {savedType !== 'Tax Invoice'
            ? <p>A deposit of {money(paidCents)} is recorded on this {savedType === 'Customer Order' ? 'customer order' : 'quote'}, so it can no longer be edited. You can still download the PDF.</p>
            : <p>This invoice has payments recorded, so it can no longer be edited. You can still download the PDF.</p>}
          {savedType !== 'Tax Invoice' && <div className="actions"><button type="button" className="btn" onClick={() => changeType('Tax Invoice')}>Make this a tax invoice</button></div>}
        </div>
      )}

      <div className="workspace">
        <fieldset disabled={locked} className="plain">
          <div className="sheet">
            <section className="block">
              <h2>Document</h2>
              <div className="grid">
                <label>Document type
                  <select name="docType" value={quote.docType} onChange={(e) => changeType(e.target.value as QuoteInput['docType'])}>
                    <option>Quote</option><option>Customer Order</option><option>Tax Invoice</option>
                  </select>
                </label>
                <label>Store
                  <select name="store" value={quote.storeName} disabled={!isAdmin} onChange={(e) => set('storeName', e.target.value)}>
                    {isAdmin && <option value="">Select…</option>}
                    {storeRows.map((s) => <option key={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label>Number <small>digits only, e.g. 1001</small>
                  <input name="number" inputMode="numeric" value={quote.number} onChange={(e) => set('number', e.target.value)} />
                </label>
                <label>Document no. <small>made from the number</small><input readOnly value={c.docNumber} /></label>
                <label>Date
                  <input name="date" type="date" value={quote.date} onChange={(e) => set('date', e.target.value)} />
                </label>
                {!isInvoice && (
                  <label>{isOrder ? 'Expected by' : 'Valid until'}
                    <input name="validUntil" type="date" value={quote.validUntil || validDefault} onChange={(e) => set('validUntil', e.target.value)} />
                  </label>
                )}
                <label>Served by <small>first name</small>
                  <input name="servedBy" autoComplete="given-name" value={quote.servedBy} onChange={(e) => set('servedBy', e.target.value)} />
                </label>
              </div>
            </section>

            <section className="block">
              <h2>Customer</h2>
              <div className="grid">
                <label>Customer name <small>required</small><input name="customerName" autoComplete="off" value={quote.customer.name} onChange={(e) => setCust('name', e.target.value)} /></label>
                <label>Company<input name="company" autoComplete="off" value={quote.customer.company} onChange={(e) => setCust('company', e.target.value)} /></label>
                <label>Customer ABN<input name="customerAbn" inputMode="numeric" autoComplete="off" value={quote.customer.abn} onChange={(e) => setCust('abn', e.target.value)} /></label>
                <label>Phone <small>required</small><input name="phone" aria-required="true" type="tel" autoComplete="off" value={quote.customer.phone} onChange={(e) => setCust('phone', e.target.value)} /></label>
                <label>Email <small>required</small><input name="email" aria-required="true" type="email" autoComplete="off" value={quote.customer.email} onChange={(e) => setCust('email', e.target.value)} /></label>
                <label className="addr-field">Address <small>start typing to search</small><AddressInput name="address" value={quote.customer.address} onChange={(v) => setCust('address', v)}
                  onPick={(a) => setQuote((q) => ({ ...q, customer: { ...q.customer, address: a.street, suburb: a.suburb } }))} /></label>
                <label>Suburb / State / Postcode<input name="suburb" autoComplete="off" value={quote.customer.suburb} onChange={(e) => setCust('suburb', e.target.value)} /></label>
                <label className="addr-field">Deliver / install to <small>if different</small><AddressInput name="deliverTo" value={quote.customer.deliverTo} onChange={(v) => setCust('deliverTo', v)}
                  onPick={(a) => setCust('deliverTo', a.label)} /></label>
              </div>
            </section>

            <section className="block">
              <h2>Items</h2>
              <div className="finder">
                <div className="findrow">
                  <input type="search" name="find" aria-label="Find an item" placeholder="Scan, or type a code, barcode or name…" value={find} enterKeyHint="search"
                    onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onFinderEnter()} />
                  <button type="button" className="btn" onClick={() => { primeAudio(); setScanMsg(''); setScanning(true) }}>
                    <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M12 8v8M16 8v8"/></svg>
                    Scan barcode
                  </button>
                </div>
                {!DEMO && <p className="muted desktop-only">Scan with your phone: sign in on it and tap Scan barcode. Items appear here at the same time, and a line you delete on either device goes from both.</p>}
                {matches.length > 0 && (
                  <ul className="results">
                    {matches.map((m) => (
                      <li key={m.code} onClick={() => addFromSearch(m)}>
                        <b>{m.code}</b> {m.description}
                        <span>{m.price ? money(Math.round(m.price * 100)) : 'no price'}{m.status && m.status !== 'ACTIVE' ? `, ${m.status}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="tablewrap">
                <table className="items">
                  <thead>
                    <tr><th>Item code</th><th>Qty</th><th>Description (LS)</th><th className="r">Unit price</th><th>Own description</th><th className="r">Own price</th><th className="r">Disc %</th><th className="r">Line total</th><th><span className="visually-hidden">Remove</span></th></tr>
                  </thead>
                  <tbody>
                    {quote.lines.map((l, i) => {
                      if (!visible[i]) return null
                      const r = c.lines.find((x) => x.index === i)
                      const item = itemIndex.get(l.code.trim())
                      return (
                        <tr key={i}>
                          <td data-label="Item code"><input className="code" aria-label="Item code" autoComplete="off" value={l.code} onChange={(e) => setLine(i, { code: e.target.value })} /></td>
                          <td data-label="Qty"><input className="qty" aria-label="Quantity" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                          <td data-label="Description" className="desc">{item?.description ?? ''}{r?.message ? <small className={'chk ' + r.state}>{r.message}</small> : null}</td>
                          <td data-label="Unit price" className="r">{item?.price != null ? money(Math.round(item.price * 100)) : ''}</td>
                          <td data-label="Own description"><input aria-label="Own description" autoComplete="off" value={l.ownDescription} onChange={(e) => setLine(i, { ownDescription: e.target.value })} /></td>
                          <td data-label="Own price"><input className="qty" aria-label="Own price" inputMode="decimal" value={l.ownPrice} onChange={(e) => setLine(i, { ownPrice: e.target.value })} /></td>
                          <td data-label="Disc %"><input className="qty" aria-label="Discount percent" inputMode="decimal" value={l.discPct} onChange={(e) => setLine(i, { discPct: e.target.value })} /></td>
                          <td data-label="Line total" className="r">{r ? money(r.totalCents) : ''}</td>
                                          <td className="x"><button type="button" className="btn" aria-label="Remove line" onClick={() => clearLine(i)}>&times;</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="block">
              <h2>Delivery &amp; installation <small>incl GST, leave blank if not needed</small></h2>
              <div className="grid">
                <label>Delivery fee<input name="deliveryFee" inputMode="decimal" value={quote.deliveryFee} onChange={(e) => set('deliveryFee', e.target.value)} /></label>
                <label>Delivery note<input name="deliveryNote" value={quote.deliveryNote} onChange={(e) => set('deliveryNote', e.target.value)} /></label>
                <label>Installation fee<input name="installFee" inputMode="decimal" value={quote.installFee} onChange={(e) => set('installFee', e.target.value)} /></label>
                <label>Installation note<input name="installNote" value={quote.installNote} onChange={(e) => set('installNote', e.target.value)} /></label>
              </div>
            </section>

            {isInvoice && (
              <section className="block">
                <h2>Payment terms</h2>
                <div className="grid">
                  <label>Due date
                    <input name="dueDate" type="date" value={quote.dueDate || dueDefault} onChange={(e) => set('dueDate', e.target.value)} />
                  </label>
                </div>
                <p className="muted">Deposits and payments are recorded from the Documents list once the invoice is saved. The franchise owner is emailed each time.</p>
              </section>
            )}

            <section className="block">
              <h2>Notes for the customer <small>printed: measurements, colours, lead times</small></h2>
              <textarea name="notes" aria-label="Notes for the customer" rows={4} value={quote.notes} onChange={(e) => set('notes', e.target.value)} />
            </section>
          </div>
        </fieldset>

        <aside className="ledger" aria-label="Totals and actions">
          <div className="ledger-head" role="status">
            <p className="big">{c.ready ? 'Ready to issue' : 'Not ready'}</p>
            {c.ready
              ? <p>{c.docNumber}</p>
              : <ul>{c.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
          <div className="ledger-body">
            <dl>
              <dt>Items</dt><dd>{money(c.itemsCents)}</dd>
              <dt>Delivery</dt><dd>{money(c.deliveryCents)}</dd>
              <dt>Installation</dt><dd>{money(c.installCents)}</dd>
              <dt className="total">Total (incl GST)</dt><dd className="total">{money(c.totalCents)}</dd>
              <dt>GST included</dt><dd>{money(c.gstCents)}</dd>
              {paidCents > 0 && (
                <><dt>{isInvoice ? 'Paid' : 'Deposit received'}</dt><dd>{money(c.paidCents)}</dd><dt className="total">Balance due</dt><dd className="total">{money(c.balanceCents)}</dd></>
              )}
            </dl>
            <dl className="ledger-meta">
              <dt><label htmlFor="ledger-date">{isInvoice ? 'Due date' : isOrder ? 'Expected by' : 'Valid until'}</label></dt>
              <dd>
                <input id="ledger-date" type="date" disabled={locked}
                  value={isInvoice ? quote.dueDate || dueDefault : quote.validUntil || validDefault}
                  onChange={(e) => (isInvoice ? set('dueDate', e.target.value) : set('validUntil', e.target.value))} />
              </dd>
              <dt>PDF name</dt><dd>{c.fileName ? <code>{c.fileName}.pdf</code> : 'Available once the store, number and customer name are set'}</dd>
            </dl>
            <div className="actions">
              <button type="button" className={'btn primary wide' + (c.ready ? '' : ' blocked')} aria-disabled={!c.ready} onClick={download} disabled={busy}>{locked ? 'Download PDF' : 'Save & download PDF'}</button>
              <button type="button" className="btn wide" onClick={preview}>Preview PDF</button>
              <button type="button" className="btn wide" onClick={openEmail} disabled={busy}>Email PDF</button>
              {!locked && <button type="button" className="btn wide" onClick={doSave} disabled={busy}>Save</button>}
              {selRow && canPay(selRow.id) && savedType === quote.docType && c.totalCents - paidCents > 0 && (
                <button type="button" className="btn wide" onClick={openPay} disabled={busy}>{isInvoice ? 'Record payment' : 'Record deposit'}</button>
              )}
            </div>
          </div>
        </aside>
      </div>
      <div className="stickybar">
        <div><small>Total (incl GST)</small><b className="num">{money(c.totalCents)}</b></div>
        <button type="button" className={'btn primary' + (c.ready ? '' : ' blocked')} aria-disabled={!c.ready} onClick={download} disabled={busy}>{locked ? 'Download PDF' : 'Save & download PDF'}</button>
      </div>
      {paying && docIdRef.current && (
        <PaymentDialog
          doc={{ id: docIdRef.current, doc_type: quote.docType, doc_number: c.docNumber, customer_name: quote.customer.name.trim(), total_cents: c.totalCents, payments }}
          onClose={() => setPaying(false)} onDone={afterPayment} />
      )}
      {emailOpen && (
        <EmailDialog
          docLabel={`${quote.docType} ${c.docNumber}`}
          customerName={quote.customer.name.trim()}
          customerEmail={quote.customer.email.trim()}
          storeEmail={selRow?.email ?? null}
          subject={emailSubject}
          body={emailBody}
          alreadyDownloaded={downloadedStamp === JSON.stringify(quoteEff)}
          prepare={prepareEmail}
          onDownloaded={() => setDownloadedStamp(JSON.stringify(quoteEff))}
          onClose={() => setEmailOpen(false)}
          onSend={sendEmail}
        />
      )}
      {confirmDialog}
      {scanning && <Scanner onScan={handleScan} onClose={() => setScanning(false)} feedback={scanMsg} />}
    </div>
  )
}
