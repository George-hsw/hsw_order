import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { reveal } from './lib/motion'
import Loading from './Loading'
import { ChartCard, ColumnChart, Delta, Legend, StatTile } from './Charts'
import Scanner from './Scanner'
import { beep, primeAudio } from './lib/beep'
import { salesApi, type ItemInfo } from './lib/sales/api'
import { FLAG_HELP, FLAG_LABEL, itemFlag, itemTrend, money2, ordinal, weekLabel, type ItemFlag, type ItemSale } from './lib/sales/model'
import { useLoad } from './lib/useLoad'
import { trackError } from './lib/analytics/track'

const CHIP: Record<ItemFlag, string> = { out: 'bad', not_selling: 'warn', below: 'warn', above: 'paid', ok: '' }
const units = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * Scan or type an item and see how it has sold at this store: units and sales week by week, the average store that stocks it beside it,
 * growth, rank and sales lost to no stock. It reads only the weeks the Detailed report has been loaded for, and says so.
 */
export default function SalesItem({ storeId, initialCode, onOrder }: { storeId: string; initialCode: string | null; onOrder?: (vendor: string, item: string) => void }) {
  const [text, setText] = useState(initialCode ?? '')
  const [item, setItem] = useState<ItemInfo | null>(null)
  const [state, setState] = useState<'idle' | 'looking' | 'missing' | 'error'>(initialCode ? 'looking' : 'idle')
  const [missed, setMissed] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const find = async (q: string): Promise<boolean> => {
    const v = q.trim()
    if (!v) return false
    setState('looking'); setMissed('')
    try {
      const found = await salesApi.lookupItem(storeId, v)
      if (!found) { setItem(null); setState('missing'); setMissed(v); return false }
      setItem(found); setState('idle'); setText(found.code)
      return true
    } catch (e) { trackError('item lookup', e); setState('error'); return false }
  }

  // Arriving from the Items list with an item already chosen.
  useEffect(() => { if (initialCode) void find(initialCode) }, [initialCode, storeId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Another store has other numbers: start again.
  useEffect(() => { setItem(null) }, [storeId])

  const history = useLoad(() => salesApi.itemHistory(storeId, item!.code), [storeId, item?.code], !!item)
  const trend = useMemo(() => itemTrend(history.data ?? []), [history.data])
  const newest = history.data?.[0] // the API lists newest first
  const flag: ItemFlag | null = useMemo(() => {
    if (!item || !newest) return null
    const sale: ItemSale = { item_code: item.code, description: item.description, vendor_no: item.vendor_no, division: item.division, qty: newest.qty, net_sales: newest.net_sales, store_rank: newest.store_rank,
      group_qty: newest.group_qty, group_net: 0, stores_stocking: newest.stores_stocking, business_rank: newest.business_rank, potential_sales: 0, potential_loss: newest.potential_loss, inventory: item.inventory, moq: item.moq }
    return itemFlag(sale)
  }, [item, newest])

  const submit = (e: FormEvent) => { e.preventDefault(); void find(text) }
  const openScanner = () => { primeAudio(); setScanMsg(''); (document.activeElement as HTMLElement | null)?.blur?.(); setScanning(true) }
  const onScan = async (value: string) => {
    const ok = await find(value)
    if (ok) { beep('ok'); setScanning(false) } else { beep('miss'); setScanMsg(`${value} is not an item we know`) }
  }

  const weeks = trend.weeks
  const cats = weeks.map((w) => `W${w.week}`)

  return (
    <div className="viz-stack" ref={reveal}>
      <section className="sheet viz-card">
        <div className="viz-head"><div><h2>Scan an item</h2><p className="muted">Scan a barcode or type an item number to see how it has sold at this store.</p></div></div>
        <form className="findrow" onSubmit={submit}>
          <input ref={input} type="search" name="itemFind" aria-label="Item number or barcode" placeholder="Item number or barcode" value={text} enterKeyHint="search" autoComplete="off" onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn" disabled={state === 'looking'}>Find</button>
          <button type="button" className="btn primary scanbtn" onPointerDown={openScanner} onClick={openScanner}>
            <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M12 8v8M16 8v8" /></svg>
            Scan
          </button>
        </form>
        {state === 'looking' && <p className="muted viz-pick">Looking…</p>}
        {state === 'missing' && <p className="note bad" role="alert">No item found for {missed}. Check the number, or scan the barcode again.</p>}
        {state === 'error' && <p className="note bad" role="alert">Could not look that up. Check your connection and try again.</p>}
      </section>

      {item && (
        <>
          <section className="sheet viz-card">
            <div className="viz-head">
              <div><h2>{item.description}</h2><p className="muted">{item.code}{item.vendor_no ? `, vendor ${item.vendor_no}` : ''}{item.division ? `, ${item.division.replace(/_/g, ' ').toLowerCase()}` : ''}</p></div>
              {item.vendor_no && onOrder && <button type="button" className="btn primary" onClick={() => onOrder(item.vendor_no!, item.code)}>Order this item</button>}
            </div>
            {flag && flag !== 'ok' && <p className={`note${flag === 'out' ? ' bad' : ''}`}><span className={`chip ${CHIP[flag]}`}>{FLAG_LABEL[flag]}</span> {FLAG_HELP[flag]}</p>}
          </section>

          {history.loading ? <Loading /> : history.failed ? (
            <div className="state error" role="alert"><p>Could not load this item’s sales</p><div className="actions"><button type="button" className="btn" onClick={history.retry}>Try again</button></div></div>
          ) : !weeks.length ? (
            <div className="state"><p>No sales recorded for this item</p><p className="muted">The Detailed report lists an item only when it sold, was ranked or lost sales. Stock now: {item.inventory}.</p></div>
          ) : (
            <>
              <div className="kpis">
                <StatTile label={trend.last ? `Sold in ${weekLabel(trend.last)}` : 'Sold'} value={`${trend.last?.qty ?? 0} units`} delta={trend.growth1} deltaLabel="on the week before" />
                <StatTile label="Last four weeks" value={`${units(weeks.slice(-4).reduce((a, w) => a + w.qty, 0))} units`} delta={trend.growth4} deltaLabel="on the four weeks before" />
                <StatTile label="All weeks loaded" value={`${trend.total_qty} units`} ly={`${money2(trend.total_sales)} in ${weeks.length} ${weeks.length === 1 ? 'week' : 'weeks'}`} />
                <StatTile label="Stock now" value={String(item.inventory)} ly={item.moq > 1 ? `Order in multiples of ${item.moq}` : undefined} />
                <StatTile label="Rank" value={trend.last?.store_rank ? `${ordinal(trend.last.store_rank)} in store` : 'not ranked'} ly={trend.last?.business_rank ? `${ordinal(trend.last.business_rank)} in the business, ${weekLabel(trend.last)}` : trend.last ? weekLabel(trend.last) : undefined} />
                <StatTile label="Sales lost to no stock" value={money2(trend.total_lost)} ly="The report’s estimate" />
              </div>

              {weeks.length < 2 && <p className="note">Only {weeks.length} week of item results is loaded, so there is no trend yet. It builds as each week’s Detailed report is loaded.</p>}

              <ChartCard title="Units sold each week" sub="This store beside the average store that stocks the item"
                legend={<Legend items={[{ tone: 'ty', label: 'This store' }, { tone: 'ly', label: 'Average store that stocks it' }]} />}
                table={{ head: ['Week', 'Units', 'Average store', 'Sales', 'Rank in store', 'Rank in business', 'Lost sales'], rows: weeks.slice().reverse().map((w) => [weekLabel(w), w.qty, units(w.chain_avg), money2(w.net_sales), w.store_rank ? ordinal(w.store_rank) : '–', w.business_rank ? ordinal(w.business_rank) : '–', w.potential_loss ? money2(w.potential_loss) : '–']) }}>
                <ColumnChart label="Units sold each week, this store and the average store" cats={cats} fmt={units}
                  series={[{ name: 'This store', tone: 'ty', values: weeks.map((w) => w.qty) }, { name: 'Average store', tone: 'ly', values: weeks.map((w) => w.chain_avg) }]} />
              </ChartCard>

              <div className="viz-two">
                <ChartCard title="Sales each week" sub="Before GST"
                  table={{ head: ['Week', 'Sales'], rows: weeks.slice().reverse().map((w) => [weekLabel(w), money2(w.net_sales)]) }}>
                  <ColumnChart label="Sales each week" cats={cats} fmt={money2} height={208} series={[{ name: 'Sales', tone: 'ty', values: weeks.map((w) => w.net_sales) }]} />
                </ChartCard>
                <ChartCard title="Sales lost to no stock" sub="The report’s estimate each week"
                  table={{ head: ['Week', 'Lost sales'], rows: weeks.slice().reverse().map((w) => [weekLabel(w), money2(w.potential_loss)]) }}>
                  <ColumnChart label="Sales lost to no stock each week" cats={cats} fmt={money2} height={208} series={[{ name: 'Lost sales', tone: 'ly', values: weeks.map((w) => w.potential_loss) }]} />
                </ChartCard>
              </div>

              <section className="sheet viz-card">
                <div className="viz-head"><div><h2>Week by week</h2><p className="muted">Only weeks where the item sold, was ranked or lost sales are listed. Item sales are before GST and leave out Elfa.</p></div></div>
                <div className="tablewrap">
                  <table className="viz-table cells">
                    <thead><tr><th>Week</th><th className="r">Units</th><th className="r">Average store</th><th className="r">Sales</th><th className="r">Rank in store</th><th className="r">Rank in business</th><th className="r">Lost sales</th></tr></thead>
                    <tbody>{weeks.slice().reverse().map((w) => (
                      <tr key={w.fy * 100 + w.week}>
                        <td className="full" data-label="Week">{weekLabel(w)}</td>
                        <td className="r s2" data-label="Units">{w.qty}</td><td className="r s2" data-label="Average store">{units(w.chain_avg)}</td><td className="r s2" data-label="Sales">{money2(w.net_sales)}</td>
                        <td className="r s3" data-label="Rank in store">{w.store_rank ? ordinal(w.store_rank) : '–'}</td><td className="r s3" data-label="Rank in business">{w.business_rank ? ordinal(w.business_rank) : '–'}</td><td className="r s3" data-label="Lost sales">{w.potential_loss ? money2(w.potential_loss) : '–'}</td>
                      </tr>))}</tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
      {scanning && <Scanner onScan={onScan} onClose={() => setScanning(false)} feedback={scanMsg} />}
    </div>
  )
}
