import { useMemo, useState } from 'react'
import { BarList, ChartCard, Legend, useEscapeKey } from './Charts'
import { salesApi } from './lib/sales/api'
import {
  FLAGS, FLAG_HELP, FLAG_LABEL, chainAvg, flagCounts, itemFlag, money0, ordinal, topBy, type ItemFlag, type ItemSale, type WeekRef, weekKey,
} from './lib/sales/model'
import { useLoad } from './lib/useLoad'

type SortKey = 'net_sales' | 'qty' | 'potential_loss' | 'store_rank' | 'inventory'
const SORT: { value: SortKey; label: string }[] = [
  { value: 'net_sales', label: 'Sales $' }, { value: 'qty', label: 'Units sold' }, { value: 'potential_loss', label: 'Lost sales' }, { value: 'store_rank', label: 'Rank in store' }, { value: 'inventory', label: 'Stock' },
]
const PAGE = 50
const SHORT: Record<ItemFlag, string> = { out: 'Out of stock', not_selling: 'Not selling', below: 'Below average', above: 'Above average', ok: 'No flag' }
const CHIP: Record<ItemFlag, string> = { out: 'bad', not_selling: 'warn', below: 'warn', above: 'paid', ok: '' }

/** One store's items for the week, with the chain's figures beside them and plain flags for where to act. */
export default function SalesItems({ storeId, week, onOrder }: { storeId: string; week: WeekRef; onOrder: (vendor: string, item: string) => void }) {
  const items = useLoad(() => salesApi.items(storeId, week), [storeId, weekKey(week)])
  const [flag, setFlag] = useState<ItemFlag | null>(null)
  const [find, setFind] = useState('')
  const [sort, setSort] = useState<SortKey>('net_sales')
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<string | null>(null)
  useEscapeKey(open !== null, () => setOpen(null))

  const all = items.data ?? []
  const counts = useMemo(() => flagCounts(all), [all])
  const sorted = useMemo(() => {
    const q = find.trim().toLowerCase()
    const rows = all.filter((i) => (!flag || itemFlag(i) === flag) && (!q || i.item_code.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || (i.vendor_no ?? '').toLowerCase().includes(q)))
    return rows.sort((a, b) => {
      if (sort === 'store_rank') return (a.store_rank || 1e9) - (b.store_rank || 1e9) || a.item_code.localeCompare(b.item_code)
      if (sort === 'inventory') return a.inventory - b.inventory || a.item_code.localeCompare(b.item_code)
      return b[sort] - a[sort] || a.item_code.localeCompare(b.item_code)
    })
  }, [all, flag, find, sort])
  const picked = all.find((i) => i.item_code === open) ?? null

  if (items.loading) return <p className="muted">Loading…</p>
  if (items.failed) return <div className="state error" role="alert"><p>Could not load items</p><div className="actions"><button type="button" className="btn" onClick={items.retry}>Try again</button></div></div>
  if (!all.length) return <div className="state"><p>No item results for this store in this week</p><p className="muted">The detailed report may not have been loaded yet.</p></div>

  const top = topBy(all, 'net_sales', 8)
  const lost = topBy(all, 'potential_loss', 8)

  return (
    <div className="viz-stack">
      <section className="sheet viz-card">
        <div className="viz-head"><div><h2>Where to act</h2><p className="muted">Plain rules over this week’s numbers. They point at items to look at; the numbers sit beside them. Press one to filter the list.</p></div></div>
        <div className="flags">
          {FLAGS.map((f) => (
            <button key={f} type="button" className={`flagbtn${flag === f ? ' on' : ''}`} aria-pressed={flag === f} onClick={() => { setFlag(flag === f ? null : f); setLimit(PAGE) }}>
              <b>{counts[f]}</b><span>{SHORT[f]}</span>
            </button>
          ))}
        </div>
        {flag && <p className="viz-pick">{FLAG_LABEL[flag]}. {FLAG_HELP[flag]}</p>}
        <p className="muted viz-foot">Item sales are before GST and leave out Elfa (non-APL items), so they add up to less than the store’s sales on My store.</p>
        <p className="muted viz-foot">This looks at one week. Treat “not selling” with care: an item can sit for a week and still be a good line.</p>
      </section>

      <div className="viz-two">
        <ChartCard title="Top sellers" sub="By sales this week" legend={<Legend items={[{ tone: 'ty', label: 'Sales' }]} />}
          table={{ head: ['Item', 'Units', 'Sales'], rows: top.map((i) => [i.description, i.qty, money0(i.net_sales)]) }}>
          <BarList rows={top.map((i) => ({ key: i.item_code, label: i.description, sub: i.item_code, value: i.net_sales, text: money0(i.net_sales) }))} selected={open} onSelect={setOpen} empty="Nothing sold this week." />
        </ChartCard>
        <ChartCard title="Sales lost to no stock" sub="The report’s estimate, biggest first"
          table={{ head: ['Item', 'Stock', 'Lost sales'], rows: lost.map((i) => [i.description, i.inventory, money0(i.potential_loss)]) }}>
          <BarList rows={lost.map((i) => ({ key: i.item_code, label: i.description, sub: i.item_code, value: i.potential_loss, text: money0(i.potential_loss) }))} selected={open} onSelect={setOpen} empty="No lost sales reported this week." />
        </ChartCard>
      </div>

      <section className="sheet viz-card">
        <div className="viz-head"><div><h2>All items</h2><p className="muted">{sorted.length.toLocaleString('en-AU')} of {all.length.toLocaleString('en-AU')} items that sold, ranked or lost sales</p></div></div>
        <div className="filters">
          <input type="search" name="salesFind" aria-label="Find an item" placeholder="Find an item, code or vendor" value={find} onChange={(e) => { setFind(e.target.value); setLimit(PAGE) }} style={{ maxWidth: 320 }} />
          <select name="salesSort" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={{ width: 'auto' }}>
            {SORT.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
          </select>
        </div>
        <div className="tablewrap">
          <table className="salesitems">
            <thead><tr><th>Item</th><th className="r">Sold</th><th className="r">Stock</th><th>Flag</th></tr></thead>
            <tbody>
              {sorted.slice(0, limit).map((i) => (
                <tr key={i.item_code} className={open === i.item_code ? 'on' : ''}>
                  <td><button type="button" className="linkish" onClick={() => setOpen(open === i.item_code ? null : i.item_code)} aria-expanded={open === i.item_code}><b>{i.description || i.item_code}</b><small>{i.item_code}{i.store_rank ? `, ${ordinal(i.store_rank)} in store` : ''}</small></button></td>
                  <td className="r">{i.qty}</td>
                  <td className="r">{i.inventory}</td>
                  <td>{itemFlag(i) !== 'ok' && <span className={`chip ${CHIP[itemFlag(i)]}`}>{SHORT[itemFlag(i)]}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!sorted.length && <p className="muted viz-empty">No items match.</p>}
        {sorted.length > limit && <div className="actions"><button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, sorted.length - limit)} more</button></div>}
      </section>

      {picked && <ItemPanel item={picked} onClose={() => setOpen(null)} onOrder={onOrder} />}
    </div>
  )
}

function ItemPanel({ item, onClose, onOrder }: { item: ItemSale; onClose: () => void; onOrder: (vendor: string, item: string) => void }) {
  const f = itemFlag(item)
  const avg = chainAvg(item)
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="salesitem-title" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modalbox">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="salesitem-title">{item.description || item.item_code}</h2>
        <p className="muted">{item.item_code}{item.vendor_no ? `, vendor ${item.vendor_no}` : ''}{item.division ? `, ${item.division.replace(/_/g, ' ').toLowerCase()}` : ''}</p>
        {f !== 'ok' && <p className={`note${f === 'out' ? ' bad' : ''}`}><b>{FLAG_LABEL[f]}.</b> {FLAG_HELP[f]}</p>}
        <dl className="facts">
          <div><dt>Sold this week</dt><dd className="num">{item.qty} units, {money0(item.net_sales)}</dd></div>
          <div><dt>Stock now</dt><dd className="num">{item.inventory}</dd></div>
          <div><dt>Rank in your store</dt><dd className="num">{item.store_rank ? ordinal(item.store_rank) : 'not ranked'}</dd></div>
          <div><dt>Rank in the business</dt><dd className="num">{item.business_rank ? ordinal(item.business_rank) : 'not ranked'}</dd></div>
          <div><dt>Average store that stocks it</dt><dd className="num">{item.stores_stocking ? `${avg.toFixed(1)} units (${item.stores_stocking} stores)` : 'no other store'}</dd></div>
          <div><dt>Could sell at the average</dt><dd className="num">{money0(item.potential_sales)}</dd></div>
          <div><dt>Sales lost to no stock</dt><dd className="num">{money0(item.potential_loss)}</dd></div>
          <div><dt>Order in multiples of</dt><dd className="num">{item.moq}</dd></div>
        </dl>
        <div className="actions">
          {item.vendor_no && <button type="button" className="btn primary" onClick={() => onOrder(item.vendor_no!, item.item_code)}>Order this item</button>}
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
