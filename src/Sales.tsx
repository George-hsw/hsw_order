import { useEffect, useMemo, useState } from 'react'
import Loading from './Loading'
import { BarList, ChartCard, ColumnChart, Delta, Donut, Legend, Meter, StatTile } from './Charts'
import SalesItem from './SalesItem'
import SalesItems from './SalesItems'
import SalesLeague from './SalesLeague'
import SalesUpload from './SalesUpload'
import { track } from './lib/analytics/track'
import { salesApi } from './lib/sales/api'
import {
  PERIOD_LABEL, RANK_LABEL, RANK_METRICS, WEEKDAYS, availablePeriods, avgSale, avgSaleLy, change, combineChain, combineWeeks, memberPct, money2, pctText, periodText, priorWeeks, rangeText, rankText, resolvePeriod, sameWeek, sumDays, weekKey, weekLabel,
  type PeriodKey, type RankMetric, type StoreWeek, type WeekDates, type WeekRef,
} from './lib/sales/model'
import { useLoad } from './lib/useLoad'
import type { StoreRow } from './lib/supabase'
import { reveal } from './lib/motion'

export interface OrderJump { storeId: string; vendor: string; item: string; show?: 'low' | 'new' }
interface Props { email: string; isAdmin: boolean; seesAll: boolean; stores: StoreRow[]; allStores: StoreRow[]; onOrder?: (j: OrderJump) => void; start?: { storeId: string; code: string } | null }
type Sub = 'store' | 'items' | 'item' | 'all' | 'upload'

const STORE_KEY = 'hsw-orders-store'
const LAST = 13 // weeks shown in the weekly chart

