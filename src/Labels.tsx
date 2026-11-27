import { useEffect, useMemo, useState } from 'react'
import CommitInput from './CommitInput'
import { useConfirm } from './Confirm'
import ItemPicker from './ItemPicker'
import Loading from './Loading'
import { useToast } from './Toast'
import { demoItems } from './lib/demo'
import { indexItems, loadPriceList } from './lib/items'
import {
  MAX_QTY, TEMPLATES, addToQueue, buildLabelsPdf, deviceQueue, discountOf, expand, keepDeviceQueue, labelCount, loadSettings, nowPrice, perSheet, problemOf, regroup, saveSettings, sheetState, splitFull, takeFromQueue, templateOf,
  type LabelJob, type LabelSettings, type QueueItem, type TemplateId,
} from './lib/labels'
import type { Item } from './lib/quote'
import { DEMO, type StoreRow } from './lib/supabase'
import { api } from './lib/api'
import { trackError } from './lib/analytics/track'
import { useLoad } from './lib/useLoad'

const STORE_KEY = 'hsw-orders-store' // the same store Price check and the Order tab last used
let moving = false // the old on-device queue is being moved: never twice at once
const money = (n: number) => `$${n.toFixed(2)}`
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** A past print being changed. It is worked on here, apart from the store's queue, and printing saves the changes to it. */
interface Draft extends LabelSettings { job: LabelJob; queue: QueueItem[] }

