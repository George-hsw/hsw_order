import { useMemo } from 'react'
import { ChartCard, ColumnChart, Legend, StatTile } from './Charts'
import { avgSale, avgSaleLy, change, combineWeeks, memberShare, money2, pctText, periodText, weekKey, weekLabel, type StoreWeek, type WeekDates } from './lib/sales/model'
import { reveal } from './lib/motion'

/** One store over several weeks: the totals, the week-by-week split, and how it compares with last year and with the weeks just before. */
export default function SalesPeriod({ weeks, history }: { weeks: WeekDates[]; history: StoreWeek[] }) {
  const keys = useMemo(() => new Set(weeks.map(weekKey)), [weeks])
  const rows = useMemo(() => history.filter((h) => keys.has(weekKey(h))), [history, keys])
  const cur = useMemo(() => combineWeeks(rows), [rows])
  // The same number of weeks straight before this period, when the store has them all.
  const before = useMemo(() => {
    const first = weeks.length ? weekKey(weeks[0]) : 0
    const prior = history.filter((h) => weekKey(h) < first).slice(-weeks.length)
    return prior.length === weeks.length ? combineWeeks(prior) : null
  }, [history, weeks])
  if (!cur) return <div className="state"><p>No results for this store in {periodText(weeks)}</p><p className="muted">Pick other weeks, or wait for head office to load them.</p></div>

  const growth = change(cur.ty_sales, cur.ly_sales)
  const gpPts = (cur.gp_ty - cur.gp_ly) * 100
  const ms = memberShare(cur)
  const missing = weeks.length - rows.length

  return (
    <div className="viz-stack" ref={reveal}>
      <p className="note">
        {periodText(weeks)}: sales {growth === null ? 'have no last-year figure to compare with' : `are ${pctText(growth)} on the same weeks last year`}
        {before ? `, ${pctText(change(cur.ty_sales, before.ty_sales))} on the ${weeks.length} weeks before` : ''}.
        {missing > 0 ? ` ${missing} of these weeks have no results for this store.` : ''}
      </p>

      <div className="kpis">
        <StatTile label="Sales" value={money2(cur.ty_sales)} delta={growth} ly={`Last year ${money2(cur.ly_sales)}`} />
        <StatTile label="Sales made" value={cur.ty_trans.toLocaleString('en-AU')} delta={change(cur.ty_trans, cur.ly_trans)} ly={`Last year ${cur.ly_trans.toLocaleString('en-AU')}`} />
        <StatTile label="Average sale" value={money2(avgSale(cur))} delta={change(avgSale(cur), avgSaleLy(cur))} ly={`Last year ${money2(avgSaleLy(cur))}`} />
        <StatTile label="Items per sale" value={cur.basket ? cur.basket.toFixed(2) : 'n/a'} />
        <StatTile label="Members" value={`${Math.round(ms * 100)}%`} ly="of sales" />
        <StatTile label="Margin" value={cur.gp_ty ? `${(cur.gp_ty * 100).toFixed(1)}%` : 'n/a'} ly={cur.gp_ly ? `${gpPts >= 0 ? '+' : '−'}${Math.abs(gpPts).toFixed(1)} points on last year` : undefined} />
      </div>

      <ChartCard
        title="Week by week" sub="This year beside the same week last year."
        legend={<Legend items={[{ tone: 'ty', label: 'This year' }, { tone: 'ly', label: 'Same week last year' }]} />}
        table={{ head: ['Week', 'Sales', 'Last year', 'Change', 'Sales made', 'Average sale'], rows: rows.slice().reverse().map((h) => [weekLabel(h), money2(h.ty_sales), money2(h.ly_sales), pctText(change(h.ty_sales, h.ly_sales)), h.ty_trans.toLocaleString('en-AU'), money2(avgSale(h))]) }}>
        <ColumnChart label="Weekly sales, this year and last year" cats={rows.map((h) => `W${h.week}`)} fmt={money2}
          series={[{ name: 'This year', tone: 'ty', values: rows.map((h) => h.ty_sales) }, { name: 'Last year', tone: 'ly', values: rows.map((h) => h.ly_sales) }]} />
      </ChartCard>
    </div>
  )
}
