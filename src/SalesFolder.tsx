import { useMemo, useRef, useState } from 'react'
import { useConfirm } from './Confirm'
import { useToast } from './Toast'
import { track } from './lib/analytics/track'
import { importFolder, initialState, resultsCsv, type BulkFile, type Step, type Totals, type WeekState } from './lib/sales/bulk'
import { parseReference, type ReferenceExport } from './lib/sales/reference'
import { planFolder } from './lib/sales/folder'
import type { StoreRow } from './lib/supabase'

const money = (n: number) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })
const int = (n: number) => n.toLocaleString('en-AU')
type Kind = 'weekly' | 'daily' | 'detailed'
const KIND: Record<Kind, { title: string; rows: string; a: (n: number) => string; aLabel: string; b: (n: number) => string; bLabel: string }> = {
  weekly: { title: 'Weekly sales', rows: 'store rows', aLabel: 'this year', a: money, bLabel: 'last year', b: money },
  daily: { title: 'Daily sales', rows: 'day rows', aLabel: 'this year', a: money, bLabel: 'last year', b: money },
  detailed: { title: 'Item sales', rows: 'item rows', aLabel: 'net sales', a: money, bLabel: 'units', b: int },
}
const CHIP: Record<Step['status'], { text: string; cls: string }> = {
  waiting: { text: 'Waiting', cls: '' }, working: { text: 'Working', cls: 'part_paid' }, ok: { text: 'Checked, nothing saved', cls: 'quote' }, loaded: { text: 'Saved', cls: 'paid' },
  blocked: { text: 'Not loaded', cls: 'bad' }, error: { text: 'Problem', cls: 'bad' }, none: { text: 'No file', cls: '' }, covered: { text: 'In the newest weekly file', cls: '' },
}
const figures = (t: Totals, k: Kind) => `${int(t.rows)} ${KIND[k].rows}, ${KIND[k].aLabel} ${KIND[k].a(t.a)}, ${KIND[k].bLabel} ${KIND[k].b(t.b)}`

/**
 * Admin only. Choose a folder of past reports; it lists exactly what is in it, checks every file without saving anything, then loads the
 * weeks that pass, one at a time, and reads the saved figures back to compare them with the files. Nothing is estimated: each number on
 * this screen is added up from a file or from the database.
 */
