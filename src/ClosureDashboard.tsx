import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StatTile } from './Charts'
import { useConfirm } from './Confirm'
import ItemPicker from './ItemPicker'
import Loading from './Loading'
import Modal from './Modal'
import { useToast } from './Toast'
import type { OpsStore } from './ClosureUpload'
import { closuresApi, type ClosureDetail, type NeedRow } from './lib/closures/api'
import { allocate, byItem, byStore, reconcile, summary, type Alloc, type NeedLine } from './lib/closures/allocate'
import { money } from './lib/order'
import { useLoad } from './lib/useLoad'

interface Props { id: string; stores: OpsStore[]; names: Record<string, string>; onBack: () => void; renderSent: (d: ClosureDetail, reload: () => void) => React.ReactNode }

const whenText = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
const key = (store: string, code: string) => store + '|' + code
const copy = (a: Alloc): Alloc => new Map([...a].map(([s, m]) => [s, new Map(m)]))
const whole = (text: string) => { const n = Math.floor(Number(text.replace(/[^\d]/g, ''))); return Number.isFinite(n) ? n : 0 }

/** One closure. While it is a draft: choose the stores, see the suggestion, adjust, send. Once sent, the status view takes over. */
export default function ClosureDashboard({ id, stores, names, onBack, renderSent }: Props) {
  const detail = useLoad(() => closuresApi.get(id), [id])
  if (detail.loading) return <Loading />
  if (detail.failed || !detail.data) return <div className="state error" role="alert"><p>The transfer did not load</p><div className="actions"><button type="button" className="btn" onClick={detail.retry}>Try again</button><button type="button" className="btn" onClick={onBack}>Back to transfers</button></div></div>
  if (detail.data.closure.status !== 'draft') return <>{renderSent(detail.data, detail.retry)}</>
  return <Planner key={id} d={detail.data} stores={stores} names={names} onBack={onBack} reload={detail.retry} />
}

type View = 'store' | 'item'

