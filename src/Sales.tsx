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
  RANK_LABEL, WEEKDAYS, avgSale, avgSaleLy, change, memberShare, money2, pctText, rangeText, rankText, sameWeek, weekKey, weekLabel,
  type RankMetric, type StoreWeek, type WeekDates, type WeekRef,
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

  const dates = week ? weeks.data?.find((w) => sameWeek(w, week)) : undefined
  const weekOptions: WeekDates[] = useMemo(() => weeks.data ?? [], [weeks.data])

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
        {sub !== 'upload' && sub !== 'item' && weekOptions.length > 0 && (
          <select name="salesWeek" aria-label="Week" value={week ? weekKey(week) : ''} onChange={(e) => { const w = weekOptions.find((x) => weekKey(x) === Number(e.target.value)); if (w) setWeek({ fy: w.fy, week: w.week }) }} style={{ width: 'auto' }}>
            {weekOptions.map((w) => <option key={weekKey(w)} value={weekKey(w)}>{weekLabel(w)}{w.week_start ? `, ${rangeText(w.week_start, w.week_end)}` : ''}</option>)}
          </select>
        )}
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
        : sub === 'all' && seesAll ? <SalesLeague week={week} stores={allStores} />
        : sub === 'items' ? <SalesItems storeId={storeId} week={week} onOrder={onOrder && ((vendor, item) => onOrder({ storeId, vendor, item }))} onTrend={(code) => { setItemCode(code); setSub('item') }} />
        : <MyStore storeId={storeId} week={week} dates={dates} history={history.data ?? []} onWeek={setWeek} />}
    </>
  )
}

