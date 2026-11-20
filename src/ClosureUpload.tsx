import { useEffect, useRef, useState } from 'react'
import ItemPicker from './ItemPicker'
import { useToast } from './Toast'
import { closuresApi, type ClosureKind } from './lib/closures/api'
import { readCsv, decodeUtf8 } from './lib/closures/csv'
import { demoSheetRows } from './lib/closures/demoClosures'
import { addHandLine, FIRST_ROW, rowsFromLines, type HandLine } from './lib/closures/manual'
import { parseClosure, type ClosureParse } from './lib/closures/parse'
import { blocked, checkClosure } from './lib/closures/validate'
import type { Check } from './lib/sales/validate'
import { readWorkbook, type Row } from './lib/xlsx'
import { DEMO } from './lib/supabase'

export interface OpsStore { id: string; name: string; code: string; active: boolean }
interface Props { stores: OpsStore[]; onDone: (closureId: string) => void; onCancel: () => void }

interface Read { file: string; rows: Row[]; notes: string[]; parsed: ClosureParse; checks: Check[]; firstRow: number }

/** Excel or CSV bytes to rows. An Excel file uses the first sheet that has a header row we can read, else the first visible one. */
function rowsOf(file: string, bytes: Uint8Array): { rows: Row[]; notes: string[] } {
  if (/\.csv$/i.test(file)) {
    const { text, suspect } = decodeUtf8(bytes)
    return { rows: readCsv(text).rows, notes: suspect ? ['Some characters in the file could not be read. If it came from Excel, save it as CSV UTF-8, or upload the .xlsx instead.'] : [] }
  }
  const wb = readWorkbook(bytes)
  const visible = wb.sheets.filter((s) => !s.hidden)
  const sheet = visible.find((s) => parseClosure(s.rows).headerRow >= 0) ?? visible[0]
  if (!sheet) throw new Error('That workbook has no sheets to read.')
  return { rows: sheet.rows, notes: [] }
}

/** The pre-upload checks, in the same wording and layout as the sales upload. */
function Checks({ checks }: { checks: Check[] }) {
  const bad = checks.filter((c) => !c.ok)
  const stop = bad.filter((c) => c.blocking)
  return (
    <div className="checks">
      <p className={stop.length ? 'note bad' : 'note'} role={stop.length ? 'alert' : undefined}>
        {stop.length ? `Blocked: ${stop.length} check${stop.length === 1 ? '' : 's'} failed. Nothing has been saved.` : `${checks.length - bad.length} of ${checks.length} checks passed.`}
        {!stop.length && bad.length > 0 && ` ${bad.length} to read below.`}
      </p>
      {bad.length > 0 && <ul className="warnlist">{bad.map((c) => <li key={c.label}><b>{c.label}.</b> {c.detail}</li>)}</ul>}
      <details className="storedetails"><summary>See every check</summary>
        <ul className="checklist">{checks.map((c) => <li key={c.label} className={c.ok ? 'ok' : 'no'}><span aria-hidden="true">{c.ok ? '✓' : '✕'}</span> {c.label}</li>)}</ul>
      </details>
    </div>
  )
}

