import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import { money } from './lib/order'
import { periodStart, summarise, type GroupBy, type OrderWithLines, type Period } from './lib/reports'
import type { StoreRow } from './lib/supabase'

interface Props { multi: boolean; stores: StoreRow[]; names: Record<string, string>; refreshKey: number }

const PERIODS: { value: Period; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]
const GROUPS: { value: GroupBy; label: string; column: string }[] = [
  { value: 'vendor', label: 'Vendor', column: 'Vendor' },
  { value: 'division', label: 'Division', column: 'Division' },
  { value: 'person', label: 'Person', column: 'Person' },
]

/** What the store has ordered, by vendor, division or person. Admin can pick any store. */
export default function Reports({ multi, stores, names, refreshKey }: Props) {
  const [data, setData] = useState<OrderWithLines[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [period, setPeriod] = useState<Period>('month')
  const [by, setBy] = useState<GroupBy>('vendor')
  const [storeId, setStoreId] = useState('')
  const [includeOpen, setIncludeOpen] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    setData(null)
    try { setData(await api.reportLines(stores.map((s) => s.id))) } catch { setFailed(true) }
  }, [stores])
  useEffect(() => { load() }, [load, refreshKey])

  const { rows, total } = useMemo(
    () => summarise((data ?? []).filter((d) => !storeId || d.order.store_id === storeId), { since: periodStart(period), includeOpen, by }, names),
    [data, storeId, period, includeOpen, by, names],
  )
  const column = GROUPS.find((g) => g.value === by)!.column

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Reports</h1>
          <p className="muted">What has been ordered, at store cost. Only orders marked as ordered in NAV count unless you include open and copied ones.</p>
        </div>
      </div>
      <div className="filters">
        {multi && (
          <select name="reportStore" aria-label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All stores</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map((p) => <button key={p.value} type="button" aria-pressed={period === p.value} onClick={() => setPeriod(p.value)}>{p.label}</button>)}
        </div>
        <div className="segmented" role="group" aria-label="Group by">
          {GROUPS.map((g) => <button key={g.value} type="button" aria-pressed={by === g.value} onClick={() => setBy(g.value)}>{g.label}</button>)}
        </div>
        <label className="inline"><input type="checkbox" checked={includeOpen} onChange={(e) => setIncludeOpen(e.target.checked)} /> Include open and copied</label>
      </div>

      {failed ? (
        <div className="state error" role="alert"><p>Could not load the report</p><p className="muted">Check your connection and try again.</p>
          <div className="actions"><button type="button" className="btn" onClick={load}>Try again</button></div></div>
      ) : !data ? (
        <div className="skeleton" aria-busy="true"><i /><i /><i /></div>
      ) : rows.length === 0 ? (
        <div className="state"><p>Nothing in this period</p><p className="muted">Try a longer period, or include open and copied orders.</p></div>
      ) : (
        <div className="tablewrap">
          <table className="book reports">
            <thead><tr><th>{column}</th><th className="r">Orders</th><th className="r">Lines</th><th className="r">Units</th><th className="r">Cost</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key || 'none'}>
                  <td data-label={column}><b>{r.name}</b></td>
                  <td data-label="Orders" className="r num">{r.orders}</td>
                  <td data-label="Lines" className="r num">{r.lines}</td>
                  <td data-label="Units" className="r num">{r.units}</td>
                  <td data-label="Cost" className="r num">{money(r.cost)}</td>
                </tr>
              ))}
              <tr className="totalrow">
                <td data-label={column}><b>Total</b></td>
                <td data-label="Orders" className="r num"><b>{total.orders}</b></td>
                <td data-label="Lines" className="r num"><b>{total.lines}</b></td>
                <td data-label="Units" className="r num"><b>{total.units}</b></td>
                <td data-label="Cost" className="r num"><b>{money(total.cost)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