function Planner({ d, stores, names, onBack, reload }: { d: ClosureDetail; stores: OpsStore[]; names: Record<string, string>; onBack: () => void; reload: () => void }) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [lines, setLines] = useState(d.lines) // the list, which can be added to, changed or trimmed by hand while this is a draft
  const closing = useMemo(() => lines.map((l) => ({ code: l.item_code, qty: l.qty })), [lines])
  const cost = useMemo(() => new Map(lines.map((l) => [l.item_code, l.unit_cost])), [lines])
  const info = useMemo(() => new Map(lines.map((l) => [l.item_code, l])), [lines])
  const closingStore = stores.find((s) => s.id === d.closure.closing_store_id)
  const candidates = useMemo(() => stores.filter((s) => s.active && s.id !== d.closure.closing_store_id).sort((a, b) => a.name.localeCompare(b.name)), [stores, d.closure.closing_store_id])
  const storeName = (sid: string) => stores.find((s) => s.id === sid)?.name ?? 'A store'

  const [picked, setPicked] = useState<Set<string>>(() => new Set(d.participants.length ? d.participants : candidates.map((s) => s.id)))
  const [alloc, setAlloc] = useState<Alloc>(() => { const a: Alloc = new Map(); for (const r of d.alloc) { const m = a.get(r.store_id) ?? new Map<string, number>(); m.set(r.item_code, r.qty); a.set(r.store_id, m) } return a })
  const [suggested, setSuggested] = useState<Alloc>(() => { const a: Alloc = new Map(); for (const r of d.alloc) { const m = a.get(r.store_id) ?? new Map<string, number>(); m.set(r.item_code, r.suggested_qty); a.set(r.store_id, m) } return a })
  const [need, setNeed] = useState<NeedRow[]>([])
  const [view, setView] = useState<View>('store')
  const [working, setWorking] = useState(false)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [sending, setSending] = useState(false)
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [listBusy, setListBusy] = useState(false)
  const [listChanged, setListChanged] = useState(false) // items changed since the suggestions were worked out
  const [savedStores, setSavedStores] = useState<string[]>(d.participants) // the stores last saved with the suggestions
  const planned = savedStores.length > 0 // the stores have been chosen and suggestions made at least once
  const dirty = useRef(new Set<string>())
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const latest = useRef(alloc)
  latest.current = alloc

  const needLines: NeedLine[] = useMemo(() => need.map((n) => ({ store: n.store_id, code: n.item_code, shortfall: n.shortfall })), [need])
  const codes = useMemo(() => closing.map((c) => c.code), [closing])

  // The shortfalls shown beside each quantity, for a draft that was already planned.
  useEffect(() => {
    if (!planned) return
    let live = true
    closuresApi.need([...picked], codes, d.closure.id).then((n) => { if (live) setNeed(n) }).catch(() => undefined)
    return () => { live = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rowsFor = (keys: Iterable<string>) => [...keys].map((k) => { const [store, code] = k.split('|'); return { store_id: store, item_code: code, qty: latest.current.get(store)?.get(code) ?? 0, suggested_qty: suggested.get(store)?.get(code) ?? 0 } })

  const flush = useCallback(async () => {
    const keys = [...dirty.current]
    dirty.current = new Set()
    if (!keys.length) return
    setSaving('saving')
    try { await closuresApi.saveAlloc(d.closure.id, rowsFor(keys)); setSaving('saved') } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that change.')
      reload() // show what the database actually holds
    }
  }, [d.closure.id, suggested]) // eslint-disable-line react-hooks/exhaustive-deps

  const setQty = (store: string, code: string, qty: number) => {
    const closingQty = info.get(code)?.qty ?? 0
    const others = [...latest.current].reduce((n, [s, m]) => n + (s === store ? 0 : m.get(code) ?? 0), 0)
    const next = Math.max(0, Math.min(qty, closingQty - others)) // never more than the sheet holds
    setAlloc((prev) => { const a = copy(prev); const m = a.get(store) ?? new Map<string, number>(); if (next > 0) m.set(code, next); else m.delete(code); a.set(store, m); latest.current = a; return a })
    dirty.current.add(key(store, code))
    setSaving('idle')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), 600)
  }
  useEffect(() => () => { clearTimeout(timer.current); void flush() }, [flush])

  const suggest = async () => {
    if (picked.size === 0) return toast.error('Choose at least one store.')
    if (alloc.size && [...alloc.values()].some((m) => m.size) && !(await ask({ title: 'Work out the suggestions again?', body: <p>This replaces the quantities you have now, including any changes you made by hand.</p>, confirmLabel: 'Replace them' }))) return
    setWorking(true)
    try {
      const stores2 = [...picked]
      await closuresApi.setStores(d.closure.id, stores2)
      setSavedStores(stores2)
      const n = await closuresApi.need(stores2, codes, d.closure.id)
      const res = allocate(closing, n.map((x) => ({ store: x.store_id, code: x.item_code, shortfall: x.shortfall })), stores2)
      const old = [...latest.current].flatMap(([s, m]) => [...m.keys()].map((c) => key(s, c)))
      setNeed(n); setAlloc(res.alloc); setSuggested(copy(res.alloc)); latest.current = res.alloc; setListChanged(false)
      const rows = new Map<string, { store_id: string; item_code: string; qty: number; suggested_qty: number }>()
      for (const k of old) { const [s, c] = k.split('|'); rows.set(k, { store_id: s, item_code: c, qty: 0, suggested_qty: 0 }) }
      for (const [s, m] of res.alloc) for (const [c, q] of m) rows.set(key(s, c), { store_id: s, item_code: c, qty: q, suggested_qty: q })
      await closuresApi.saveAlloc(d.closure.id, [...rows.values()])
      setSaving('saved')
      toast.success(`Suggested ${[...res.alloc.values()].reduce((x, m) => x + m.size, 0)} lines for ${res.alloc.size} ${res.alloc.size === 1 ? 'store' : 'stores'}.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not work out the suggestions. Try again.') } finally { setWorking(false) }
  }

  const sum = useMemo(() => summary(alloc, closing, cost), [alloc, closing, cost])
  const problems = useMemo(() => reconcile(alloc, closing), [alloc, closing])
  const storeRows = useMemo(() => byStore(alloc, needLines, suggested).filter((r) => r.lines.some((l) => l.qty > 0 || l.suggested > 0)), [alloc, needLines, suggested])
  const itemRows = useMemo(() => byItem(alloc, needLines, closing), [alloc, needLines, closing])
  const stale = [...picked].sort().join() !== [...savedStores].sort().join() && planned

  const send = async () => {
    await flush()
    const toStores = [...alloc].filter(([, m]) => [...m.values()].some((q) => q > 0))
    if (!toStores.length) return toast.error('Nothing has been given to any store yet.')
    const lines = toStores.map(([s, m]) => `${storeName(s)}: ${[...m.values()].reduce((x, q) => x + q, 0)} units, ${money([...m].reduce((x, [c, q]) => x + q * (cost.get(c) ?? 0), 0))}`)
    if (!(await ask({
      title: `Send to ${toStores.length} ${toStores.length === 1 ? 'store' : 'stores'}?`,
      body: <><p>Each store is asked to accept, lower or decline its share, and is told straight away. You cannot change the quantities after this, but you can take back a request that has not been answered and offer what is left to other stores.</p><ul className="uncounted">{lines.map((l) => <li key={l}>{l}</li>)}</ul><p>Stock figures are as at the last nightly sync, so a store’s need may have changed since.</p></>,
      confirmLabel: 'Send the requests',
    }))) return
    setSending(true)
    try { await closuresApi.send(d.closure.id); toast.success(`Sent to ${toStores.length} ${toStores.length === 1 ? 'store' : 'stores'}.`); reload() } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not send. Try again.') } finally { setSending(false) }
  }

  // Add, change or remove one item by hand. The database refuses a quantity below what is already shared out to stores.
  const changeLine = async (code: string, qty: number): Promise<boolean> => {
    setListBusy(true)
    try {
      await flush()
      await closuresApi.setLine(d.closure.id, code, qty)
      setLines((await closuresApi.get(d.closure.id)).lines)
      setListChanged(true)
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not change the list.'); return false } finally { setListBusy(false) }
  }
  const addLine = async (code: string, qty: number): Promise<boolean> => {
    const ok = await changeLine(code, (info.get(code)?.qty ?? 0) + qty)
    if (ok) toast.success(`Added ${qty} of ${code}.`)
    return ok
  }

  const remove = async () => {
    if (!(await ask({ title: 'Delete this draft?', body: <p>The uploaded list and the quantities are removed. Nothing has been sent to any store.</p>, confirmLabel: 'Delete draft', danger: true }))) return
    try { await closuresApi.deleteClosure(d.closure.id); toast.success('Draft deleted.'); onBack() } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete it.') }
  }

  const hasPlan = sum.allocated > 0
  const asking = storeRows.filter((r) => r.units > 0).length
  const asAt = 'Stock and sales are as at the last nightly sync.'

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{d.closure.name || (d.closure.kind === 'push' ? 'Push to stores' : `${closingStore?.name ?? 'Store'} closing`)}</h1>
          <p className="muted">{closingStore?.name ?? (d.closure.kind === 'push' ? 'No sending store, so stores are asked to order' : 'Closing store')}, {sum.items} items, {sum.units.toLocaleString('en-AU')} units. Started {whenText(d.closure.created_at)}{d.closure.created_by ? ` by ${names[d.closure.created_by.toLowerCase()] ?? d.closure.created_by}` : ''}. <span className="chip warn">Draft</span></p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={onBack}>All transfers</button>
          <button type="button" className="btn danger" onClick={() => void remove()}>Delete draft</button>
        </div>
      </div>

      <div className="viz-stack">
        <section className="sheet viz-card">
          <div className="viz-head"><div><h2>Which stores take part</h2><p className="muted">Only these stores are offered the stock. {asAt}</p></div></div>
          <div className="storepick" role="group" aria-label="Stores that take part">
            {candidates.map((s) => (
              <label key={s.id} className="inline"><input type="checkbox" name={`take-${s.id}`} checked={picked.has(s.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n })} /> {s.name}</label>
            ))}
          </div>
          <div className="actions quick">
            <button type="button" className="btn" onClick={() => setPicked(new Set(candidates.map((s) => s.id)))}>Choose all</button>
            <button type="button" className="btn" onClick={() => setPicked(new Set())}>Choose none</button>
            <button type="button" className={'btn' + (planned ? '' : ' primary')} onClick={() => void suggest()} disabled={working || picked.size === 0}>{working ? 'Working it out…' : planned ? 'Work out the suggestions again' : 'Work out the suggestions'}</button>
          </div>
          {stale && <p className="note">The stores have changed since the last suggestions. Work them out again to include the change.</p>}
        </section>

        <section className="sheet viz-card">
          <details className="storedetails" open={lines.length === 0 || undefined}>
            <summary>Items on this list ({lines.length}). Add, change or remove</summary>
            <ItemPicker disabled={listBusy} onAdd={(item, qty) => addLine(item.code, qty)} />
            {lines.length > 0 && (
              <div className="tablewrap">
                <table className="book items">
                  <thead><tr><th>Item</th><th className="r">Quantity</th><th><span className="visually-hidden">Remove</span></th></tr></thead>
                  <tbody>{lines.map((l) => (
                    <tr key={l.item_code}>
                      <td data-label="Item"><b className="num">{l.item_code}</b><small className="sub">{l.description}</small></td>
                      <td data-label="Quantity" className="r"><input key={l.item_code + ':' + l.qty} className="qty" inputMode="numeric" autoComplete="off" aria-label={`Quantity of ${l.item_code}`} defaultValue={l.qty} disabled={listBusy}
                        onBlur={(e) => { const q = whole(e.target.value); if (q !== l.qty) void changeLine(l.item_code, q).then((ok) => { if (!ok) e.target.value = String(l.qty) }) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></td>
                      <td className="rowactions"><button type="button" className="btn" disabled={listBusy} aria-label={`Remove ${l.item_code}`} onClick={() => void changeLine(l.item_code, 0)}>Remove</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </details>
          {listChanged && planned && <p className="note">The list has changed since the suggestions were worked out. Work them out again to include the change.</p>}
        </section>

        {planned && (
          <>
            <div className="kpis">
              <StatTile label="Units going to stores" value={`${sum.allocated.toLocaleString('en-AU')} of ${sum.units.toLocaleString('en-AU')}`} ly={`${sum.pctAllocated}% of the stock`} />
              {sum.valueTotal > 0 && <StatTile label="Value going, at cost" value={money(sum.valueAllocated)} ly={`of ${money(sum.valueTotal)}`} />}
              <StatTile label="Left over" value={sum.left.toLocaleString('en-AU')} ly={sum.valueTotal > 0 ? `${money(sum.valueLeft)} at cost` : 'units'} />
              <StatTile label="Stores asked" value={String(storeRows.filter((r) => r.units > 0).length)} ly={`of ${picked.size} taking part`} />
            </div>

            {problems.length > 0 && <div className="state error" role="alert"><p>This cannot be sent yet</p><ul className="warnlist">{problems.slice(0, 5).map((p) => <li key={p.code + (p.store ?? '')}>{p.message}</li>)}</ul></div>}

            <section className="sheet viz-card">
              <div className="viz-head"><div><h2>Who gets what</h2><p className="muted">Change any quantity. A store’s need is worked out from its sales and stock, so a quantity above it is marked. {saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved.' : ''}</p></div></div>
              <div className="segmented" role="group" aria-label="How to see the quantities">
                <button type="button" aria-pressed={view === 'store'} onClick={() => setView('store')}>By store</button>
                <button type="button" aria-pressed={view === 'item'} onClick={() => setView('item')}>By item ({sum.items})</button>
              </div>

              {view === 'store' ? (
                storeRows.length === 0 ? <div className="state compact"><p>Nothing suggested</p><p className="muted">None of the chosen stores falls short of these items. Place items by hand under By item.</p></div> : (
                  storeRows.map((r) => (
                    <div key={r.store} className="closure-store">
                      <h3>{storeName(r.store)} <small className="muted">{r.units} {r.units === 1 ? 'unit' : 'units'}, {money(r.lines.reduce((x, l) => x + l.qty * (cost.get(l.code) ?? 0), 0))}</small></h3>
                      <div className="tablewrap">
                        <table className="book alloc">
                          <thead><tr><th>Item</th><th className="r">Available</th><th className="r">Store needs</th><th className="r">Suggested</th><th className="r">Sending</th></tr></thead>
                          <tbody>{r.lines.map((l) => (
                            <tr key={l.code}>
                              <td data-label="Item"><b className="num">{l.code}</b><small className="sub">{info.get(l.code)?.description}</small></td>
                              <td data-label="Available" className="r">{info.get(l.code)?.qty}</td>
                              <td data-label="Store needs" className="r">{l.shortfall}</td>
                              <td data-label="Suggested" className="r">{l.suggested}</td>
                              <td data-label="Sending" className="r">
                                <input className="qty" inputMode="numeric" autoComplete="off" aria-label={`Units of ${l.code} for ${storeName(r.store)}`} value={l.qty} onChange={(e) => setQty(r.store, l.code, whole(e.target.value))} onFocus={(e) => e.target.select()} />
                                {l.over && l.qty > 0 && <span className="chip warn">Above need</span>}
                              </td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )
              ) : (
                <div className="tablewrap">
                  <table className="book items">
                    <thead><tr><th>Item</th><th className="r">Available</th><th>Going to</th><th className="r">Left over</th><th><span className="visually-hidden">Place</span></th></tr></thead>
                    <tbody>{itemRows.map((r) => (
                      <tr key={r.code} className={r.overAllocated ? 'inactive' : undefined}>
                        <td data-label="Item"><b className="num">{r.code}</b><small className="sub">{info.get(r.code)?.description}</small></td>
                        <td data-label="Available" className="r">{r.closing}</td>
                        <td data-label="Going to">{r.stores.filter((s) => s.qty > 0).length ? r.stores.filter((s) => s.qty > 0).map((s) => <div key={s.store}>{storeName(s.store)} <b>{s.qty}</b></div>) : <span className="muted">No one yet</span>}</td>
                        <td data-label="Left over" className="r">{r.left > 0 ? <span className="chip warn">{r.left}</span> : r.left}</td>
                        <td className="rowactions"><button type="button" className="btn" onClick={() => setOpenItem(r.code)} aria-label={`Place ${r.code}`}>{r.left > 0 ? 'Place' : 'Change'}</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        <div className="actions">
          <button type="button" className="btn primary" onClick={() => void send()} disabled={!hasPlan || problems.length > 0 || sending || working}>{sending ? 'Sending…' : asking ? `Send to ${asking} ${asking === 1 ? 'store' : 'stores'}` : 'Send to stores'}</button>
        </div>
        {!planned && <p className="muted">Choose the stores and work out the suggestions to see who gets what.</p>}
      </div>

      {openItem && (
        <Modal labelledBy="place-title" onClose={() => setOpenItem(null)}>
          <div className="modalbox wide panel">
            <button type="button" className="modal-x" aria-label="Close" onClick={() => setOpenItem(null)}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
            <h2 id="place-title">{openItem}</h2>
            <p className="muted">{info.get(openItem)?.description}. The closing store has {info.get(openItem)?.qty}, and {itemRows.find((r) => r.code === openItem)?.left ?? 0} {(itemRows.find((r) => r.code === openItem)?.left ?? 0) === 1 ? 'is' : 'are'} left over.</p>
            <ul className="people">
              {candidates.filter((s) => picked.has(s.id)).map((s) => {
                const sf = need.find((n) => n.store_id === s.id && n.item_code === openItem)
                const q = alloc.get(s.id)?.get(openItem) ?? 0
                return (
                  <li key={s.id}>
                    <div className="who-line"><b>{s.name}</b><span className="muted">{sf ? `needs ${sf.shortfall}` : 'does not stock it'}</span>{sf && q > sf.shortfall && <span className="chip warn">Above need</span>}</div>
                    <div className="person-actions"><input className="qty" inputMode="numeric" autoComplete="off" aria-label={`Units for ${s.name}`} value={q} onChange={(e) => setQty(s.id, openItem, whole(e.target.value))} onFocus={(e) => e.target.select()} /></div>
                  </li>
                )
              })}
            </ul>
            <div className="actions"><button type="button" className="btn primary" onClick={() => setOpenItem(null)}>Done</button></div>
          </div>
        </Modal>
      )}
      {confirmDialog}
    </>
  )
}
