import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CountFinish from './CountFinish'
import CountNavDialog from './CountNavDialog'
import CountSheet from './CountSheet'
import Scanner from './Scanner'
import { useToast } from './Toast'
import { api, CountConflictError } from './lib/api'
import { track, trackError } from './lib/analytics/track'
import { beep, primeAudio } from './lib/beep'
import { syncedLabel, type Product } from './lib/order'
import { fmtDiff, fmtQty, onHand, scopeLabel, stillToCount, variance } from './lib/stocktake'
import { useLoad } from './lib/useLoad'
import type { CountLine, CountRow, StoreRow } from './lib/supabase'

interface Props {
  count: CountRow
  store: StoreRow
  canManage: boolean
  onChange: (c: CountRow) => void // the count's status changed (saved, posted)
  onLeave: () => void // back to the start screen; the count stays open
}

interface Sheet { product: Product; conflict?: CountLine | null }
const LIST = 20 // rows of "still to count" shown at a time
const RECENT = 25 // counted items shown at a time

/**
 * Counting. Scan an item (or type its number or name), enter what is there, and the system's number is revealed. A full count covers
 * the whole store; a rolling count has a vendor or category to work through, so it also shows what is still to count.
 */
export default function StockCount({ count, store, canManage, onChange, onLeave }: Props) {
  const toast = useToast()
  const open = count.status === 'open'
  const [lines, setLines] = useState<CountLine[]>([])
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [looking, setLooking] = useState(false)
  const [message, setMessage] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [syncedAt, setSyncedAt] = useState<string | undefined>()
  const [toCountShown, setToCountShown] = useState(LIST)
  const [recentShown, setRecentShown] = useState(RECENT)
  const sheetOpen = useRef(false)
  sheetOpen.current = !!sheet

  // The lines: read once, then kept current as anyone counting this store changes them.
  useEffect(() => {
    let live = true
    api.countLines(count.id).then((l) => { if (live) { setLines(l); setLoaded(true) } }).catch(() => { if (live) setLoaded(true) })
    const off = api.subscribeCount(count.id, (l) => { if (live) { setLines(l); setLoaded(true) } })
    return () => { live = false; off() }
  }, [count.id])

  // A rolling count's scope: every item the store holds from this vendor or in this category.
  const scoped = count.kind === 'rolling' && count.scope_type !== 'none' && !!count.scope_value
  const range = useLoad<Product[]>(
    () => (count.scope_type === 'vendor' ? api.range(store.id, count.scope_value!) : api.categoryRange(store.id, count.scope_value!)),
    [store.id, count.scope_type, count.scope_value], scoped)
  const inScope = useMemo(() => new Set((range.data ?? []).map((p) => p.item.code)), [range.data])
  // The list to work through: by default only items with stock on the system (not 0), so the shelf check is about what should be there.
  const [withStock, setWithStock] = useState(true)
  const stocked = useMemo(() => onHand(range.data ?? []), [range.data])
  const listed = withStock ? stocked : range.data ?? []
  const remaining = useMemo(() => stillToCount(listed, lines), [listed, lines])
  const lineOf = useMemo(() => new Map(lines.map((l) => [l.item_code, l])), [lines])

  const differ = lines.filter((l) => variance(l) !== 0).length
  const scopeTotal = listed.length
  const countedInScope = range.data ? scopeTotal - remaining.length : 0

  const openItem = useCallback((p: Product, note = '') => {
    if (p.stock?.synced_at) setSyncedAt(p.stock.synced_at)
    setMessage(note)
    setSheet({ product: p })
  }, [])

  const find = async (value: string, fromScan: boolean): Promise<boolean> => {
    const v = value.trim()
    if (!v) return false
    setLooking(true); setMessage('')
    try {
      const found = await api.findItems(store.id, v)
      if (!found.length) { if (!fromScan) setMessage(`No item matches “${v}”. Check the number or try part of the name.`); return false }
      if (found.length === 1 || fromScan) {
        const p = found[0]
        openItem(p, scoped && range.data && !inScope.has(p.item.code) ? `${p.item.code} is not in ${scopeLabel(count).toLowerCase()}. It will be counted here anyway.` : '')
        setResults([])
        return true
      }
      setResults(found)
      return true
    } catch (e) { trackError('stock count', e); setMessage('Could not look that up. Check your connection and try again.'); return false } finally { setLooking(false) }
  }

  const openByCode = async (code: string) => {
    try {
      const found = await api.findItems(store.id, code)
      const p = found.find((x) => x.item.code === code) ?? found[0]
      if (p) openItem(p)
    } catch (e) { trackError('stock count', e); toast.error('Could not open that item. Try again.') }
  }

  const onScan = async (value: string) => {
    if (sheetOpen.current) return // one item at a time
    if (await find(value, true)) { beep('ok'); setScanMsg('') } else { beep('miss'); setScanMsg(`${value} is not an item we know`) }
  }
  const openScanner = () => { primeAudio(); setScanMsg(''); (document.activeElement as HTMLElement | null)?.blur?.(); setScanning(true) }

  const save = async (counted: number | null) => {
    if (!sheet || busy) return
    const { product } = sheet
    const base = lineOf.get(product.item.code)?.revision ?? 0
    setBusy(true)
    try {
      setLines(await api.saveCountLine(count.id, { item: product.item, stock: product.stock, counted }, base))
      track('stock_count_item', { kind: count.kind, removed: counted === null }, store.id)
      setScanMsg(counted === null ? `${product.item.description} removed` : `${product.item.description}: ${counted}`)
      setSheet(null)
      setText('')
    } catch (e) {
      if (e instanceof CountConflictError) {
        setLines((ls) => (e.current ? [e.current, ...ls.filter((l) => l.item_code !== e.current!.item_code)] : ls.filter((l) => l.item_code !== product.item.code)))
        setSheet({ product, conflict: e.current ?? null })
      } else { trackError('stock count', e); toast.error('Could not save that count. Try again.') }
    } finally { setBusy(false) }
  }

  const recount = (l: CountLine) => { setFinishing(false); void openByCode(l.item_code) }

  const recent = [...lines].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, recentShown)
  const sheetLine = sheet ? lineOf.get(sheet.product.item.code) : undefined

  return (
    <div className="stockcount">
      <div className="pagehead">
        <div>
          <h1>{scopeLabel(count)}</h1>
          <p className="muted">{store.name}{count.name ? `, ${count.name}` : ''}. {syncedAt ? syncedLabel(syncedAt) + '.' : 'The system figure appears after you enter each count.'}</p>
        </div>
        <div className="actions">
          <button type="button" className="btn" aria-label="Leave, keep counting later" onClick={onLeave}>Leave</button>
          <button type="button" className="btn" onClick={() => setFinishing(true)} disabled={lines.length === 0}>Finish count</button>
        </div>
      </div>

      <section className="sheet viz-card">
        <form className="findrow" onSubmit={(e) => { e.preventDefault(); void find(text, false) }}>
          <input type="search" name="countFind" aria-label="Item number, barcode or name" placeholder="Item number, barcode or name" value={text} enterKeyHint="search" autoComplete="off" onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn" disabled={looking}>Find</button>
          <button type="button" className="btn primary scanbtn" onPointerDown={openScanner} onClick={openScanner}>
            <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M12 8v8M16 8v8" /></svg>
            Scan
          </button>
        </form>
        {message && <p className="note bad" role="alert">{message}</p>}
        {results.length > 0 && (
          <ul className="pricehits">
            {results.map((r) => <li key={r.item.code}><button type="button" className="linkish" onClick={() => { setResults([]); openItem(r) }}><b>{r.item.description || r.item.code}</b><small>{r.item.code}</small></button></li>)}
          </ul>
        )}
        <p className="muted viz-pick" role="status" aria-live="polite">
          {scoped
            ? range.loading ? 'Loading the range…' : range.failed ? 'The range did not load.' : `${countedInScope} of ${scopeTotal} counted${differ ? `, ${differ} ${differ === 1 ? 'differs' : 'differ'}` : ''}`
            : `${lines.length} ${lines.length === 1 ? 'item' : 'items'} counted${differ ? `, ${differ} ${differ === 1 ? 'differs' : 'differ'}` : ''}`}
        </p>
        {scoped && range.data && scopeTotal > 0 && <progress className="countbar" aria-label="Items counted" max={scopeTotal} value={countedInScope} />}
        {!scoped && count.kind === 'full' && lines.length === 0 && loaded && <p className="muted">Scan every item you can find, shelf by shelf. Items you do not scan are left alone unless you decide otherwise at the end.</p>}
      </section>

      {scoped && range.failed && <div className="state error" role="alert"><p>The range did not load</p><div className="actions"><button type="button" className="btn" onClick={range.retry}>Try again</button></div></div>}

      {scoped && range.data && (
        <div className="segmented" role="group" aria-label="Which items to list">
          <button type="button" aria-pressed={withStock} onClick={() => { setWithStock(true); setToCountShown(LIST) }}>With stock ({stocked.length})</button>
          <button type="button" aria-pressed={!withStock} onClick={() => { setWithStock(false); setToCountShown(LIST) }}>All items ({range.data.length})</button>
        </div>
      )}
      {scoped && range.data && withStock && stocked.length === 0 && range.data.length > 0 && <p className="note">Nothing in {scopeLabel(count).toLowerCase()} has stock on the system. Choose All items to count them anyway.</p>}

      {scoped && range.data && remaining.length > 0 && (
        <section>
          <h2>Still to count <small className="muted">{remaining.length}</small></h2>
          <ul className="pricehits tocount">
            {remaining.slice(0, toCountShown).map((p) => (
              <li key={p.item.code}><button type="button" className="linkish" onClick={() => openItem(p)}><b>{p.item.description || p.item.code}</b><small>{p.item.code}{(p.stock?.inventory ?? 0) < 0 ? ', negative on the system' : ''}</small></button></li>
            ))}
          </ul>
          {remaining.length > toCountShown && <div className="actions"><button type="button" className="btn" onClick={() => setToCountShown((n) => n + LIST * 3)}>Show more</button></div>}
        </section>
      )}
      {scoped && range.data && remaining.length === 0 && scopeTotal > 0 && <p className="note">Everything in {scopeLabel(count).toLowerCase()} is counted. Finish the count when you are ready.</p>}

      <section>
        <h2>Counted <small className="muted">{lines.length}</small></h2>
        {!loaded ? <div className="skeleton" aria-busy="true" aria-label="Loading the count"><i /><i /></div>
          : lines.length === 0 ? <div className="state compact"><p>Nothing counted yet</p><p className="muted">Scan an item to start.</p></div>
          : (
            <>
              <div className="tablewrap">
                <table className="book counted">
                  <thead><tr><th>Item</th><th>Description</th><th className="r">Counted</th><th className="r">System</th><th className="r">Difference</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
                  <tbody>
                    {recent.map((l) => {
                      const d = variance(l)
                      return (
                        <tr key={l.id}>
                          <td data-label="Item" className="num">{l.item_code}</td>
                          <td data-label="Description">{l.description}</td>
                          <td data-label="Counted" className="r num">{l.counted}</td>
                          <td data-label="System" className="r num">{fmtQty(l.system_qty)}</td>
                          <td data-label="Difference" className="r num">{d === 0 ? <span className="chip paid">Matches</span> : <span className={'chip ' + (d < 0 ? 'bad' : 'warn')}>{fmtDiff(d)}</span>}</td>
                          <td className="rowactions"><button type="button" className="btn" onClick={() => void openByCode(l.item_code)}>Recount</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {lines.length > recentShown && <div className="actions"><button type="button" className="btn" onClick={() => setRecentShown((n) => n + RECENT * 4)}>Show more</button></div>}
            </>
          )}
      </section>

      {scanning && <Scanner onScan={(v) => void onScan(v)} onClose={() => setScanning(false)} feedback={scanMsg} />}
      {sheet && open && (
        <CountSheet key={sheet.product.item.code + (sheet.conflict === undefined ? '' : ':c')} product={sheet.product} existing={sheetLine} conflict={sheet.conflict} busy={busy}
          onSave={(c) => void save(c)} onRemove={() => void save(null)} onClose={() => setSheet(null)} />
      )}
      {finishing && (
        <CountFinish count={count} lines={lines} canManage={canManage} onRecount={recount} onBack={() => setFinishing(false)}
          onSaved={(c) => { onChange(c); setFinishing(false); setNavOpen(true) }} />
      )}
      {navOpen && <CountNavDialog count={count} lines={lines} locationCode={store.code} onChanged={onChange} onClose={() => { setNavOpen(false); onLeave() }} />}
    </div>
  )
}