export default function SalesFolder({ email, stores, onLoaded }: { email: string; stores: StoreRow[]; onLoaded: () => void }) {
  const toast = useToast()
  const [ask, dialog] = useConfirm()
  const input = useRef<HTMLInputElement>(null)
  const stopped = useRef(false)
  const [files, setFiles] = useState<BulkFile[]>([])
  const [weeks, setWeeks] = useState<WeekState[]>([])
  const [phase, setPhase] = useState<'idle' | 'checking' | 'checked' | 'importing' | 'done'>('idle')
  const [refs, setRefs] = useState<{ name: string; ref: ReferenceExport }[]>([]) // Power BI item exports found among the files
  const plan = useMemo(() => planFolder(files), [files])
  const unrecognised = plan.unknown.filter((u) => !refs.some((r) => r.name === u.name))

  const choose = (list: FileList | null) => {
    const f = [...(list ?? [])] as BulkFile[]
    setFiles(f); setPhase('idle'); setRefs([])
    setWeeks(f.length ? initialState(planFolder(f)) : [])
    // A file the name cannot place may still be a Power BI item export, which says so inside.
    void (async () => {
      const found: { name: string; ref: ReferenceExport }[] = []
      for (const u of planFolder(f).unknown) { const ref = parseReference(new Uint8Array(await u.file.arrayBuffer())); if (ref) found.push({ name: u.name, ref }) }
      setRefs(found)
    })()
  }
  const run = async (dryRun: boolean) => {
    stopped.current = false
    setPhase(dryRun ? 'checking' : 'importing')
    try {
      const out = await importFolder(plan, { stores, email, dryRun, references: refs.map((r) => r.ref) }, setWeeks, () => stopped.current)
      setPhase(dryRun ? 'checked' : 'done')
      if (!dryRun) {
        const loaded = out.flatMap((w) => [w.weekly, w.daily, w.detailed]).filter((s) => s.status === 'loaded').length
        track('upload', { report: 'folder', reports: loaded })
        if (loaded) { toast.success(`Saved ${loaded} reports and checked them against the files.`); onLoaded() }
      }
    } catch (e) { setPhase('idle'); toast.error(e instanceof Error ? e.message : 'Could not finish.') }
  }
  const importAll = async () => {
    const n = weeks.filter((w) => w.detailed.status === 'ok').length
    if (!(await ask({ title: 'Save these reports?', body: <p>The weekly figures for every week in the newest weekly file are replaced by it, and the item rows for the {n} week{n === 1 ? '' : 's'} with an item report are replaced by their files. Other weeks are not touched. Each week is read back afterwards and compared with its file.</p>, confirmLabel: 'Save and verify' }))) return
    await run(false)
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([resultsCsv(weeks)], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'folder-import-check.csv'; a.click(); URL.revokeObjectURL(url)
  }

  const cells = weeks.flatMap((w) => (['weekly', 'daily', 'detailed'] as Kind[]).map((k) => ({ w, k, s: w[k] })))
  const saved = cells.filter((c) => c.s.status === 'loaded')
  const verifiedAll = saved.length > 0 && saved.every((c) => c.s.verified)
  const wrong = cells.filter((c) => c.s.status === 'error' || (c.s.status === 'loaded' && c.s.verified === false))
  const notLoaded = cells.filter((c) => c.s.status === 'blocked')
  const checkedOk = cells.filter((c) => c.s.status === 'ok')
  const first = plan.weeks[0], last = plan.weeks[plan.weeks.length - 1]
  const gaps = plan.weeks.filter((w) => w.covered)

  return (
    <section className="sheet viz-card folder">
      <div className="viz-head"><div><h2>Load a folder of past weeks</h2>
        <p className="muted">Choose the folder. First it lists what is in it and checks every file without saving anything. Then you save, and the saved figures are read back and compared with each file.</p></div>
        <div className="actions">
          <button type="button" className="btn primary" disabled={phase === 'checking' || phase === 'importing'} onClick={() => input.current?.click()}>Choose folder</button>
          <input ref={input} type="file" accept=".xlsx" multiple hidden aria-label="Choose the folder of reports" onChange={(e) => { choose(e.target.files); e.target.value = '' }} {...({ webkitdirectory: '' } as Record<string, string>)} />
        </div>
      </div>

      {files.length > 0 && (
        <>
          <h3 className="pricesub">What is in the folder</h3>
          <p>{int(files.length)} file{files.length === 1 ? '' : 's'}{first ? `, covering FY${String(first.fy).slice(-2)} week ${first.week} to FY${String(last.fy).slice(-2)} week ${last.week}` : ''}. {int(plan.weeks.filter((w) => w.files.weekly).length)} weekly, {int(plan.weeks.filter((w) => w.files.daily).length)} daily and {int(plan.weeks.filter((w) => w.files.detailed).length)} item reports.</p>
          {gaps.length > 0 && <p className="note">No files of their own for week{gaps.length === 1 ? '' : 's'} {gaps.map((g) => g.week).join(', ')}. Their weekly figures are inside the newest weekly report, so they are still loaded; they have no item report.</p>}
          {refs.length > 0 && <p className="note">Power BI item exports used only as a check, never saved: {refs.map((r) => `${r.name} (FY${String(r.ref.fy).slice(-2)} week ${r.ref.week}, ${r.ref.stores.size} stores)`).join('; ')}. They prove which stores' item sheets are right for that week.</p>}
          {unrecognised.length > 0 && <p className="note bad">Not recognised, so left out: {unrecognised.map((u) => `${u.name} (${u.why})`).join('; ')}</p>}
          {plan.weeks.some((w) => w.ignored.length) && <p className="note">Two copies of the same report: the newer one is used and the other is left out: {plan.weeks.flatMap((w) => w.ignored).join(', ')}.</p>}

          <div className="actions">
            <button type="button" className="btn" disabled={phase === 'checking' || phase === 'importing'} onClick={() => void run(true)}>{phase === 'checking' ? 'Checking…' : 'Check the files'}</button>
            <button type="button" className="btn primary" disabled={phase !== 'checked' || checkedOk.length === 0} onClick={() => void importAll()}>Save and verify</button>
            {(phase === 'checking' || phase === 'importing') && <button type="button" className="btn" onClick={() => { stopped.current = true }}>Stop after this report</button>}
            {(phase === 'checked' || phase === 'done') && <button type="button" className="btn" onClick={download}>Download the list (CSV)</button>}
          </div>
          {phase === 'idle' && <p className="muted viz-foot">Press Check the files first. Nothing is saved by checking.</p>}

          {phase === 'checked' && (
            <p className={notLoaded.length || wrong.length ? 'note bad' : 'note'} role="status">
              {checkedOk.length} report{checkedOk.length === 1 ? '' : 's'} passed every check{notLoaded.length ? `. ${notLoaded.length} did not pass and will be left out; the reason is under each one` : ''}. Nothing has been saved yet.
            </p>
          )}
          {phase === 'done' && (
            <div role="status">
              {verifiedAll && wrong.length === 0
                ? <p className="note"><b>Verified.</b> All {saved.length} saved reports match their files exactly: the same rows and the same totals, to the cent.</p>
                : <p className="note bad"><b>Check this.</b> {wrong.length} report{wrong.length === 1 ? ' does' : 's do'} not match its file or could not be saved. They are marked below.</p>}
              {notLoaded.length > 0 && <p className="note">{notLoaded.length} report{notLoaded.length === 1 ? ' was' : 's were'} not loaded because a check failed. The reason is under each one. A week where only some stores fail can have its passing stores loaded from “Load this week’s reports” below, with that week’s Power BI item export.</p>}
            </div>
          )}

          <ul className="fweeks">
            {weeks.map((w) => (
              <li key={`${w.fy}-${w.week}`}>
                <h4>FY{String(w.fy).slice(-2)} week {w.week}</h4>
                {(['weekly', 'daily', 'detailed'] as Kind[]).map((k) => {
                  const s = w[k]
                  if (s.status === 'none') return null
                  const c = CHIP[s.status]
                  return (
                    <div key={k} className="fcell">
                      <div className="fhead"><b>{KIND[k].title}</b><span className={`chip ${c.cls}`}>{c.text}</span>{s.verified === true && <span className="chip paid">Matches the file exactly</span>}{s.verified === false && <span className="chip bad">Does not match the file</span>}</div>
                      {s.file && <small className="muted">{s.file}</small>}
                      {s.source && <dl className="tlist">
                        <div><dt>In the file</dt><dd>{figures(s.source, k)}</dd></div>
                        {s.saved && <div><dt>Saved</dt><dd>{figures(s.saved, k)}</dd></div>}
                      </dl>}
                      {s.why?.map((x, i) => <p key={i} className="note bad">{x}</p>)}
                      {s.notes?.map((x, i) => <small key={i} className="muted fnote">{x}</small>)}
                    </div>
                  )
                })}
              </li>
            ))}
          </ul>
        </>
      )}
      {dialog}
    </section>
  )
}