function MyStore({ storeId, week, dates, history, onWeek }: { storeId: string; week: WeekRef; dates?: WeekDates; history: StoreWeek[]; onWeek: (w: WeekRef) => void }) {
  const days = useLoad(() => salesApi.days(storeId, week), [storeId, weekKey(week)])
  const ranks = useLoad(() => salesApi.ranks(storeId, week), [storeId, weekKey(week)])
  const chain = useLoad(() => salesApi.chain(week), [weekKey(week)])
  const [metric, setMetric] = useState<RankMetric | null>(null)
  const [dayIdx, setDayIdx] = useState<number | null>(null)

  const cur = history.find((h) => sameWeek(h, week))
  const upTo = history.slice(-LAST) // always the latest weeks, so picking an earlier week never hides the later ones
  if (!cur) return <div className="state"><p>No results for this store in {weekLabel(week)}</p><p className="muted">Pick another week, or wait for head office to load this one.</p></div>

  const growth = change(cur.ty_sales, cur.ly_sales)
  const sales = ranks.data?.find((r) => r.metric === 'sales')
  const dayRows = days.data ?? []
  const bestDay = dayRows.length ? dayRows.reduce((a, b) => (b.ty > a.ty ? b : a)) : null
  const gpPts = (cur.gp_ty - cur.gp_ly) * 100
  const ms = memberShare(cur)

  return (
    <div className="viz-stack" ref={reveal}>
      <p className="note">
        {weekLabel(week)}{dates?.week_start ? ` (${rangeText(dates.week_start, dates.week_end)})` : ''}: sales {growth === null ? 'have no last-year figure to compare with' : `are ${pctText(growth)} on the same week last year`}
        {sales ? `, ${rankText(sales)} stores for sales` : ''}{bestDay ? `. Best day: ${WEEKDAYS[bestDay.weekday - 1]}.` : '.'}
      </p>

      <div className="kpis">
        <StatTile label="Sales" value={money2(cur.ty_sales)} delta={growth} ly={`Last year ${money2(cur.ly_sales)}`} />
        <StatTile label="Sales made" value={cur.ty_trans.toLocaleString('en-AU')} delta={change(cur.ty_trans, cur.ly_trans)} ly={`Last year ${cur.ly_trans.toLocaleString('en-AU')}`} />
        <StatTile label="Average sale" value={money2(avgSale(cur))} delta={change(avgSale(cur), avgSaleLy(cur))} ly={`Last year ${money2(avgSaleLy(cur))}`} />
        <StatTile label="Items per sale" value={cur.basket ? cur.basket.toFixed(2) : 'n/a'} ly={chain.data ? `Chain average ${chain.data.avg_basket.toFixed(2)}` : undefined} />
        <StatTile label="Members" value={`${Math.round(ms * 100)}%`} ly="of sales" />
        <StatTile label="Margin" value={cur.gp_ty ? `${(cur.gp_ty * 100).toFixed(1)}%` : 'n/a'} ly={cur.gp_ly ? `${gpPts >= 0 ? '+' : '−'}${Math.abs(gpPts).toFixed(1)} points on last year` : undefined} />
      </div>

      <ChartCard
        title="Week by week" sub="This year beside the same week last year. Press a week to open it."
        legend={<Legend items={[{ tone: 'ty', label: 'This year' }, { tone: 'ly', label: 'Same week last year' }]} />}
        table={{ head: ['Week', 'Sales', 'Last year', 'Change', 'Sales made', 'Average sale'], rows: upTo.slice().reverse().map((h) => [weekLabel(h), money2(h.ty_sales), money2(h.ly_sales), pctText(change(h.ty_sales, h.ly_sales)), h.ty_trans.toLocaleString('en-AU'), money2(avgSale(h))]) }}>
        <ColumnChart label="Weekly sales, this year and last year" cats={upTo.map((h) => `W${h.week}`)} fmt={money2}
          series={[{ name: 'This year', tone: 'ty', values: upTo.map((h) => h.ty_sales) }, { name: 'Last year', tone: 'ly', values: upTo.map((h) => h.ly_sales) }]}
          selected={upTo.findIndex((h) => sameWeek(h, week))} onSelect={(i) => onWeek({ fy: upTo[i].fy, week: upTo[i].week })} />
      </ChartCard>

      <div className="viz-two">
        <ChartCard
          title="Day by day" sub={dates?.week_start ? rangeText(dates.week_start, dates.week_end) : weekLabel(week)}
          legend={<Legend items={[{ tone: 'ty', label: 'This year' }, { tone: 'ly', label: 'Same day last year' }]} />}
          table={{ head: ['Day', 'Sales', 'Last year', 'Change'], rows: dayRows.map((d) => [WEEKDAYS[d.weekday - 1], money2(d.ty), money2(d.ly), pctText(change(d.ty, d.ly))]) }}>
          {days.loading ? <Loading rows={2} /> : !dayRows.length ? <p className="muted viz-empty">No daily figures for this week yet.</p> : (
            <>
              <ColumnChart label="Daily sales, this year and last year" cats={WEEKDAYS} fmt={money2} height={208} selected={dayIdx} onSelect={(i) => setDayIdx(dayIdx === i ? null : i)}
                series={[{ name: 'This year', tone: 'ty', values: WEEKDAYS.map((_, i) => dayRows.find((d) => d.weekday === i + 1)?.ty ?? 0) }, { name: 'Last year', tone: 'ly', values: WEEKDAYS.map((_, i) => dayRows.find((d) => d.weekday === i + 1)?.ly ?? 0) }]} />
              {dayIdx !== null && dayRows.find((d) => d.weekday === dayIdx + 1) && (
                <p className="viz-pick">{WEEKDAYS[dayIdx]}: <Delta f={change(dayRows.find((d) => d.weekday === dayIdx + 1)!.ty, dayRows.find((d) => d.weekday === dayIdx + 1)!.ly)} label="on the same day last year" /></p>
              )}
            </>
          )}
        </ChartCard>

        <ChartCard title="Member sales" sub="Share of the week’s sales"
          table={{ head: ['', 'Sales', 'Share'], rows: [['Members', money2(cur.member_sales), `${Math.round(ms * 100)}%`], ['Everyone else', money2(Math.max(0, cur.ty_sales - cur.member_sales)), `${Math.round((1 - ms) * 100)}%`]] }}>
          <Donut parts={[{ key: 'm', label: 'Members', value: cur.member_sales, tone: 'ty' }, { key: 'n', label: 'Everyone else', value: Math.max(0, cur.ty_sales - cur.member_sales), tone: 'ly' }]}
            centre={`${Math.round(ms * 100)}%`} sub="members" fmt={money2} />
        </ChartCard>
      </div>

      <section className="sheet viz-card">
        <div className="viz-head"><div><h2>How you rank</h2><p className="muted">Your place among the stores trading this week. Press a line to read it.</p></div></div>
        {ranks.loading ? <Loading rows={2} /> : !ranks.data?.length ? <p className="muted viz-empty">Ranks appear once the week’s results are loaded for every store.</p> : (
          <>
            <div className="meters">
              {ranks.data.map((r) => <Meter key={r.metric} rank={r.rank} of={r.of} label={RANK_LABEL[r.metric]} text={rankText(r)} selected={metric === r.metric} onSelect={() => setMetric(metric === r.metric ? null : r.metric)} />)}
            </div>
            {metric && ranks.data.find((r) => r.metric === metric) && (
              <p className="viz-pick">{RANK_LABEL[metric]}: {rankText(ranks.data.find((r) => r.metric === metric)!)}. {ranks.data.find((r) => r.metric === metric)!.rank === 1 ? 'Top of the chain.' : `${ranks.data.find((r) => r.metric === metric)!.of - ranks.data.find((r) => r.metric === metric)!.rank} stores are behind you.`}</p>
            )}
          </>
        )}
      </section>

      {chain.data && (
        <ChartCard title="You and the average store" sub={`Across ${chain.data.stores} stores this week`}
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
