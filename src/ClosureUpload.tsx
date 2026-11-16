import { useRef, useState } from 'react'
import { useToast } from './Toast'
import { closuresApi } from './lib/closures/api'
import { readCsv, decodeUtf8 } from './lib/closures/csv'
import { demoSheetRows } from './lib/closures/demoClosures'
import { parseClosure, type ClosureParse } from './lib/closures/parse'
import { blocked, checkClosure } from './lib/closures/validate'
import type { Check } from './lib/sales/validate'
import { readWorkbook, type Row } from './lib/xlsx'
import { DEMO } from './lib/supabase'

export interface OpsStore { id: string; name: string; code: string; active: boolean }
interface Props { stores: OpsStore[]; onDone: (closureId: string) => void; onCancel: () => void }

interface Read { file: string; rows: Row[]; notes: string[]; parsed: ClosureParse; checks: Check[] }

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

/** Start a closure: choose the closing store, upload its stock sheet, check it, and save it as a draft to plan from. */
export default function ClosureUpload({ stores, onDone, onCancel }: Props) {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [storeId, setStoreId] = useState('')
  const [name, setName] = useState('')
  const [over, setOver] = useState(false)
  const [reading, setReading] = useState(false)
  const [read, setRead] = useState<Read | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<number | null>(null) // lines saved so far while saving
  const store = stores.find((s) => s.id === storeId)

  const check = async (file: string, rows: Row[], notes: string[], forStore: string) => {
    const parsed = parseClosure(rows)
    const codes = parsed.lines.map((l) => l.code)
    const [known, stock] = await Promise.all([closuresApi.knownCodes(codes), forStore ? closuresApi.opsStock(forStore, codes) : Promise.resolve(new Map<string, { inventory: number; cost: number }>())])
    const checks = checkClosure(parsed, { knownCodes: known, systemQty: new Map([...stock].map(([c, v]) => [c, v.inventory])) })
    notes.forEach((n) => checks.unshift({ label: 'File reads cleanly', ok: false, blocking: false, detail: n }))
    setRead({ file, rows, notes, parsed, checks })
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
    if (s && !name.trim()) setName(`${s.name} closure`)
    if (read) void check(read.file, read.rows, read.notes, id).catch(() => undefined) // the sheet's quantities are compared with the chosen store's stock
  }

  const save = async () => {
    if (!read || !store || blocked(read.checks)) return
    setSaving(0)
    try {
      const c = await closuresApi.create(store.id, name.trim() || `${store.name} closure`, read.file)
      try { await closuresApi.addLines(c.id, read.parsed.lines, (n) => setSaving(n)) } catch (e) { await closuresApi.deleteClosure(c.id).catch(() => undefined); throw e }
      toast.success(`Saved ${read.parsed.lines.length.toLocaleString('en-AU')} items. Now choose the stores.`)
      onDone(c.id)
    } catch (e) { setSaving(null); toast.error(e instanceof Error ? e.message : 'Could not save the closure. Try again.') }
  }

  const stop = !!read && blocked(read.checks)
  const preview = read?.parsed.lines.slice(0, 8) ?? []

  return (
    <div className="viz-stack">
      <section className="sheet viz-card">
        <div className="viz-head"><div><h2>Start a closure</h2><p className="muted">Choose the store that is closing and upload its stock sheet. The file is read and checked in your browser. Only the item numbers and quantities are saved, never the file.</p></div></div>
        <div className="grid">
          <label>Closing store
            <select name="closingStore" value={storeId} onChange={(e) => changeStore(e.target.value)}>
              <option value="">Choose a store</option>
              {[...stores].sort((a, b) => Number(a.active) - Number(b.active) || a.name.localeCompare(b.name)).map((s) => <option key={s.id} value={s.id}>{s.name}{s.active ? '' : ' (closed)'}</option>)}
            </select>
          </label>
          <label>Name <small>shown in the list</small>
            <input name="closureName" autoComplete="off" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Parramatta closure" />
          </label>
        </div>
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
            <button type="button" className="btn primary" onClick={() => void save()} disabled={stop || !store || saving !== null}>{saving !== null ? 'Saving…' : 'Save and choose stores'}</button>
          </div>
          {!store && !stop && <p className="muted">Choose the closing store above to continue.</p>}
        </section>
      )}
      {!read && <div className="actions"><button type="button" className="btn" onClick={onCancel}>Back to closures</button></div>}
    </div>
  )
}