/** Start a closure or a push: choose the store, upload a sheet or type the items, check them, and save as a draft to plan from. */
export default function ClosureUpload({ stores, onDone, onCancel }: Props) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<ClosureKind>('push')
  const [mode, setMode] = useState<'sheet' | 'hand'>('sheet')
  const [handLines, setHandLines] = useState<HandLine[]>([]) // items chosen by hand, in the order they were added
  const [storeId, setStoreId] = useState('')
  const [name, setName] = useState('')
  const [over, setOver] = useState(false)
  const [reading, setReading] = useState(false)
  const [read, setRead] = useState<Read | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<number | null>(null) // lines saved so far while saving
  const store = stores.find((s) => s.id === storeId)

  const check = async (file: string, rows: Row[], notes: string[], forStore: string, firstRow = 1) => {
    const parsed = parseClosure(rows, firstRow)
    const codes = parsed.lines.map((l) => l.code)
    const [known, stock] = await Promise.all([closuresApi.knownCodes(codes), forStore ? closuresApi.opsStock(forStore, codes) : Promise.resolve(new Map<string, { inventory: number; cost: number }>())])
    const checks = checkClosure(parsed, { knownCodes: known, systemQty: new Map([...stock].map(([c, v]) => [c, v.inventory])) })
    notes.forEach((n) => checks.unshift({ label: 'File reads cleanly', ok: false, blocking: false, detail: n }))
    setRead({ file, rows, notes, parsed, checks, firstRow })
  }

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(''); setRead(null); setReading(true)
    try {
      const { rows, notes } = rowsOf(file.name, new Uint8Array(await file.arrayBuffer()))
      await check(file.name, rows, notes, storeId)
    } catch (e) { setError(e instanceof Error ? e.message : 'That file could not be read.') } finally { setReading(false) }
  }

  const sample = async () => {
    setError(''); setRead(null); setReading(true)
    try { await check('sample-sheet.xlsx', demoSheetRows(), [], storeId) } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the sample.') } finally { setReading(false) }
  }

  const changeStore = (id: string) => {
    setStoreId(id)
    const s = stores.find((x) => x.id === id)
    if (s && !name.trim()) setName(kind === 'push' ? `Push from ${s.name}` : `${s.name} closing`)
    if (read && mode === 'sheet') void check(read.file, read.rows, read.notes, id, read.firstRow).catch(() => undefined) // the sheet's quantities are compared with the chosen store's stock
  }

  const needsStore = kind === 'closure' && !store // a closure needs its closing store; a push may have no sending store
  const fallbackName = kind === 'push' ? 'Push to stores' : `${store?.name ?? 'Store'} closing`

  // The list chosen by hand is checked as it changes, so what you see is always what would be saved.
  useEffect(() => {
    if (mode !== 'hand') return
    if (!handLines.length) { setRead(null); return }
    let live = true
    setError('')
    check('chosen by hand', rowsFromLines(handLines), [], storeId, FIRST_ROW).catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Could not check the list.') })
    return () => { live = false }
  }, [mode, handLines, storeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!read || needsStore || blocked(read.checks)) return
    setSaving(0)
    try {
      const c = await closuresApi.create(store?.id ?? null, name.trim() || fallbackName, read.file, kind)
      try { await closuresApi.addLines(c.id, read.parsed.lines, (n) => setSaving(n)) } catch (e) { await closuresApi.deleteClosure(c.id).catch(() => undefined); throw e }
      toast.success(`Saved ${read.parsed.lines.length.toLocaleString('en-AU')} items. Now choose the stores.`)
      onDone(c.id)
    } catch (e) { setSaving(null); toast.error(e instanceof Error ? e.message : 'Could not save it. Try again.') }
  }

  const stop = !!read && blocked(read.checks)
  const preview = read?.parsed.lines.slice(0, 8) ?? []

  return (
    <div className="viz-stack">
      <section className="sheet viz-card">
        <div className="viz-head"><div><h2>{kind === 'push' ? 'Send items to stores' : 'Start a store closing'}</h2><p className="muted">{kind === 'push'
          ? 'Make a list of the items stores should buy: upload a sheet, or search and add them. Next you choose all stores or only some, and the quantity each is asked for. A sheet is read and checked in your browser, and only the item numbers and quantities are saved, never the file.'
          : 'Choose the store that is closing and upload its stock sheet, or type the items. A sheet is read and checked in your browser, and only the item numbers and quantities are saved, never the file.'}</p></div></div>
        <div className="segmented" role="group" aria-label="What you are starting">
          <button type="button" aria-pressed={kind === 'push'} onClick={() => { setKind('push'); setStoreId(''); setRead(null) }}>Send items to stores</button>
          <button type="button" aria-pressed={kind === 'closure'} onClick={() => { setKind('closure'); setRead(null) }}>Store closing</button>
        </div>
        <div className="grid">
          {kind === 'closure' && (
            <label>Closing store
              <select name="closingStore" value={storeId} onChange={(e) => changeStore(e.target.value)}>
                <option value="">Choose a store</option>
                {[...stores].sort((a, b) => Number(a.active) - Number(b.active) || a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (closed)'}</option>)}
              </select>
            </label>
          )}
          <label>Name <small>shown in the list</small>
            <input name="closureName" autoComplete="off" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'push' ? 'Spring range push' : 'Parramatta closing'} />
          </label>
        </div>
        <div className="segmented" role="group" aria-label="How to add the items">
          <button type="button" aria-pressed={mode === 'sheet'} onClick={() => { setMode('sheet'); setRead(null) }}>Upload a sheet</button>
          <button type="button" aria-pressed={mode === 'hand'} onClick={() => { setMode('hand'); setRead(null) }}>Add by hand</button>
        </div>
        {mode === 'hand' ? (
          <div>
            <p className="muted">Search for an item, choose it, give a quantity and add it. The list below is what will be saved.</p>
            <ItemPicker disabled={saving !== null} onAdd={(item, qty) => { setHandLines((l) => addHandLine(l, { code: item.code, description: item.description, qty })) }} />
            {handLines.length > 0 && (
              <div className="tablewrap">
                <table className="book items">
                  <thead><tr><th>Item</th><th className="r">Quantity</th><th><span className="visually-hidden">Remove</span></th></tr></thead>
                  <tbody>{handLines.map((l) => (
                    <tr key={l.code}>
                      <td data-label="Item"><b className="num">{l.code}</b><small className="sub">{l.description}</small></td>
                      <td data-label="Quantity" className="r"><input key={l.code + ':' + l.qty} className="qty" inputMode="numeric" autoComplete="off" aria-label={`Quantity of ${l.code}`} defaultValue={l.qty} disabled={saving !== null}
                        onBlur={(e) => { const q = Math.floor(Number(e.target.value.replace(/[^\d]/g, ''))); if (q >= 1 && q !== l.qty) setHandLines((all) => all.map((x) => (x.code === l.code ? { ...x, qty: q } : x))); else e.target.value = String(l.qty) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} /></td>
                      <td className="rowactions"><button type="button" className="btn" disabled={saving !== null} aria-label={`Remove ${l.code}`} onClick={() => setHandLines((all) => all.filter((x) => x.code !== l.code))}>Remove</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
        <div className={`drop${over ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void pick(e.dataTransfer.files[0]) }}>
          <p>{reading ? 'Reading…' : 'Drop the stock sheet here, or'}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={() => input.current?.click()} disabled={reading || saving !== null}>Choose a file</button>
            {DEMO && <button type="button" className="btn" onClick={() => void sample()} disabled={reading || saving !== null}>Use a sample sheet</button>}
          </div>
          <input ref={input} type="file" accept=".xlsx,.csv" hidden aria-label="Choose the stock sheet" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
          <p className="muted">An Excel (.xlsx) or CSV file with an item number column and a quantity column.</p>
        </div>
        )}
        {error && <p className="note bad" role="alert">{error}</p>}
      </section>

      {read && (
        <section className="sheet viz-card upload">
          <div className="viz-head"><div><h2>{read.file}</h2><p className="muted">{read.parsed.lines.length.toLocaleString('en-AU')} items, {read.parsed.lines.reduce((n, l) => n + l.qty, 0).toLocaleString('en-AU')} units</p></div></div>
          <Checks checks={read.checks} />
          {preview.length > 0 && (
            <div className="tablewrap">
              <table className="viz-table cells">
                <thead><tr><th>Item</th><th>Description</th><th className="r">Quantity</th></tr></thead>
                <tbody>{preview.map((l) => (
                  <tr key={l.code}><td data-label="Item" className="num s3">{l.code}</td><td data-label="Description" className="full">{l.description || '–'}</td><td data-label="Quantity" className="r s3">{l.qty}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {read.parsed.lines.length > preview.length && <p className="muted">The first {preview.length} are shown.</p>}
          {saving !== null && <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={read.parsed.lines.length} aria-valuenow={saving}><span style={{ transform: `scaleX(${read.parsed.lines.length ? saving / read.parsed.lines.length : 0})` }} /></div>}
          <div className="actions">
            <button type="button" className="btn" onClick={onCancel} disabled={saving !== null}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => void save()} disabled={stop || needsStore || saving !== null}>{saving !== null ? 'Saving…' : 'Next: choose stores'}</button>
          </div>
          {needsStore && !stop && <p className="muted">Choose the closing store above to continue.</p>}
        </section>
      )}
      {!read && <div className="actions"><button type="button" className="btn" onClick={onCancel}>Back</button></div>}
    </div>
  )
}
