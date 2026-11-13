import { useEffect, useMemo, useState } from 'react'
import { useConfirm } from './Confirm'
import StockCount from './StockCount'
import { useToast } from './Toast'
import { api } from './lib/api'
import { track, trackError } from './lib/analytics/track'
import { lastCounted, scopeLabel } from './lib/stocktake'
import { useLoad } from './lib/useLoad'
import type { CountRow, CountScopeType, StoreRow } from './lib/supabase'

interface Props { multi: boolean; stores: StoreRow[]; canManage: (storeId: string) => boolean }

const STORE_KEY = 'hsw-orders-store' // the same store the Order tab last used
const when = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
type Pick = 'vendor' | 'category' | 'none'
const PICK_LABEL: Record<Pick, string> = { vendor: 'A vendor', category: 'A category', none: 'Just scan' }

/** Start a stock take, or carry on with one that is open. A full count covers the whole store; a rolling count is one vendor or category. */
export default function StockTake({ multi, stores, canManage }: Props) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [storeId, setStoreId] = useState(() => { try { const s = localStorage.getItem(STORE_KEY); if (s && stores.some((x) => x.id === s)) return s } catch { /* ignore */ } return stores[0]?.id ?? '' })
  const [active, setActive] = useState<CountRow | null>(null)
  const [rolling, setRolling] = useState(false) // the scope picker is showing
  const [pick, setPick] = useState<Pick>('vendor')
  const [filter, setFilter] = useState('')
  const [starting, setStarting] = useState(false)
  const store = stores.find((s) => s.id === storeId)

  const counts = useLoad(() => api.listCounts([storeId]), [storeId, active === null], !!storeId)
  const openCounts = (counts.data ?? []).filter((c) => c.status === 'open')
  const vendors = useLoad(() => api.vendors(storeId), [storeId], rolling && pick === 'vendor')
  const categories = useLoad(() => api.categories(storeId), [storeId], rolling && pick === 'category')

  useEffect(() => { setActive(null); setRolling(false) }, [storeId])
  const changeStore = (id: string) => { setStoreId(id); try { localStorage.setItem(STORE_KEY, id) } catch { /* ignore */ } }

  const begin = async (kind: 'full' | 'rolling', scopeType: CountScopeType, scopeValue: string | null) => {
    if (starting) return
    setStarting(true)
    try {
      const c = await api.openCount(storeId, kind, '', scopeType, scopeValue)
      track('stock_count_start', { kind, scope: scopeType }, storeId)
      setActive(c); setRolling(false)
    } catch (e) { trackError('stock take', e); toast.error('Could not start the count. Try again.') } finally { setStarting(false) }
  }

  const startFull = async () => {
    const existing = openCounts.find((c) => c.kind === 'full')
    if (existing) return setActive(existing)
    if (await ask({
      title: `Start a full stock take at ${store?.name ?? 'this store'}?`,
      body: <p>Everyone at the store can scan into it from their own phone, and it stays open until you finish it. Items nobody scans are left alone unless you decide otherwise at the end.</p>,
      confirmLabel: 'Start the stock take', cancelLabel: 'Not now',
    })) await begin('full', 'none', null)
  }

  const remove = async (c: CountRow) => {
    if (!(await ask({ title: `Delete this ${scopeLabel(c).toLowerCase()}?`, body: <p>Everything counted so far will be removed. This cannot be undone.</p>, confirmLabel: 'Delete count', danger: true }))) return
    try { await api.deleteCount(c.id); toast.success('Count deleted.'); counts.retry() } catch (e) { trackError('stock take', e); toast.error('Could not delete the count. Try again.') }
  }

  const options = useMemo(() => {
    const term = filter.trim().toLowerCase()
    const rows = pick === 'vendor'
      ? (vendors.data?.options ?? []).map((o) => ({ value: o.vendor, label: o.vendor, sub: '', items: o.items }))
      : (categories.data ?? []).map((o) => ({ value: o.category, label: o.category, sub: o.division ?? '', items: o.items }))
    return rows.filter((r) => !term || r.label.toLowerCase().includes(term) || r.sub.toLowerCase().includes(term))
  }, [pick, vendors.data, categories.data, filter])
  const picker = pick === 'vendor' ? vendors : categories

  if (!stores.length) return <div className="state"><p>No stores yet</p><p className="muted">Add a store on the Stores tab first.</p></div>

  if (active && store) {
    return <StockCount key={active.id} count={active} store={store} canManage={canManage(store.id)} onChange={setActive} onLeave={() => setActive(null)} />
  }

  return (
    <div className="stocktake">
      <div className="pagehead">
        <div>
          <h1>Stock take</h1>
          <p className="muted">{store?.name ?? ''}. Count the whole store, or a small part of it, and compare with the system as you go.</p>
        </div>
        {multi && (
          <div className="actions">
            <label className="inline">Store
              <select name="store" value={storeId} onChange={(e) => changeStore(e.target.value)}>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      {openCounts.length > 0 && (
        <section className="sheet viz-card">
          <div className="viz-head"><h2>In progress</h2></div>
          <ul className="people vendors">
            {openCounts.map((c) => (
              <li key={c.id}>
                <div className="who-line">
                  <b>{scopeLabel(c)}</b>
                  <span className="muted">started {when(c.created_at)}, {c.lines} {c.lines === 1 ? 'item' : 'items'} counted{c.differ ? `, ${c.differ} ${c.differ === 1 ? 'differs' : 'differ'}` : ''}</span>
                </div>
                <div className="person-actions">
                  <button type="button" className="btn" onClick={() => setActive(c)}>Continue</button>
                  <button type="button" className="btn danger" onClick={() => void remove(c)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="hometiles">
        <button type="button" className="flagbtn hometile" onClick={() => void startFull()} disabled={starting}>
          <b>Full stock take</b>
          <span>Count every item in the store, then copy the gains and losses for NAV.</span>
          {openCounts.some((c) => c.kind === 'full') && <small className="muted">One is open. Tap to continue it.</small>}
        </button>
        <button type="button" className="flagbtn hometile" aria-expanded={rolling} onClick={() => setRolling((r) => !r)}>
          <b>Rolling count</b>
          <span>Check one vendor or category, or just scan a few items, and fix the stock as you go.</span>
        </button>
      </div>

      {rolling && (
        <section className="sheet viz-card">
          <div className="viz-head"><h2>What are you counting?</h2></div>
          <div className="segmented" role="group" aria-label="What to count">
            {(['vendor', 'category', 'none'] as const).map((p) => <button key={p} type="button" aria-pressed={pick === p} onClick={() => { setPick(p); setFilter('') }}>{PICK_LABEL[p]}</button>)}
          </div>

          {pick === 'none' ? (
            <>
              <p className="muted viz-pick">Scan any items you like. There is no list to work through, so you finish when you are done.</p>
              <div className="actions"><button type="button" className="btn primary" onClick={() => void begin('rolling', 'none', null)} disabled={starting}>Start scanning</button></div>
            </>
          ) : picker.failed ? (
            <div className="state error" role="alert"><p>The list did not load</p><div className="actions"><button type="button" className="btn" onClick={picker.retry}>Try again</button></div></div>
          ) : picker.loading ? (
            <div className="skeleton" aria-busy="true" aria-label="Loading"><i /><i /><i /></div>
          ) : (
            <>
              <div className="filters"><input type="search" name="scopeFilter" aria-label={`Find a ${pick}`} placeholder={`Find a ${pick}…`} value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
              {options.length === 0 ? <div className="state compact"><p>No {pick} matches</p></div> : (
                <ul className="people vendors">
                  {options.map((o) => {
                    const last = lastCounted(counts.data ?? [], pick, o.value)
                    return (
                      <li key={o.value}>
                        <div className="who-line">
                          <b>{o.label}</b>
                          <span className="muted">{o.sub ? `${o.sub}, ` : ''}{o.items} {o.items === 1 ? 'item' : 'items'}</span>
                          <span className={'chip' + (last ? '' : ' warn')}>{last ? `Counted ${when(last)}` : 'Not counted yet'}</span>
                        </div>
                        <div className="person-actions"><button type="button" className="btn" onClick={() => void begin('rolling', pick, o.value)} disabled={starting}>Count</button></div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </section>
      )}
      {counts.failed && <div className="state error" role="alert"><p>Your counts did not load</p><div className="actions"><button type="button" className="btn" onClick={counts.retry}>Try again</button></div></div>}
      {confirmDialog}
    </div>
  )
}