/** The weeks a store can look at, and what each tab shows. A store sees its own figures and where it ranks; head office sees every store. */
export default function Sales({ email, isAdmin, seesAll, stores, allStores, onOrder, start }: Props) {
  const [sub, setSub] = useState<Sub>(start ? 'item' : 'store')
  const [storeId, setStoreId] = useState(() => {
    if (start && stores.some((x) => x.id === start.storeId)) return start.storeId
    try { const s = localStorage.getItem(STORE_KEY); if (s && stores.some((x) => x.id === s)) return s } catch { /* ignore */ }
    return stores[0]?.id ?? ''
  })
  const [week, setWeek] = useState<WeekRef | null>(null)
  const [period, setPeriod] = useState<PeriodKey>('week')
  const [from, setFrom] = useState<number | null>(null) // custom range, as week keys
  const [to, setTo] = useState<number | null>(null)
  const [itemCode, setItemCode] = useState<string | null>(start?.code ?? null) // an item sent here from the Items list or Price check
  const weeks = useLoad(() => salesApi.weeks(), [])
  const history = useLoad(() => salesApi.history(storeId), [storeId], !!storeId)
  const store = stores.find((s) => s.id === storeId)
  useEffect(() => { if (storeId) track('sales_view', { view: sub }, storeId) }, [sub, storeId])

  // Open on the newest week that has results for this store.
  useEffect(() => {
    if (!weeks.data || !history.data) return
    if (week && weeks.data.some((w) => sameWeek(w, week))) return
    const have = weeks.data.find((w) => history.data!.some((h) => sameWeek(h, w)))
    setWeek(have ?? weeks.data[0] ?? null)
  }, [weeks.data, history.data, week])

  const weekOptions: WeekDates[] = useMemo(() => weeks.data ?? [], [weeks.data])
  const ranged = sub === 'store' || sub === 'all'
  // The store's page offers only weeks this store has results for; the stores league and the Items list offer every week loaded.
  const calendar: WeekDates[] = useMemo(() => {
    const mine = sub === 'store' && history.data ? weekOptions.filter((w) => history.data!.some((h) => sameWeek(h, w))) : weekOptions
    return mine.length ? mine : weekOptions
  }, [sub, history.data, weekOptions])
  const periods = useMemo(() => availablePeriods(calendar), [calendar])
  useEffect(() => { if (periods.length && !periods.includes(period)) setPeriod('week') }, [periods, period])
  const periodWeeks = useMemo(() => resolvePeriod(period, calendar, { one: week, from: from ?? undefined, to: to ?? undefined }), [period, calendar, week, from, to])
  const weekSelect = (name: string, label: string, value: number | null, onChange: (k: number) => void) => (
    <select name={name} aria-label={label} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 'auto' }}>
      {calendar.map((w) => <option key={weekKey(w)} value={weekKey(w)}>{weekLabel(w)}{w.week_start ? `, ${rangeText(w.week_start, w.week_end)}` : ''}</option>)}
    </select>
  )

  const tab = (t: Sub, label: string) => <button type="button" aria-pressed={sub === t} onClick={() => setSub(t)}>{label}</button>

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Sales</h1>
          <p className="muted">{store ? `${store.name}: how the week went, how you rank, and where to act.` : 'Weekly results from head office.'}</p>
        </div>
      </div>

      <div className="filters">
        <div className="segmented" role="group" aria-label="Sales view">
          {tab('store', seesAll && !isAdmin ? 'Store' : 'My store')}
          {tab('items', 'Items')}
          {tab('item', 'Scan item')}
          {seesAll && tab('all', 'All stores')}
          {isAdmin && tab('upload', 'Upload')}
        </div>
        {(stores.length > 1 || seesAll) && sub !== 'all' && sub !== 'upload' && (
          <select name="salesStore" aria-label="Store" value={storeId} onChange={(e) => { setStoreId(e.target.value); setWeek(null); try { localStorage.setItem(STORE_KEY, e.target.value) } catch { /* ignore */ } }} style={{ width: 'auto' }}>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {ranged && periods.length > 1 && (
          <select name="salesPeriod" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} style={{ width: 'auto' }}>
            {periods.map((k) => <option key={k} value={k}>{PERIOD_LABEL[k]}</option>)}
          </select>
        )}
        {ranged && period === 'custom' && weekOptions.length > 0 && (
          <>
            <label className="inline">From {weekSelect('salesFrom', 'From week', from ?? weekKey(periodWeeks[0] ?? weekOptions[0]), setFrom)}</label>
            <label className="inline">To {weekSelect('salesTo', 'To week', to ?? weekKey(periodWeeks.at(-1) ?? weekOptions[0]), setTo)}</label>
          </>
        )}
        {sub !== 'upload' && sub !== 'item' && weekOptions.length > 0 && (!ranged || period === 'week') && weekSelect('salesWeek', 'Week', week ? weekKey(week) : null, (k) => { const w = weekOptions.find((x) => weekKey(x) === k); if (w) setWeek({ fy: w.fy, week: w.week }) })}
      </div>

      {sub === 'upload' && isAdmin ? <SalesUpload email={email} stores={allStores} onLoaded={() => { weeks.retry(); history.retry() }} />
        : weeks.failed || history.failed ? (
          <div className="state error" role="alert"><p>Could not load sales</p><p className="muted">Check your connection and try again.</p>
            <div className="actions"><button type="button" className="btn" onClick={() => { weeks.retry(); history.retry() }}>Try again</button></div></div>
        ) : weeks.loading || (sub !== 'all' && history.loading) ? <Loading />
        : sub === 'item' && storeId ? <SalesItem storeId={storeId} initialCode={itemCode} onOrder={onOrder && ((vendor, item) => onOrder({ storeId, vendor, item }))} />
        : !weekOptions.length ? (
          <div className="state"><p>No sales loaded yet</p><p className="muted">{isAdmin ? 'Open the Upload view and add this week’s reports.' : 'Head office loads the weekly reports. They will appear here once they do.'}</p></div>
        ) : !week ? null
        : sub === 'all' && seesAll ? <SalesLeague weeks={periodWeeks} stores={allStores} />
        : sub === 'items' ? <SalesItems storeId={storeId} week={week} onOrder={onOrder && ((vendor, item) => onOrder({ storeId, vendor, item }))} onTrend={(code) => { setItemCode(code); setSub('item') }} />
        : !periodWeeks.length ? <div className="state"><p>No weeks to show for {PERIOD_LABEL[period].toLowerCase()}</p><p className="muted">Choose another period.</p></div>
        : <MyStore storeId={storeId} weeks={periodWeeks} allWeeks={calendar} history={history.data ?? []} onWeek={(w) => { setWeek(w); setPeriod('week') }} />}
    </>
  )
}

