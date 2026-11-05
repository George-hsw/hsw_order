import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConfirm } from './Confirm'
import { PaymentDialog, paidOf } from './PaymentDialog'
import { useToast } from './Toast'
import { dateAU, money, parseDate } from './lib/quote'
import { DEMO, demoDocs, isoDate, supabase, type DocRow } from './lib/supabase'

interface Props {
  isAdmin: boolean
  showBy: boolean // managers and the admin see who created each document
  canPay: (storeId: string) => boolean // anyone in the store, and the admin, can record a deposit or payment
  names: Record<string, string> // creator email -> full name
  refreshKey: number
  onOpen: (d: DocRow) => void
}

/** What a person wants to know at a glance: nothing yet, a deposit taken, or settled. */
function statusLabel(d: DocRow): string {
  if (d.status === 'void') return 'Void'
  const paid = paidOf(d)
  if (paid === 0) return d.doc_type === 'Quote' ? 'Quote' : 'Open'
  if (paid >= d.total_cents) return 'Paid in full'
  return d.payments.every((p) => p.kind === 'deposit') ? 'Deposit received' : 'Part paid'
}
const TYPES: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'Quote', label: 'Quotes' },
  { value: 'Tax Invoice', label: 'Invoices' },
]

export default function Documents({ isAdmin, showBy, canPay, names, refreshKey, onOpen }: Props) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [docs, setDocs] = useState<DocRow[] | null>(null)
  const [failed, setFailed] = useState('')
  const [filter, setFilter] = useState('')
  const [type, setType] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [paying, setPaying] = useState<DocRow | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  /** Quotes only. A tax invoice is a tax record, so it is never deleted from here. */
  const deleteQuote = async (d: DocRow) => {
    if (!(await ask({
      title: `Delete quote ${d.doc_number}?`,
      body: <p>The quote for {d.customer_name} ({money(d.total_cents)}) is removed for good. This cannot be undone.</p>,
      confirmLabel: 'Delete quote',
      danger: true,
    }))) return
    if (DEMO) { toast.info('Demo mode: nothing was deleted.'); return }
    if (!supabase) return
    setDeleting(d.id)
    const { data, error } = await supabase.from('documents').delete().eq('id', d.id).select('id')
    setDeleting(null)
    if (error || !data?.length) { toast.error('Could not delete that quote. You can only delete quotes you are allowed to see.'); return }
    toast.success(`Quote ${d.doc_number} deleted.`)
    load()
  }

  const load = useCallback(async () => {
    setFailed('')
    if (DEMO) return setDocs(demoDocs())
    if (!supabase) return
    const { data, error } = await supabase
      .from('documents')
      .select('id,store_id,doc_type,doc_number,customer_name,total_cents,due_date,status,created_by,created_at,payload,stores(name),payments(amount_cents,kind,paid_on)')
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) {
      setFailed(error.message)
      toast.error(error.message)
    } else setDocs(data as unknown as DocRow[])
  }, [toast])
  useEffect(() => { load() }, [load, refreshKey])

  const shown = useMemo(() => {
    const t = filter.trim().toLowerCase()
    return (docs ?? []).filter(
      (d) => (!type || d.doc_type === type) && (!storeFilter || d.stores?.name === storeFilter) &&
        (!t || `${d.doc_number} ${d.customer_name} ${d.stores?.name ?? ''}`.toLowerCase().includes(t)),
    )
  }, [docs, filter, type, storeFilter])
  const storeNames = useMemo(() => [...new Set((docs ?? []).map((d) => d.stores?.name).filter((n): n is string => !!n))].sort(), [docs])

  const today = isoDate(new Date())

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Documents</h1>
          {docs && <p className="muted">{docs.length} saved {docs.length === 1 ? 'document' : 'documents'}</p>}
        </div>
      </div>
      <div className="filters">
        <input type="search" name="search" aria-label="Search documents" placeholder="Search documents…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {isAdmin && (
          <select name="storeFilter" aria-label="Filter by store" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All stores</option>
            {storeNames.map((n) => <option key={n}>{n}</option>)}
          </select>
        )}
        <div className="segmented" role="group" aria-label="Document type">
          {TYPES.map((t) => (
            <button key={t.value} type="button" aria-pressed={type === t.value} onClick={() => setType(t.value)}>{t.label}</button>
          ))}
        </div>
      </div>

      {failed ? (
        <div className="state error" role="alert">
          <p>Documents could not be loaded.</p>
          <p className="muted">{failed}</p>
          <div className="actions"><button type="button" className="btn" onClick={load}>Try again</button></div>
        </div>
      ) : !docs ? (
        <div className="skeleton" aria-busy="true" aria-label="Loading documents"><i /><i /><i /><i /></div>
      ) : shown.length === 0 ? (
        <div className="state">
          <p>{docs.length === 0 ? 'No documents yet' : 'Nothing matches that search'}</p>
          <p className="muted">{docs.length === 0 ? 'Quotes and invoices you save appear here. Start one from the New tab.' : 'Try a different number, customer or type.'}</p>
        </div>
      ) : (
        <div className="tablewrap">
          <table className="book docs">
            <thead>
              <tr><th>Number</th>{isAdmin && <th>Store</th>}<th>Customer</th>{showBy && <th>By</th>}<th className="r">Total</th><th className="r">Paid</th><th className="r">Balance</th><th>Due</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const paid = paidOf(d)
                const bal = d.total_cents - paid
                const inv = d.doc_type === 'Tax Invoice'
                const hasMoney = inv || paid > 0 // a quote shows deposit and balance once a deposit is taken
                const overdue = inv && bal > 0 && d.due_date && d.due_date < today
                return (
                  <tr key={d.id}>
                    <td data-label="Number"><b className="num">{d.doc_number}</b><br /><small>{dateAU(new Date(d.created_at))}</small></td>
                    {isAdmin && <td data-label="Store">{d.stores?.name}</td>}
                    <td data-label="Customer">{d.customer_name}</td>
                    {showBy && <td data-label="By">{names[(d.created_by ?? '').toLowerCase()] ?? d.created_by ?? '–'}</td>}
                    <td data-label="Total" className="r">{money(d.total_cents)}</td>
                    <td data-label={inv ? 'Paid' : 'Deposit'} className={'r' + (hasMoney ? (inv ? '' : ' qpay') : ' na')}>{hasMoney ? money(paid) : '–'}</td>
                    <td data-label="Balance" className={'r' + (hasMoney ? (inv ? '' : ' qpay') : ' na')}>{hasMoney ? money(bal) : '–'}</td>
                    <td data-label="Due" className={inv ? undefined : 'na'}>{inv && d.due_date ? dateAU(parseDate(d.due_date)!) : '–'}</td>
                    <td data-label="Status"><span className={'chip ' + (overdue ? 'overdue' : inv || paid > 0 ? d.status : 'quote')}>{overdue ? 'Overdue' : statusLabel(d)}</span></td>
                    <td className="rowactions">
                      <button type="button" className="btn" onClick={() => onOpen(d)}>{paid > 0 ? 'View' : 'Open'}</button>
                      {bal > 0 && d.status !== 'void' && canPay(d.store_id) && <button type="button" className="btn primary" onClick={() => setPaying(d)}>{inv ? 'Record payment' : 'Record deposit'}</button>}
                      {!inv && paid === 0 && <button type="button" className="btn danger" disabled={deleting === d.id} onClick={() => deleteQuote(d)}>{deleting === d.id ? 'Deleting…' : 'Delete'}</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {confirmDialog}
      {paying && <PaymentDialog doc={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); load() }} />}
    </>
  )
}
