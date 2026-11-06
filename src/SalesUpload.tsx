import { useRef, useState } from 'react'
import { useConfirm } from './Confirm'
import { useToast } from './Toast'
import { track } from './lib/analytics/track'
import { salesApi } from './lib/sales/api'
import { dailyRows, detailedRows, indexStores, weeklyRows, type Preview } from './lib/sales/import'
import { weekLabel } from './lib/sales/model'
import { kindOf, parseDaily, parseDetailed, parseWeekly, type DailyResult, type DetailedResult, type ReportKind, type WeeklyResult } from './lib/sales/parse'
import { blocked, checkDaily, checkDetailed, checkWeekly, crossCheck, crossDetailed, failures, type Check } from './lib/sales/validate'
import { useLoad } from './lib/useLoad'
import type { StoreRow } from './lib/supabase'

type Parsed = { kind: 'weekly'; data: WeeklyResult } | { kind: 'detailed'; data: DetailedResult } | { kind: 'daily'; data: DailyResult }
interface Entry {
  id: number
  name: string
  kind: ReportKind | null
  phase: 'reading' | 'ready' | 'importing' | 'done' | 'error'
  parsed?: Parsed
  preview?: Preview
  warnings: string[]
  checks: Check[]
  error?: string
  progress?: [number, number]
  imported?: number
}
const KIND_LABEL: Record<ReportKind, string> = { weekly: 'Australian Weekly Sales', detailed: 'Detailed Sales Report', daily: 'Daily Sales' }
const ORDER: Record<ReportKind, number> = { weekly: 0, daily: 1, detailed: 2 }
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/** Admin only. Choose the week's Power BI files; each is read here in the browser and checked before anything is saved. The files themselves are never stored. */
export default function SalesUpload({ email, stores, onLoaded }: { email: string; stores: StoreRow[]; onLoaded: () => void }) {
  const toast = useToast()
  const [ask, dialog] = useConfirm()
  const [entries, setEntries] = useState<Entry[]>([])
  const [over, setOver] = useState(false)
  const next = useRef(1)
  const input = useRef<HTMLInputElement>(null)
  const log = useLoad(() => salesApi.uploads(), [])
  const patch = (id: number, p: Partial<Entry>) => setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...p } : e)))

  const read = async (files: File[]) => {
    const ix = indexStores(stores)
    for (const f of files) {
      const id = next.current++
      const kind = kindOf(f.name)
      setEntries((es) => [...es, { id, name: f.name, kind, phase: kind ? 'reading' : 'error', warnings: [], checks: [], error: kind ? undefined : 'I do not recognise this file. The name should contain Detailed Sales, Australian Weekly or Daily Sales.' }])
      if (!kind) continue
      try {
        await new Promise((r) => setTimeout(r, 30)) // let the screen show "Reading" before the work starts
        const bytes = new Uint8Array(await f.arrayBuffer())
        let parsed: Parsed, preview: Preview, warnings: string[], checks: Check[]
        if (kind === 'weekly') { const d = parseWeekly(bytes, f.name); parsed = { kind, data: d }; preview = weeklyRows(d, ix).preview; warnings = d.warnings; checks = checkWeekly(d) }
        else if (kind === 'detailed') { const d = parseDetailed(bytes, f.name); parsed = { kind, data: d }; preview = detailedRows(d, ix).preview; warnings = d.warnings; checks = checkDetailed(d) }
        else { const d = parseDaily(bytes, f.name); parsed = { kind, data: d }; preview = dailyRows(d, ix).preview; warnings = d.warnings; checks = checkDaily(d) }
        patch(id, { phase: 'ready', parsed, preview, warnings, checks })
      } catch (e) {
        patch(id, { phase: 'error', error: e instanceof Error ? e.message : 'Could not read that file.' })
      }
    }
  }

  // A file's own checks, plus a comparison with the other report of the same week when both are loaded.
  const checksOf = (e: Entry): Check[] => {
    const me = e.parsed
    if (!me) return e.checks
    const extra: Check[] = []
    for (const o of entries) {
      const other = o.id !== e.id ? o.parsed : undefined
      if (!other) continue
      if (me.kind === 'daily' && other.kind === 'weekly') extra.push(...crossCheck(other.data, me.data))
      else if (me.kind === 'weekly' && other.kind === 'daily') extra.push(...crossCheck(me.data, other.data))
      else if (me.kind === 'detailed' && other.kind === 'weekly') extra.push(...crossDetailed(other.data, me.data))
      else if (me.kind === 'weekly' && other.kind === 'detailed') extra.push(...crossDetailed(me.data, other.data))
    }
    return [...e.checks, ...extra]
  }
  const weekOf = (p: Parsed) => (p.kind === 'weekly' ? p.data.current : p.data.week)

  const run = async (e: Entry): Promise<boolean> => {
    if (!e.parsed || e.phase === 'importing' || blocked(checksOf(e))) return false
    patch(e.id, { phase: 'importing', progress: undefined })
    try {
      const p = e.parsed
      const res = p.kind === 'weekly' ? await salesApi.importWeekly(p.data, stores, email)
        : p.kind === 'daily' ? await salesApi.importDaily(p.data, stores, email)
        : await salesApi.importDetailed(p.data, stores, email, (done, total) => patch(e.id, { progress: [done, total] }))
      patch(e.id, { phase: 'done', imported: res.rows })
      track('upload', { report: p.kind, week: weekOf(p).week })
      return true
    } catch (err) {
      patch(e.id, { phase: 'error', error: err instanceof Error ? err.message : 'Could not save.' })
      return false
    }
  }

  const importOne = async (e: Entry) => {
    if (!e.parsed) return
    if (e.parsed.kind === 'detailed' && !(await ask({ title: `Replace ${weekLabel(weekOf(e.parsed))} items?`, body: 'The item rows already saved for that week are replaced by this file. The other weeks are not touched.', confirmLabel: 'Import' }))) return
    if (await run(e)) { toast.success(`${KIND_LABEL[e.kind!]} loaded.`); onLoaded(); log.retry() }
  }

  const ready = entries.filter((e) => e.phase === 'ready' && !blocked(checksOf(e))).sort((a, b) => ORDER[a.kind!] - ORDER[b.kind!])
  const importAll = async () => {
    if (ready.some((e) => e.parsed?.kind === 'detailed') && !(await ask({ title: 'Import everything?', body: 'The item rows already saved for the Detailed Sales week are replaced by that file.', confirmLabel: 'Import all' }))) return
    let ok = 0
    for (const e of ready) if (await run(e)) ok++
    if (ok) { toast.success(ok === 1 ? 'Loaded 1 report.' : `Loaded ${ok} reports.`); onLoaded(); log.retry() }
  }

  return (
    <div className="viz-stack">
      <section className="sheet viz-card">
        <div className="viz-head"><div><h2>Load this week’s reports</h2><p className="muted">Choose the three Power BI files. They are read in your browser and checked first; only the figures are saved, never the files. Stores see only their own rows.</p></div></div>
        <div className={`drop${over ? ' over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); void read([...e.dataTransfer.files]) }}>
          <p>Drop the files here, or</p>
          <button type="button" className="btn primary" onClick={() => input.current?.click()}>Choose files</button>
          <input ref={input} type="file" accept=".xlsx" multiple hidden onChange={(e) => { void read([...(e.target.files ?? [])]); e.target.value = '' }} />
        </div>
      </section>

      {entries.map((e) => (
        <section key={e.id} className="sheet viz-card upload">
          <div className="viz-head">
            <div><h2>{e.kind ? KIND_LABEL[e.kind] : 'Unknown file'}</h2><p className="muted">{e.name}{e.parsed ? `, ${weekLabel(weekOf(e.parsed))}` : ''}</p></div>
            {e.phase === 'ready' && <button type="button" className="btn primary" disabled={blocked(checksOf(e))} onClick={() => importOne(e)}>Import</button>}
            {e.phase === 'done' && <span className="chip paid">Loaded {e.imported?.toLocaleString('en-AU')} rows</span>}
          </div>
          {e.phase === 'reading' && <p className="muted">Reading the file…</p>}
          {e.phase === 'importing' && (
            <div><p className="muted">Saving{e.progress ? ` ${e.progress[0].toLocaleString('en-AU')} of ${e.progress[1].toLocaleString('en-AU')} rows` : '…'}</p>
              <div className="progress" aria-hidden="true"><span style={{ transform: `scaleX(${e.progress ? e.progress[0] / Math.max(1, e.progress[1]) : 0.05})` }} /></div></div>
          )}
          {e.phase === 'error' && <p className="note bad" role="alert">{e.error}</p>}
          {e.preview && e.phase !== 'error' && (
            <p>{e.preview.matched} of {e.preview.total} {e.kind === 'weekly' ? 'trading stores' : 'stores'} matched{e.preview.note ? `, ${e.preview.note}` : ''}.</p>
          )}
          {e.preview && e.preview.unmatched.length > 0 && <p className="note bad">Not matched to a store here, so skipped: {e.preview.unmatched.join(', ')}.</p>}
          {e.phase !== 'error' && e.checks.length > 0 && <Checks checks={checksOf(e)} />}
          {e.warnings.length > 0 && <ul className="warnlist">{e.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </section>
      ))}
      {ready.length > 1 && <div className="actions"><button type="button" className="btn primary" onClick={importAll}>Import all {ready.length}</button></div>}

      <section className="sheet viz-card">
        <div className="viz-head"><div><h2>Recent loads</h2></div></div>
        {log.loading ? <p className="muted">Loading…</p> : !log.data?.length ? <p className="muted viz-empty">Nothing loaded yet.</p> : (
          <div className="tablewrap">
            <table className="viz-table cells">
              <thead><tr><th>Report</th><th>Week</th><th className="r">Rows</th><th>Loaded</th></tr></thead>
              <tbody>{log.data.map((u) => <tr key={u.id}><td className="full" data-label="Report">{KIND_LABEL[u.kind]}</td><td className="s2" data-label="Week">{weekLabel(u)}</td><td className="r s2" data-label="Rows">{u.row_count.toLocaleString('en-AU')}</td><td className="s2" data-label="Loaded">{when(u.uploaded_at)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
      {dialog}
    </div>
  )
}

/** The pre-import checks: every figure against a total the report states for itself. A failed one blocks the import. */
function Checks({ checks }: { checks: Check[] }) {
  const bad = failures(checks)
  const stop = bad.filter((c) => c.blocking)
  return (
    <div className="checks">
      <p className={stop.length ? 'note bad' : 'note'} role={stop.length ? 'alert' : undefined}>
        {stop.length ? `Import blocked: ${stop.length} check${stop.length === 1 ? '' : 's'} failed. Nothing has been saved.` : `${checks.length - bad.length} of ${checks.length} checks passed.`}
        {!stop.length && bad.length > 0 && ` ${bad.length} to read below.`}
      </p>
      {bad.length > 0 && <ul className="warnlist">{bad.map((c) => <li key={c.label}><b>{c.label}.</b> {c.detail}</li>)}</ul>}
      <details className="storedetails"><summary>See every check</summary>
        <ul className="checklist">{checks.map((c) => <li key={c.label} className={c.ok ? 'ok' : 'no'}><span aria-hidden="true">{c.ok ? '✓' : '✕'}</span> {c.label}</li>)}</ul>
      </details>
    </div>
  )
}
