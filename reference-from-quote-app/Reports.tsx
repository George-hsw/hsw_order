import { useCallback, useEffect, useMemo, useState } from 'react'
import { useToast } from './Toast'
import { money } from './lib/quote'
import { periodStart, summarise, type ReportDoc } from './lib/reports'
import { DEMO, demoDocs, supabase, type StoreRow } from './lib/supabase'

interface Props {
  isAdmin: boolean
  stores: StoreRow[]
  names: Record<string, string> // creator email -> full name
}

type Period = 'month' | '30' | '90' | 'all'
const PERIODS: { value: Period; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]

type Doc = ReportDoc & { store_id: string }

/** Who created what, and how much of it has been paid. Managers see their store; the admin can pick any. */
export default function Reports({ isAdmin, stores, names }: Props) {
  const toast = useToast()
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [failed, setFailed] = useState('')
  const [period, setPeriod] = useState<Period>('month')
  const [storeId, setStoreId] = useState('')

  const load = useCallback(async () => {
    setFailed('')
    if (DEMO) return setDocs(demoDocs().map((d) => ({ ...d, created_by: d.created_by })) as Doc[])
    if (!supabase) return
    const { data, error } = await supabase
      .from('documents')
      .select('store_id,created_by,doc_type,total_cents,status,created_at,payments(amount_cents)')
      .order('created_at', { ascending: false })
      .limit(5000)
    if (error) { setFailed(error.message); toast.error(error.message) } else setDocs(data as unknown as Doc[])
  }, [toast])
  useEffect(() => { load() }, [load])

  const { rows, total } = useMemo(
    () => summarise((docs ?? []).filter((d) => !storeId || d.store_id === storeId), periodStart(period), names),
    [docs, storeId, period, names],
  )

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Reports</h1>
          <p className="muted">Quotes and invoices by the person who created them. Invoiced is the value of invoices, received is what has been paid on them, and quote deposits are advances held on quotes not yet invoiced. Void documents are left out.</p>
        </div>
      </div>
      <div className="filters">
        {isAdmin && (
          <select name="reportStore" aria-label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All stores</option>
            {stores.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.value} type="button" aria-pressed={period === p.value} onClick={() => setPeriod(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      {failed ? (
        <div className="state error" role="alert"><p>Could not load the report</p><p className="muted">{failed}</p>
          <div className="actions"><button type="button" className="btn" onClick={load}>Try again</button></div></div>
      ) : !docs ? (
        <div className="skeleton" aria-busy="true"><i /><i /><i /></div>
      ) : rows.length === 0 ? (
        <div className="state"><p>Nothing in this period</p><p className="muted">Try a longer period.</p></div>
      ) : (
        <div className="tablewrap">
          <table className="book reports">
            <thead><tr><th>Person</th><th className="r">Quotes</th><th className="r">Invoices</th><th className="r">Invoiced</th><th className="r">Quote deposits</th><th className="r">Received</th><th className="r">Still due</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key || 'unknown'}>
                  <td data-label="Person"><b>{r.name}</b></td>
                  <td data-label="Quotes" className="r num">{r.quotes}</td>
                  <td data-label="Invoices" className="r num">{r.invoices}</td>
                  <td data-label="Invoiced" className="r num">{money(r.invoicedCents)}</td>
                  <td data-label="Quote deposits" className="r num">{money(r.depositCents)}</td>
                  <td data-label="Received" className="r num">{money(r.receivedCents)}</td>
                  <td data-label="Still due" className="r num">{money(r.dueCents)}</td>
                </tr>
              ))}
              <tr className="totalrow">
                <td data-label="Person"><b>Total</b></td>
                <td data-label="Quotes" className="r num"><b>{total.quotes}</b></td>
                <td data-label="Invoices" className="r num"><b>{total.invoices}</b></td>
                <td data-label="Invoiced" className="r num"><b>{money(total.invoicedCents)}</b></td>
                <td data-label="Quote deposits" className="r num"><b>{money(total.depositCents)}</b></td>
                <td data-label="Received" className="r num"><b>{money(total.receivedCents)}</b></td>
                <td data-label="Still due" className="r num"><b>{money(total.dueCents)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
