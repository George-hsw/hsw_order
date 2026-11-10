import { useMemo, useState } from 'react'
import Loading from './Loading'
import { BarList, ChartCard, Delta, Donut, Legend } from './Charts'
import { salesApi } from './lib/sales/api'
import { RANK_LABEL, avgSale, change, memberShare, money2, ordinal, pctText, weekKey, type RankMetric, type StoreWeek, type WeekRef } from './lib/sales/model'
import { useLoad } from './lib/useLoad'
import type { StoreRow } from './lib/supabase'
import { reveal } from './lib/motion'

const METRICS: RankMetric[] = ['sales', 'growth', 'sqm', 'avg_sale', 'basket', 'member_share', 'gp']
const value = (m: RankMetric, w: StoreWeek): number | null => {
  switch (m) {
    case 'sales': return w.ty_sales
    case 'growth': return change(w.ty_sales, w.ly_sales)
    case 'sqm': return w.retail_sqm > 0 ? w.ty_sales / w.retail_sqm : null
    case 'avg_sale': return avgSale(w) || null
    case 'basket': return w.basket || null
    case 'member_share': return w.ty_sales > 0 ? memberShare(w) : null
    case 'gp': return w.gp_ty || null
  }
}
const text = (m: RankMetric, v: number) => (m === 'sales' || m === 'avg_sale' ? money2(v) : m === 'sqm' ? `${money2(v)} per m²` : m === 'growth' ? pctText(v) : m === 'basket' ? v.toFixed(2) : `${(v * 100).toFixed(1)}%`)

/** Head office only: every store side by side for the week. Stores never get this view; they see their own rank. */
export default function SalesLeague({ week, stores }: { week: WeekRef; stores: StoreRow[] }) {
  const league = useLoad(() => salesApi.league(week), [weekKey(week)])
  const [metric, setMetric] = useState<RankMetric>('sales')
  const [pick, setPick] = useState<string | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const rows = league.data ?? []
  const trading = useMemo(() => rows.filter((r) => r.co_fran !== 'Closed' && r.co_fran !== 'eShop' && r.ty_sales > 0), [rows])
  const bars = useMemo(() => trading.flatMap((r) => { const v = value(metric, r); return v === null ? [] : [{ r, v }] }).sort((a, b) => b.v - a.v), [trading, metric])
  const names = new Map(stores.map((s) => [s.id, s.name]))

  if (league.loading) return <Loading />
  if (league.failed) return <div className="state error" role="alert"><p>Could not load the stores</p><div className="actions"><button type="button" className="btn" onClick={league.retry}>Try again</button></div></div>
  if (!rows.length) return <div className="state"><p>No store results for this week</p></div>

  const sum = (f: (w: StoreWeek) => number, filter?: (w: StoreWeek) => boolean) => trading.filter(filter ?? (() => true)).reduce((a, w) => a + f(w), 0)
  const company = sum((w) => w.ty_sales, (w) => w.co_fran === 'Company')
  const fran = sum((w) => w.ty_sales, (w) => w.co_fran === 'Franchised')
  const total = sum((w) => w.ty_sales)
  const totalLy = sum((w) => w.ly_sales)
  const sel = bars.find((b) => b.r.store_name === pick)
  const shown = group ? bars.filter((b) => b.r.co_fran === group) : bars

  return (
    <div className="viz-stack" ref={reveal}>
      <p className="note">{trading.length} stores traded: {money2(total)} this week, <Delta f={change(total, totalLy)} label="on last year" /></p>
      <div className="viz-two wide-left">
        <ChartCard title="Stores ranked" sub={`${RANK_LABEL[metric]}. Press a store to read it.`}
          actions={<select name="leagueMetric" aria-label="Measure" value={metric} onChange={(e) => { setMetric(e.target.value as RankMetric); setPick(null) }} style={{ width: 'auto' }}>{METRICS.map((m) => <option key={m} value={m}>{RANK_LABEL[m]}</option>)}</select>}
          legend={metric === 'sales' ? <Legend items={[{ tone: 'ty', label: 'This year (the line marks last year)' }]} /> : undefined}
          table={{ head: ['Rank', 'Store', RANK_LABEL[metric], 'Sales', 'Last year'], rows: shown.map((b, i) => [i + 1, b.r.store_name, text(metric, b.v), money2(b.r.ty_sales), money2(b.r.ly_sales)]) }}>
          <BarList rows={shown.map((b) => ({ key: b.r.store_name, label: b.r.store_name, sub: b.r.store_id && names.has(b.r.store_id) ? undefined : 'no login here', value: Math.max(0, b.v), compare: metric === 'sales' ? b.r.ly_sales : undefined, text: text(metric, b.v) }))}
            selected={pick} onSelect={(k) => setPick(pick === k ? null : k)} />
          {sel && (
            <p className="viz-pick">
              {sel.r.store_name}: {ordinal(bars.indexOf(sel) + 1)} of {bars.length} for {RANK_LABEL[metric].toLowerCase()}. Sales {money2(sel.r.ty_sales)}, <Delta f={change(sel.r.ty_sales, sel.r.ly_sales)} label="on last year" />
            </p>
          )}
        </ChartCard>

        <ChartCard title="Company and franchise" sub="Share of the week’s sales. Press a part to filter the list."
          table={{ head: ['', 'Stores', 'Sales'], rows: [['Company', trading.filter((w) => w.co_fran === 'Company').length, money2(company)], ['Franchised', trading.filter((w) => w.co_fran === 'Franchised').length, money2(fran)]] }}>
          <Donut parts={[{ key: 'Company', label: 'Company', value: company, tone: 'ty' }, { key: 'Franchised', label: 'Franchised', value: fran, tone: 'ly' }]} centre={money2(total)} sub="all stores" fmt={money2}
            selected={group} onSelect={(k) => setGroup(group === k ? null : k)} />
        </ChartCard>
      </div>

      <section className="sheet viz-card">
        <div className="viz-head"><div><h2>Every store</h2><p className="muted">Including closed stores and the eShop, which stores never see.</p></div></div>
        <div className="tablewrap">
          <table className="viz-table cells">
            <thead><tr><th>Store</th><th>Type</th><th className="r">Sales</th><th className="r">Last year</th><th className="r">Change</th><th className="r">Sales made</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.store_name + r.co_fran}><td className="s4" data-label="Store">{r.store_name}</td><td className="s2" data-label="Type">{r.co_fran}</td><td className="r s2" data-label="Sales">{money2(r.ty_sales)}</td><td className="r s2" data-label="Last year">{money2(r.ly_sales)}</td><td className="r s2" data-label="Change">{pctText(change(r.ty_sales, r.ly_sales))}</td><td className="r full" data-label="Sales made">{r.ty_trans.toLocaleString('en-AU')}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