/** A print queue for price labels, shared by every device in the store and kept up to date live. Print when the sheet is full, or print what you have. */
export default function Labels({ stores, names }: { stores: StoreRow[]; names: Record<string, string> }) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [settings, setSettings] = useState<LabelSettings>(loadSettings)
  const [items, setItems] = useState<Item[]>([])
  const [storeId, setStoreId] = useState(() => { try { const s = localStorage.getItem(STORE_KEY); if (s && stores.some((x) => x.id === s)) return s } catch { /* ignore */ } return stores[0]?.id ?? '' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const jobs = useLoad(() => (storeId ? api.listLabelJobs(storeId) : Promise.resolve([] as LabelJob[])), [storeId], !!storeId)
  const waiting = useLoad(() => (storeId ? api.labelQueue(storeId) : Promise.resolve([] as QueueItem[])), [storeId], !!storeId)
  const [live, setLive] = useState<{ storeId: string; queue: QueueItem[] } | null>(null) // the newest queue heard of; tagged so another store's never shows
  useEffect(() => { saveSettings(settings) }, [settings])
  useEffect(() => { if (waiting.data) setLive({ storeId, queue: waiting.data }) }, [waiting.data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => (storeId ? api.subscribeLabelQueue(storeId, (queue) => setLive({ storeId, queue })) : undefined), [storeId])
  useEffect(() => {
    let alive = true
    const source: Promise<Item[]> = DEMO
      ? Promise.resolve(demoItems().map((i) => ({ code: i.code, description: i.description, price: i.price, status: 'ACTIVE', barcode: i.barcode || undefined })))
      : loadPriceList().then((p) => p.items)
    source.then((l) => { if (alive) setItems(l) }).catch(() => { /* the picker reports it */ })
    return () => { alive = false }
  }, [])

  // Labels left waiting on this device from before the queue was shared move to the store's queue, once.
  useEffect(() => {
    const left = deviceQueue()
    if (moving || !storeId || !left.length) return
    moving = true
    void (async () => {
      try {
        for (const [n, { discount, ...i }] of left.entries()) {
          if (i.qty > 0) await api.queueLabel(storeId, i)
          keepDeviceQueue(left.slice(n + 1)) // forgotten only once the store's queue has it
          if (i.qty > 0 && discount) await api.setQueuedLabel(storeId, i.code, { discount })
        }
      } catch (e) { trackError('label queue move', e); toast.error('Labels waiting on this device could not all be moved to the store’s queue. They will be tried again next time.') }
      moving = false
      waiting.retry()
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const shared = live?.storeId === storeId ? live.queue : null
  const view: LabelSettings = draft ?? settings
  const byCode = useMemo(() => indexItems(items), [items])
  const t = templateOf(view.template)
  // A clearance line with no discount of its own takes this device's usual discount.
  const queue = (draft ? draft.queue : shared ?? []).map((i) => (t.clearance && !i.discount ? { ...i, discount: view.defaultDiscount } : i))
  const per = perSheet(t)
  const total = labelCount(queue)
  const sheet = sheetState(total, per, view.startAt)
  const problems = queue.filter((i) => problemOf(i, t))
  const patch = (p: Partial<LabelSettings>) => (draft ? setDraft((d) => d && { ...d, ...p }) : setSettings((s) => ({ ...s, ...p })))

  // A change shows here at once, then is saved to the store's queue; if saving fails, what is really there is loaded again.
  const change = async (next: (q: QueueItem[]) => QueueItem[], save: () => Promise<unknown>) => {
    if (draft) return setDraft((d) => d && { ...d, queue: next(d.queue) })
    setLive((l) => l && { ...l, queue: next(l.queue) })
    try { await save() } catch (e) { trackError('label queue', e); toast.error('That change was not saved. Check your connection and try again.'); waiting.retry() }
  }
  const setItem = (code: string, p: { qty?: number; discount?: string }) => void change((q) => q.map((i) => (i.code === code ? { ...i, ...p } : i)), () => api.setQueuedLabel(storeId, code, p))
  const take = (taken: { code: string; qty: number }[]) => change((q) => takeFromQueue(q, taken), () => api.takeLabels(storeId, taken))

  const add = async (picked: { code: string; description: string }, qty: number) => {
    const it = byCode.get(picked.code)
    const line = { code: picked.code, description: picked.description, price: it?.price ?? null, barcode: it?.barcode }
    if (draft) return setDraft((d) => d && { ...d, queue: addToQueue(d.queue, line, qty) })
    try {
      await api.queueLabel(storeId, { ...line, qty: Math.min(MAX_QTY, qty) })
      waiting.retry()
    } catch (e) { trackError('label queue', e); toast.error('Could not add it. Check your connection and try again.'); return false }
  }
  const changeTemplate = (id: TemplateId) => patch({ template: id, startAt: 1 })
  const clearAll = async () => {
    if (!(await ask({ title: 'Clear the queue?', body: <p>The {total} {total === 1 ? 'label' : 'labels'} waiting will be removed{draft ? '' : ' on every device in this store'}.</p>, confirmLabel: 'Clear queue', danger: true }))) return
    void take(queue)
    patch({ startAt: 1 })
  }

  // Every print is kept so it can be seen, changed, printed again or deleted. Printing never waits on this: if it fails, the labels are already out.
  const keepPrint = async (labels: QueueItem[]) => {
    if (!storeId) return
    try {
      await api.saveLabelJob({ id: draft?.job.id, store_id: storeId, template: view.template, start_at: view.startAt, barcode: view.barcode, teal: view.teal, lines: regroup(labels), label_count: labels.length })
      jobs.retry()
    } catch (e) { trackError('label job', e); toast.info('The labels are printing, but this print could not be saved to Past prints.') }
  }
  const editJob = (j: LabelJob) => {
    setDraft({ job: j, template: j.template, queue: j.lines.map((l) => ({ ...l })), startAt: j.start_at, barcode: j.barcode, teal: j.teal, defaultDiscount: '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const reprintJob = (j: LabelJob) => {
    const doc = buildLabelsPdf(expand(j.lines), templateOf(j.template), { startAt: j.start_at, barcode: j.barcode, teal: j.teal })
    window.open(URL.createObjectURL(doc.output('blob')), '_blank')
  }
  const deleteJob = async (j: LabelJob) => {
    if (!(await ask({ title: 'Delete this past print?', body: <p>{j.label_count} {j.label_count === 1 ? 'label' : 'labels'} printed {when(j.printed_at)}. This cannot be undone.</p>, confirmLabel: 'Delete', danger: true }))) return
    try { await api.deleteLabelJob(j.id); if (draft?.job.id === j.id) setDraft(null); jobs.retry(); toast.success('Past print deleted.') }
    catch (e) { trackError('label job delete', e); toast.error('Could not delete it. Try again.') }
  }

  const printNow = (labels: QueueItem[], taken: { code: string; qty: number }[]) => {
    if (problems.length) return toast.error(`Fix ${problems.length === 1 ? 'the item' : 'the items'} marked in the list first.`)
    if (!labels.length) return
    const doc = buildLabelsPdf(labels, t, { startAt: view.startAt, barcode: view.barcode, teal: view.teal })
    window.open(URL.createObjectURL(doc.output('blob')), '_blank')
    void keepPrint(labels)
    const end = (view.startAt - 1 + labels.length) % per
    const startAt = end === 0 ? 1 : end + 1
    if (draft) {
      // Anything of the past print not printed this time joins the store's queue.
      const left = takeFromQueue(queue, taken).filter((i) => i.qty > 0)
      setDraft(null)
      setSettings((s) => ({ ...s, startAt }))
      void Promise.all(left.map(({ discount: _d, ...i }) => api.queueLabel(storeId, i))).then(() => waiting.retry())
        .catch((e) => { trackError('label queue', e); toast.error('The labels not printed could not be added to the queue.') })
    } else {
      void take(taken)
      patch({ startAt })
    }
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
    printNow(expand(queue), queue)
  }
  const full = splitFull(queue, per, view.startAt)
  const printFull = () => printNow(full.print, regroup(full.print))

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Labels</h1>
          <p className="muted">Scan or search items to add their labels, here or from Price check on any device. Print when the sheet is full, or print what you have.</p>
        </div>
      </div>

      {draft && (
        <p className="note" role="status">Editing the print from {when(draft.job.printed_at)}. Printing saves your changes to it. <button type="button" className="quiet" onClick={() => setDraft(null)}>Stop editing</button></p>
      )}
      <div className="filters labelbar">
        {stores.length > 1 && (
          <label className="inline">Store
            <select name="labelstore" value={storeId} onChange={(e) => { setStoreId(e.target.value); setDraft(null); try { localStorage.setItem(STORE_KEY, e.target.value) } catch { /* ignore */ } }}>
              {stores.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        <div className="segmented" role="group" aria-label="Label type">
          {TEMPLATES.map((x) => <button key={x.id} type="button" aria-pressed={view.template === x.id} onClick={() => changeTemplate(x.id)}>{x.name} <small>{x.hint}</small></button>)}
        </div>
        {t.clearance ? (
          <label className="inline">Usual discount %
            <input className="qty" name="defaultDiscount" inputMode="decimal" autoComplete="off" value={view.defaultDiscount} onChange={(e) => patch({ defaultDiscount: e.target.value })} />
          </label>
        ) : (
          <>
            <label className="inline"><input type="checkbox" name="barcode" checked={view.barcode} onChange={(e) => patch({ barcode: e.target.checked })} /> Barcode number</label>
            <label className="inline"><input type="checkbox" name="teal" checked={view.teal} onChange={(e) => patch({ teal: e.target.checked })} /> Teal band</label>
          </>
        )}
      </div>

      <ItemPicker onAdd={add} scan />

      {!draft && shared === null ? (
        waiting.failed ? (
          <div className="state error" role="alert"><p>The labels waiting did not load</p><div className="actions"><button type="button" className="btn" onClick={waiting.retry}>Try again</button></div></div>
        ) : <Loading />
      ) : queue.length === 0 ? (
        <div className="state"><p>No labels waiting</p><p className="muted">Scan an item or search for it, give the number of labels, and add it.</p></div>
      ) : (
        <>
          <div className="note" role="status">
            <p><b>{sheet.sheets === 1 ? 'Sheet 1' : `${sheet.sheets} sheets`}: {sheet.onLast} of {per} used on the last</b>
              {sheet.spaceLeft > 0 ? `. ${sheet.spaceLeft} ${sheet.spaceLeft === 1 ? 'space' : 'spaces'} left. Add ${sheet.spaceLeft === 1 ? 'one more' : `${sheet.spaceLeft} more`} to fill it.` : '. The sheet is full.'}</p>
            <div className="sheetmap" style={{ gridTemplateColumns: `repeat(${t.cols}, 1fr)` }} aria-hidden="true">
              {Array.from({ length: per }, (_, n) => <i key={n} className={sheet.sheets <= 1 ? (n < view.startAt - 1 ? 'used' : n < sheet.onLast ? 'on' : '') : 'on'} />)}
            </div>
          </div>

          <div className="tablewrap">
            <table className="book labels">
              <thead><tr><th>Item</th><th>Description</th><th className="r">{t.clearance ? 'Was' : 'Price'}</th>{t.clearance && <><th className="r">Discount %</th><th className="r">Now</th></>}<th className="r">Labels</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>
                {queue.map((i) => {
                  const bad = problemOf(i, t)
                  const d = discountOf(i.discount)
                  return (
                    <tr key={i.code}>
                      <td data-label="Item" className="num">{i.code}</td>
                      <td data-label="Description">{i.description}{bad && <small className="bad"> {bad}</small>}</td>
                      <td data-label={t.clearance ? 'Was' : 'Price'} className="r num">{i.price !== null ? money(i.price) : '–'}</td>
                      {t.clearance && (
                        <>
                          <td data-label="Discount %" className="r"><CommitInput name={`disc-${i.code}`} inputMode="decimal" label={`Discount percent for ${i.code}`} value={i.discount} onCommit={(v) => setItem(i.code, { discount: v.trim().slice(0, 8) })} /></td>
                          <td data-label="Now" className="r num">{i.price !== null && d !== null ? money(nowPrice(i.price, d)) : '–'}</td>
                        </>
                      )}
                      <td data-label="Labels" className="r"><CommitInput name={`qty-${i.code}`} inputMode="numeric" label={`Number of labels for ${i.code}`} value={String(i.qty)} onCommit={(v) => setItem(i.code, { qty: Math.min(MAX_QTY, Math.floor(Number(v.replace(/[^\d]/g, ''))) || 0) })} /></td>
                      <td className="rowactions"><button type="button" className="btn" onClick={() => void take([{ code: i.code, qty: MAX_QTY }])}>Remove</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="filters">
            <label className="inline">First label goes in position
              <input className="qty" name="startAt" inputMode="numeric" autoComplete="off" value={String(view.startAt)} onChange={(e) => patch({ startAt: Math.min(per, Math.max(1, Math.floor(Number(e.target.value.replace(/[^\d]/g, ''))) || 1)) })} />
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
                      <button type="button" className="btn" onClick={() => editJob(j)}>Edit</button>
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
