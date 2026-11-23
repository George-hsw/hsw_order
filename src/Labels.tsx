import { useEffect, useMemo, useState } from 'react'
import { useConfirm } from './Confirm'
import ItemPicker from './ItemPicker'
import { useToast } from './Toast'
import { demoItems } from './lib/demo'
import { indexItems, loadPriceList } from './lib/items'
import {
  MAX_QTY, TEMPLATES, buildLabelsPdf, discountOf, expand, labelCount, nowPrice, perSheet, problemOf, regroup, sheetState, splitFull, templateOf,
  type LabelJob, type QueueItem, type TemplateId,
} from './lib/labels'
import type { Item } from './lib/quote'
import { DEMO, type StoreRow } from './lib/supabase'
import { api } from './lib/api'
import { trackError } from './lib/analytics/track'
import { useLoad } from './lib/useLoad'

const KEY = 'hsw-label-queue'
interface Saved { template: TemplateId; queue: QueueItem[]; startAt: number; barcode: boolean; teal: boolean; defaultDiscount: string }
const fresh = (): Saved => ({ template: 'shelf', queue: [], startAt: 1, barcode: false, teal: false, defaultDiscount: '' })
const load = (): Saved => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (raw && Array.isArray(raw.queue)) return { ...fresh(), ...raw }
  } catch { /* ignore */ }
  return fresh()
}
const money = (n: number) => `$${n.toFixed(2)}`
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** A print queue for price labels. Add items as they are scanned; the sheet fills up, then everything prints together. */
export default function Labels({ stores, names }: { stores: StoreRow[]; names: Record<string, string> }) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [state, setState] = useState<Saved>(load)
  const [items, setItems] = useState<Item[]>([])
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '')
  const [editing, setEditing] = useState<LabelJob | null>(null) // a past print being changed: printing saves the changes to it
  const jobs = useLoad(() => (storeId ? api.listLabelJobs(storeId) : Promise.resolve([] as LabelJob[])), [storeId], !!storeId)
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ } }, [state])
  useEffect(() => {
    let live = true
    const source: Promise<Item[]> = DEMO
      ? Promise.resolve(demoItems().map((i) => ({ code: i.code, description: i.description, price: i.price, status: 'ACTIVE', barcode: i.barcode || undefined })))
      : loadPriceList().then((p) => p.items)
    source.then((l) => { if (live) setItems(l) }).catch(() => { /* the picker reports it */ })
    return () => { live = false }
  }, [])

  const byCode = useMemo(() => indexItems(items), [items])
  const t = templateOf(state.template)
  const per = perSheet(t)
  const total = labelCount(state.queue)
  const sheet = sheetState(total, per, state.startAt)
  const problems = state.queue.filter((i) => problemOf(i, t))
  const patch = (p: Partial<Saved>) => setState((s) => ({ ...s, ...p }))
  const setItem = (code: string, p: Partial<QueueItem>) => patch({ queue: state.queue.map((i) => (i.code === code ? { ...i, ...p } : i)) })

  const add = (picked: { code: string; description: string }, qty: number) => {
    const it = byCode.get(picked.code)
    const existing = state.queue.find((i) => i.code === picked.code)
    if (existing) { setItem(picked.code, { qty: Math.min(MAX_QTY, existing.qty + qty) }); return }
    patch({ queue: [...state.queue, { code: picked.code, description: picked.description, price: it?.price ?? null, barcode: it?.barcode, qty: Math.min(MAX_QTY, qty), discount: t.clearance ? state.defaultDiscount : '' }] })
  }
  const changeTemplate = (id: TemplateId) => {
    const next = templateOf(id)
    patch({ template: id, startAt: 1, queue: state.queue.map((i) => ({ ...i, discount: next.clearance && !i.discount ? state.defaultDiscount : i.discount })) })
  }
  const clearAll = async () => {
    if (!(await ask({ title: 'Clear the queue?', body: <p>The {total} {total === 1 ? 'label' : 'labels'} waiting will be removed.</p>, confirmLabel: 'Clear queue', danger: true }))) return
    patch({ queue: [], startAt: 1 })
  }

  // Every print is kept so it can be seen, changed, printed again or deleted. Printing never waits on this: if it fails, the labels are already out.
  const keepPrint = async (labels: QueueItem[]) => {
    if (!storeId) return
    try {
      await api.saveLabelJob({ id: editing?.id, store_id: storeId, template: state.template, start_at: state.startAt, barcode: state.barcode, teal: state.teal, lines: regroup(labels), label_count: labels.length })
      setEditing(null)
      jobs.retry()
    } catch (e) { trackError('label job', e); toast.info('The labels are printing, but this print could not be saved to Past prints.') }
  }
  const editJob = async (j: LabelJob) => {
    if (state.queue.length > 0 && !(await ask({ title: 'Replace the labels waiting?', body: <p>The {total} {total === 1 ? 'label' : 'labels'} in the queue will be replaced by this past print. Printing it will save your changes to that print.</p>, confirmLabel: 'Replace and edit' }))) return
    setState({ ...fresh(), template: j.template, queue: j.lines.map((l) => ({ ...l })), startAt: j.start_at, barcode: j.barcode, teal: j.teal })
    setEditing(j)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const reprintJob = (j: LabelJob) => {
    const doc = buildLabelsPdf(expand(j.lines), templateOf(j.template), { startAt: j.start_at, barcode: j.barcode, teal: j.teal })
    window.open(URL.createObjectURL(doc.output('blob')), '_blank')
  }
  const deleteJob = async (j: LabelJob) => {
    if (!(await ask({ title: 'Delete this past print?', body: <p>{j.label_count} {j.label_count === 1 ? 'label' : 'labels'} printed {when(j.printed_at)}. This cannot be undone.</p>, confirmLabel: 'Delete', danger: true }))) return
    try { await api.deleteLabelJob(j.id); if (editing?.id === j.id) setEditing(null); jobs.retry(); toast.success('Past print deleted.') }
    catch (e) { trackError('label job delete', e); toast.error('Could not delete it. Try again.') }
  }

  const printNow = (labels: QueueItem[], keep: QueueItem[]) => {
    if (problems.length) return toast.error(`Fix ${problems.length === 1 ? 'the item' : 'the items'} marked in the list first.`)
    if (!labels.length) return
    const doc = buildLabelsPdf(labels, t, { startAt: state.startAt, barcode: state.barcode, teal: state.teal })
    window.open(URL.createObjectURL(doc.output('blob')), '_blank')
    void keepPrint(labels)
    const end = (state.startAt - 1 + labels.length) % per
    patch({ queue: regroup(keep), startAt: end === 0 ? 1 : end + 1 })
    toast.success(end === 0 ? 'Sent to print. The sheet was full.' : `Sent to print. Put the part-used sheet back in the printer: the next label goes in position ${end + 1}.`)
  }
  const printAll = async () => {
    if (sheet.spaceLeft > 0) {
      const go = await ask({
        title: `${sheet.spaceLeft} ${sheet.spaceLeft === 1 ? 'space' : 'spaces'} left on the sheet`,
        body: <p>The last sheet has {sheet.onLast} of {per} labels. Add more to fill it, or print now and keep the rest of the sheet for next time.</p>,
        confirmLabel: 'Print now', cancelLabel: 'Add more',
      })
      if (!go) return
    }
    printNow(expand(state.queue), [])
  }
  const full = splitFull(state.queue, per, state.startAt)
  const printFull = () => printNow(full.print, full.keep)

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Labels</h1>
          <p className="muted">Scan or search items to add their labels. Print when the sheet is full, or print what you have.</p>
        </div>
      </div>

      {editing && (
        <p className="note" role="status">Editing the print from {when(editing.printed_at)}. Printing saves your changes to it. <button type="button" className="quiet" onClick={() => { setEditing(null); setState(fresh()) }}>Stop editing</button></p>
      )}
      <div className="filters labelbar">
        {stores.length > 1 && (
          <label className="inline">Store
            <select name="labelstore" value={storeId} onChange={(e) => { setStoreId(e.target.value); setEditing(null) }}>
              {stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        <div className="segmented" role="group" aria-label="Label type">
          {TEMPLATES.map((x) => <button key={x.id} type="button" aria-pressed={state.template === x.id} onClick={() => changeTemplate(x.id)}>{x.name} <small>{x.hint}</small></button>)}
        </div>
        {t.clearance ? (
          <label className="inline">Discount % for new items
            <input className="qty" name="defaultDiscount" inputMode="decimal" autoComplete="off" value={state.defaultDiscount} onChange={(e) => patch({ defaultDiscount: e.target.value })} />
          </label>
        ) : (
          <>
            <label className="inline"><input type="checkbox" name="barcode" checked={state.barcode} onChange={(e) => patch({ barcode: e.target.checked })} /> Barcode number</label>
            <label className="inline"><input type="checkbox" name="teal" checked={state.teal} onChange={(e) => patch({ teal: e.target.checked })} /> Teal band</label>
          </>
        )}
      </div>

      <ItemPicker onAdd={add} />

      {state.queue.length === 0 ? (
        <div className="state"><p>No labels waiting</p><p className="muted">Scan an item or search for it, give the number of labels, and add it.</p></div>
      ) : (
        <>
          <div className="note" role="status">
            <p><b>{sheet.sheets === 1 ? 'Sheet 1' : `${sheet.sheets} sheets`}: {sheet.onLast} of {per} used on the last</b>
              {sheet.spaceLeft > 0 ? `. ${sheet.spaceLeft} ${sheet.spaceLeft === 1 ? 'space' : 'spaces'} left. Add ${sheet.spaceLeft === 1 ? 'one more' : `${sheet.spaceLeft} more`} to fill it.` : '. The sheet is full.'}</p>
            <div className="sheetmap" style={{ gridTemplateColumns: `repeat(${t.cols}, 1fr)` }} aria-hidden="true">
              {Array.from({ length: per }, (_, n) => <i key={n} className={sheet.sheets <= 1 ? (n < state.startAt - 1 ? 'used' : n < sheet.onLast ? 'on' : '') : 'on'} />)}
            </div>
          </div>

          <div className="tablewrap">
            <table className="book labels">
              <thead><tr><th>Item</th><th>Description</th><th className="r">{t.clearance ? 'Was' : 'Price'}</th>{t.clearance && <><th className="r">Discount %</th><th className="r">Now</th></>}<th className="r">Labels</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>
                {state.queue.map((i) => {
                  const bad = problemOf(i, t)
                  const d = discountOf(i.discount)
                  return (
                    <tr key={i.code}>
                      <td data-label="Item" className="num">{i.code}</td>
                      <td data-label="Description">{i.description}{bad && <small className="bad"> {bad}</small>}</td>
                      <td data-label={t.clearance ? 'Was' : 'Price'} className="r num">{i.price !== null ? money(i.price) : '–'}</td>
                      {t.clearance && (
                        <>
                          <td data-label="Discount %" className="r"><input className="qty" name={`disc-${i.code}`} inputMode="decimal" autoComplete="off" aria-label={`Discount percent for ${i.code}`} value={i.discount} onChange={(e) => setItem(i.code, { discount: e.target.value })} /></td>
                          <td data-label="Now" className="r num">{i.price !== null && d !== null ? money(nowPrice(i.price, d)) : '–'}</td>
                        </>
                      )}
                      <td data-label="Labels" className="r"><input className="qty" name={`qty-${i.code}`} inputMode="numeric" autoComplete="off" aria-label={`Number of labels for ${i.code}`} value={String(i.qty)} onChange={(e) => { const n = Math.floor(Number(e.target.value.replace(/[^\d]/g, ''))); setItem(i.code, { qty: Math.min(MAX_QTY, Math.max(0, n || 0)) }) }} /></td>
                      <td className="rowactions"><button type="button" className="btn" onClick={() => patch({ queue: state.queue.filter((x) => x.code !== i.code) })}>Remove</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="filters">
            <label className="inline">First label goes in position
              <input className="qty" name="startAt" inputMode="numeric" autoComplete="off" value={String(state.startAt)} onChange={(e) => patch({ startAt: Math.min(per, Math.max(1, Math.floor(Number(e.target.value.replace(/[^\d]/g, ''))) || 1)) })} />
            </label>
            <span className="muted">of {per}. Use this to carry on with a sheet that is already part used.</span>
          </div>
          <div className="actions">
            <button type="button" className="btn primary" onClick={printAll} disabled={total === 0}>Print {total} {total === 1 ? 'label' : 'labels'}</button>
            {sheet.spaceLeft > 0 && full.print.length > 0 && <button type="button" className="btn" onClick={printFull}>Print full sheets only ({full.print.length})</button>}
            <button type="button" className="btn danger" onClick={clearAll}>Clear queue</button>
          </div>
        </>
      )}
      <section className="pastprints" aria-label="Past prints">
        <h2>Past prints <small className="muted">{jobs.data ? jobs.data.length : ''}</small></h2>
        {jobs.loading ? <p className="muted">Loading past prints…</p> : jobs.failed ? (
          <div className="state error" role="alert"><p>The past prints did not load</p><div className="actions"><button type="button" className="btn" onClick={jobs.retry}>Try again</button></div></div>
        ) : !jobs.data || jobs.data.length === 0 ? (
          <div className="state"><p>Nothing printed yet</p><p className="muted">Each print is kept here, so you can see it, change it, print it again or delete it.</p></div>
        ) : (
          <div className="tablewrap">
            <table className="book jobs">
              <thead><tr><th>Printed</th><th>By</th><th>Type</th><th className="r">Labels</th><th>Items</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>
                {jobs.data.map((j) => (
                  <tr key={j.id}>
                    <td data-label="Printed">{when(j.printed_at)}</td>
                    <td data-label="By">{names[j.printed_by.toLowerCase()] ?? j.printed_by}</td>
                    <td data-label="Type">{templateOf(j.template).name}</td>
                    <td data-label="Labels" className="r">{j.label_count}</td>
                    <td data-label="Items" className="desc">{j.lines.slice(0, 3).map((l) => `${l.qty} × ${l.code}`).join(', ')}{j.lines.length > 3 ? ` and ${j.lines.length - 3} more` : ''}</td>
                    <td className="rowactions">
                      <button type="button" className="btn" onClick={() => void editJob(j)}>Edit</button>
                      <button type="button" className="btn" onClick={() => reprintJob(j)}>Print again</button>
                      <button type="button" className="btn danger" onClick={() => void deleteJob(j)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {confirmDialog}
    </>
  )
}