function MyStore({ storeId, weeks, allWeeks, history, onWeek }: { storeId: string; weeks: WeekDates[]; allWeeks: WeekDates[]; history: StoreWeek[]; onWeek: (w: WeekRef) => void }) {
  const keys = weeks.map(weekKey).join(',')
  const single = weeks.length === 1
  const last = weeks[weeks.length - 1]
  const days = useLoad(() => Promise.all(weeks.map((w) => salesApi.days(storeId, w))).then(sumDays), [storeId, keys])
  const ranks = useLoad(() => Promise.all(weeks.map((w) => salesApi.ranks(storeId, w))), [storeId, keys])
  const chain = useLoad(() => Promise.all(weeks.map((w) => salesApi.chain(w))).then(combineChain), [keys])
  const [metric, setMetric] = useState<RankMetric | null>(null)
  const [dayIdx, setDayIdx] = useState<number | null>(null)

  const rows = useMemo(() => history.filter((h) => weeks.some((w) => sameWeek(w, h))), [history, weeks])
  const cur = useMemo(() => combineWeeks(rows), [rows])
  const missing = weeks.length - rows.length
  // The same number of weeks straight before, compared only when the store has every week of both, so both totals cover the same weeks.
  const before = useMemo(() => {
    if (single || missing > 0) return null
    const prior = priorWeeks(allWeeks, weeks)
    const have = prior.length ? history.filter((h) => prior.some((p) => sameWeek(p, h))) : []
    return prior.length > 0 && have.length === prior.length ? combineWeeks(have) : null
  }, [single, missing, allWeeks, weeks, history])
  const chartRows = single ? history.slice(-LAST) : rows // one week shows the latest weeks around it, so picking an earlier week never hides the later ones
  if (!cur) return <div className="state"><p>No results for this store in {periodText(weeks)}</p><p className="muted">Pick another period, or wait for head office to load it.</p></div>

  const growth = change(cur.ty_sales, cur.ly_sales)
  const dayRows = days.data ?? []
  const bestDay = dayRows.length ? dayRows.reduce((a, b) => (b.ty > a.ty ? b : a)) : null
  const gpPts = (cur.gp_ty - cur.gp_ly) * 100
  const [memPct, elsePct] = memberPct(cur)
  const lastRanks = ranks.data?.[ranks.data.length - 1] ?? [] // the latest week's place in each league
  const sales = lastRanks.find((r) => r.metric === 'sales')
  const picked = metric ?? 'sales'
  const sub = single ? (weeks[0].week_start ? rangeText(weeks[0].week_start, weeks[0].week_end) : weekLabel(weeks[0])) : periodText(weeks)

  return (
    <div className="viz-stack" ref={reveal}>
      <p className="note">
        {periodText(weeks)}: sales {growth === null ? 'have no last-year figure to compare with' : `are ${pctText(growth)} on the same ${single ? 'week' : 'weeks'} last year`}
        {before ? `, ${pctText(change(cur.ty_sales, before.ty_sales))} on the ${weeks.length} weeks before` : ''}
        {sales ? `, ${rankText(sales)} stores for sales${single ? '' : ` in ${weekLabel(last)}`}` : ''}{bestDay ? `. Best day: ${WEEKDAYS[bestDay.weekday - 1]}.` : '.'}
        {missing > 0 ? ` ${missing} of these weeks have no results for this store.` : ''}
      </p>

      <div className="kpis">
        <StatTile label="Sales" value={money2(cur.ty_sales)} delta={growth} ly={`Last year ${money2(cur.ly_sales)}`} />
        <StatTile label="Sales made" value={cur.ty_trans.toLocaleString('en-AU')} delta={change(cur.ty_trans, cur.ly_trans)} ly={`Last year ${cur.ly_trans.toLocaleString('en-AU')}`} />
        <StatTile label="Average sale" value={money2(avgSale(cur))} delta={change(avgSale(cur), avgSaleLy(cur))} ly={`Last year ${money2(avgSaleLy(cur))}`} />
        <StatTile label="Items per sale" value={cur.basket ? cur.basket.toFixed(2) : 'n/a'} ly={chain.data ? `Chain average ${chain.data.avg_basket.toFixed(2)}` : undefined} />
        <StatTile label="Members" value={`${memPct}%`} ly="of sales" />
        <StatTile label="Margin" value={cur.gp_ty ? `${(cur.gp_ty * 100).toFixed(1)}%` : 'n/a'} ly={cur.gp_ly ? `${gpPts >= 0 ? '+' : '−'}${Math.abs(gpPts).toFixed(1)} points on last year` : undefined} />
      </div>

      <ChartCard
        title="Week by week" sub={single ? 'This year beside the same week last year. Press a week to open it.' : 'This year beside the same week last year. Press a week to open just that week.'}
        legend={<Legend items={[{ tone: 'ty', label: 'This year' }, { tone: 'ly', label: 'Same week last year' }]} />}
        table={{ head: ['Week', 'Sales', 'Last year', 'Change', 'Sales made', 'Average sale'], rows: chartRows.slice().reverse().map((h) => [weekLabel(h), money2(h.ty_sales), money2(h.ly_sales), pctText(change(h.ty_sales, h.ly_sales)), h.ty_trans.toLocaleString('en-AU'), money2(avgSale(h))]) }}>
        <ColumnChart label="Weekly sales, this year and last year" cats={chartRows.map((h) => `W${h.week}`)} fmt={money2}
          series={[{ name: 'This year', tone: 'ty', values: chartRows.map((h) => h.ty_sales) }, { name: 'Last year', tone: 'ly', values: chartRows.map((h) => h.ly_sales) }]}
          selected={single ? chartRows.findIndex((h) => sameWeek(h, weeks[0])) : -1} onSelect={(i) => onWeek({ fy: chartRows[i].fy, week: chartRows[i].week })} />
      </ChartCard>

      <div className="viz-two">
        <ChartCard
          title="Day by day" sub={sub}
          legend={<Legend items={[{ tone: 'ty', label: 'This year' }, { tone: 'ly', label: 'Same day last year' }]} />}
          table={{ head: ['Day', 'Sales', 'Last year', 'Change'], rows: dayRows.map((d) => [WEEKDAYS[d.weekday - 1], money2(d.ty), money2(d.ly), pctText(change(d.ty, d.ly))]) }}>
          {days.loading ? <Loading rows={2} /> : !dayRows.length ? <p className="muted viz-empty">No daily figures for {single ? 'this week' : 'these weeks'} yet.</p> : (
            <>
              <ColumnChart label="Daily sales, this year and last year" cats={WEEKDAYS} fmt={money2} height={208} selected={dayIdx} onSelect={(i) => setDayIdx(dayIdx === i ? null : i)}
                series={[{ name: 'This year', tone: 'ty', values: WEEKDAYS.map((_, i) => dayRows.find((d) => d.weekday === i + 1)?.ty ?? 0) }, { name: 'Last year', tone: 'ly', values: WEEKDAYS.map((_, i) => dayRows.find((d) => d.weekday === i + 1)?.ly ?? 0) }]} />
              {dayIdx !== null && dayRows.find((d) => d.weekday === dayIdx + 1) && (
                <p className="viz-pick">{WEEKDAYS[dayIdx]}: <Delta f={change(dayRows.find((d) => d.weekday === dayIdx + 1)!.ty, dayRows.find((d) => d.weekday === dayIdx + 1)!.ly)} label="on the same day last year" /></p>
              )}
            </>
          )}
        </ChartCard>

        <ChartCard title="Member sales" sub={single ? 'Share of the week’s sales' : 'Share of the period’s sales'}
          table={{ head: ['', 'Sales', 'Share'], rows: [['Members', money2(cur.member_sales), `${memPct}%`], ['Everyone else', money2(Math.max(0, cur.ty_sales - cur.member_sales)), `${elsePct}%`]] }}>
          <Donut parts={[{ key: 'm', label: 'Members', value: cur.member_sales, tone: 'ty' }, { key: 'n', label: 'Everyone else', value: Math.max(0, cur.ty_sales - cur.member_sales), tone: 'ly' }]}
            centre={`${memPct}%`} sub="members" fmt={money2} />
        </ChartCard>
      </div>

      <section className="sheet viz-card">
        <div className="viz-head">
          <div><h2>How you rank</h2><p className="muted">{single ? 'Your place among the stores trading this week. Press a line to read it.' : 'Your place among the stores trading each week of the period. Pick a measure to see it week by week.'}</p></div>
          {!single && lastRanks.length > 0 && (
            <select name="rankMetric" aria-label="Measure" value={picked} onChange={(e) => setMetric(e.target.value as RankMetric)} style={{ width: 'auto' }}>
              {RANK_METRICS.filter((m) => lastRanks.some((r) => r.metric === m)).map((m) => <option key={m} value={m}>{RANK_LABEL[m]}</option>)}
            </select>
          )}
        </div>
        {ranks.loading ? <Loading rows={2} /> : !lastRanks.length ? <p className="muted viz-empty">Ranks appear once {single ? 'the week’s' : 'the weeks’'} results are loaded for every store.</p> : single ? (
          <>
            <div className="meters">
              {lastRanks.map((r) => <Meter key={r.metric} rank={r.rank} of={r.of} label={RANK_LABEL[r.metric]} text={rankText(r)} selected={metric === r.metric} onSelect={() => setMetric(metric === r.metric ? null : r.metric)} />)}
            </div>
            {metric && lastRanks.find((r) => r.metric === metric) && (
              <p className="viz-pick">{RANK_LABEL[metric]}: {rankText(lastRanks.find((r) => r.metric === metric)!)}. {lastRanks.find((r) => r.metric === metric)!.rank === 1 ? 'Top of the chain.' : `${lastRanks.find((r) => r.metric === metric)!.of - lastRanks.find((r) => r.metric === metric)!.rank} stores are behind you.`}</p>
            )}
          </>
        ) : (
          <div className="tablewrap">
            <table className="viz-table">
              <thead><tr><th>Week</th><th className="r">{RANK_LABEL[picked]}</th></tr></thead>
              <tbody>
                {weeks.map((w, i) => ({ w, r: ranks.data?.[i]?.find((x) => x.metric === picked) })).reverse().map(({ w, r }) => (
                  <tr key={weekKey(w)}><td data-label="Week">{weekLabel(w)}</td><td className="r" data-label={RANK_LABEL[picked]}>{r ? rankText(r) : 'not ranked'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {chain.data && (
        <ChartCard title="You and the average store" sub={`Across ${chain.data.stores} stores${single ? ' this week' : ', added up over these weeks'}`}
          table={{ head: ['', 'You', 'Average store'], rows: [['Sales', money2(cur.ty_sales), money2(chain.data.avg_store_sales)], ['Margin', `${(cur.gp_ty * 100).toFixed(1)}%`, `${(chain.data.avg_gp * 100).toFixed(1)}%`], ['Items per sale', cur.basket.toFixed(2), chain.data.avg_basket.toFixed(2)]] }}>
          <div className="vs">
            <div><p className="stat-label">Sales</p><BarList rows={[{ key: 'you', label: 'You', value: cur.ty_sales, text: money2(cur.ty_sales) }, { key: 'avg', tone: 'ly', label: 'Average store', value: chain.data.avg_store_sales, text: money2(chain.data.avg_store_sales) }]} tone="ty" /></div>
            <div><p className="stat-label">Margin</p><BarList rows={[{ key: 'you', label: 'You', value: cur.gp_ty, text: `${(cur.gp_ty * 100).toFixed(1)}%` }, { key: 'avg', tone: 'ly', label: 'Average store', value: chain.data.avg_gp, text: `${(chain.data.avg_gp * 100).toFixed(1)}%` }]} tone="ty" /></div>
            <div><p className="stat-label">Items per sale</p><BarList rows={[{ key: 'you', label: 'You', value: cur.basket, text: cur.basket.toFixed(2) }, { key: 'avg', tone: 'ly', label: 'Average store', value: chain.data.avg_basket, text: chain.data.avg_basket.toFixed(2) }]} tone="ty" /></div>
          </div>
        </ChartCard>
      )}
    </div>
  )
}
