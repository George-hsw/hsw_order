// Loads a whole folder of past weeks, one week at a time, with the same checks as the single-file upload. A week that fails a blocking
// check is skipped and says why; the rest still load. After saving, what is in the database is read back and compared with the totals
// of the files themselves, to the cent. Nothing is estimated or filled in: every figure shown is added up from a file or from the database.
// With dryRun nothing is saved: it reads and checks everything and reports.
import type { StoreRow } from '../supabase'
import { salesApi, type SavedSource, type SavedTotals } from './api'
import type { FolderPlan, Named } from './folder'
import { dailyRows, dedupeItems, detailedRows, indexStores } from './import'
import { parseDaily, parseDetailed, parseWeekly, storeKey, weekOfName, type WeeklyResult } from './parse'
import { blocked, checkDaily, checkDetailed, checkWeekly, crossCheck, crossDetailed, failures, type Check } from './validate'

export type Status = 'waiting' | 'working' | 'ok' | 'loaded' | 'blocked' | 'error' | 'none' | 'covered'
/** Rows and two totals. weekly: this year's and last year's sales; items: net sales and units; days: this year's and last year's sales. */
export interface Totals { rows: number; a: number; b: number }
export interface Step { status: Status; file?: string; source?: Totals; saved?: Totals; verified?: boolean; why?: string[]; notes?: string[] }
export interface WeekState { fy: number; week: number; weekly: Step; daily: Step; detailed: Step }
export interface BulkFile extends Named { arrayBuffer(): Promise<ArrayBuffer> }

export const KIND_SOURCE = { weekly: 'weekly', daily: 'days', detailed: 'items' } as const satisfies Record<string, SavedSource>
const cents = (n: number) => Math.round(n * 100)
/** The saved figures equal the file's: the same number of rows and the same totals to the cent. */
export const sameTotals = (a: Totals, b: Totals) => a.rows === b.rows && cents(a.a) === cents(b.a) && cents(a.b) === cents(b.b)

const sum = <T,>(rows: T[], f: (x: T) => number): number => rows.reduce((t, x) => t + f(x), 0)
const why = (checks: Check[]) => failures(checks).filter((c) => c.blocking).slice(0, 5).map((c) => `${c.label}: ${c.detail}`)
const notes = (checks: Check[]) => failures(checks).filter((c) => !c.blocking).slice(0, 5).map((c) => `${c.label}: ${c.detail}`)
/** The error's own words; a blank message is never shown as a blank. */
const exact = (e: unknown, fallback: string) => (e instanceof Error && e.message.trim() ? e.message : fallback + ' It stopped without giving a reason.')
const bytes = async (f: BulkFile) => new Uint8Array(await f.arrayBuffer())

export function initialState(plan: FolderPlan<BulkFile>): WeekState[] {
  const latest = new Set([...plan.latestWeekly.values()].map((f) => f.name))
  const step = (f: BulkFile | undefined, covered = false): Step => (f ? { status: 'waiting', file: f.name } : { status: covered ? 'covered' : 'none' })
  return plan.weeks.map((w) => ({
    fy: w.fy, week: w.week,
    // A weekly report that is not the newest of its year is not saved by itself: the newest one holds the same weeks.
    weekly: w.files.weekly && !latest.has(w.files.weekly.name) ? { status: 'covered' as Status, file: w.files.weekly.name } : step(w.files.weekly, w.covered),
    daily: step(w.files.daily),
    detailed: step(w.files.detailed),
  }))
}

export async function importFolder(plan: FolderPlan<BulkFile>, ctx: { stores: StoreRow[]; email: string; dryRun: boolean }, onChange: (s: WeekState[]) => void, stop: () => boolean): Promise<WeekState[]> {
  const ix = indexStores(ctx.stores)
  const state = initialState(plan)
  const put = (fy: number, week: number, kind: 'weekly' | 'daily' | 'detailed', step: Partial<Step>) => {
    const i = state.findIndex((s) => s.fy === fy && s.week === week)
    if (i < 0) return
    state[i] = { ...state[i], [kind]: { ...state[i][kind], ...step } }
    onChange([...state])
  }
  const parsedWeekly = new Map<string, WeeklyResult>() // weekly reports are small; each is read once
  const weeklyOf = async (f: BulkFile) => { const have = parsedWeekly.get(f.name); if (have) return have; const d = parseWeekly(await bytes(f), f.name); parsedWeekly.set(f.name, d); return d }
  const ok = ctx.dryRun ? 'ok' : 'loaded'

  // 1. The newest weekly report of each year holds every week up to it, so it is the one that is saved.
  for (const [fy, f] of plan.latestWeekly) {
    if (stop()) break
    const top = weekOfName(f.name)!
    put(fy, top, 'weekly', { status: 'working' })
    try {
      const d = await weeklyOf(f)
      const checks = checkWeekly(d)
      if (blocked(checks)) { put(fy, top, 'weekly', { status: 'blocked', why: why(checks) }); continue }
      const unmatched = [...new Set(d.rows.filter((x) => x.co_fran !== 'Closed' && x.co_fran !== 'eShop' && !ix.byName.has(storeKey(x.store_name))).map((x) => x.store_name))]
      if (!ctx.dryRun) await salesApi.importWeekly(d, ctx.stores, ctx.email)
      for (const wk of [...new Set(d.rows.map((x) => x.week))]) {
        const rows = d.rows.filter((x) => x.week === wk)
        put(fy, wk, 'weekly', {
          status: ok, file: f.name, source: { rows: rows.length, a: sum(rows, (x) => x.ty_sales), b: sum(rows, (x) => x.ly_sales) },
          notes: wk === top ? [`This file holds weeks 1 to ${top} of FY${String(fy).slice(-2)}; all of them are ${ctx.dryRun ? 'checked' : 'saved'}.`, ...notes(checks), ...(unmatched.length ? [`Stores in the report that this app does not have, so no store sees them: ${unmatched.join(', ')}.`] : [])] : undefined,
        })
      }
    } catch (e) { put(fy, top, 'weekly', { status: 'error', why: [exact(e, 'Could not save.')] }) }
  }

  // 2. Each week's daily and item reports, oldest first, compared with the weekly report of the same week (or the next one that holds it).
  for (const w of plan.weeks) {
    if (stop()) break
    const own = w.files.weekly ? await weeklyOf(w.files.weekly).catch(() => undefined) : undefined
    const later = [...plan.weeks].filter((x) => x.fy === w.fy && x.week > w.week && x.files.weekly).sort((a, b) => a.week - b.week)[0]
    const ref = own ?? (later?.files.weekly ? await weeklyOf(later.files.weekly).catch(() => undefined) : undefined)

    if (w.files.daily) {
      put(w.fy, w.week, 'daily', { status: 'working' })
      try {
        const d = parseDaily(await bytes(w.files.daily), w.files.daily.name)
        const checks = [...checkDaily(d), ...(ref && ref.current.week === w.week ? crossCheck(ref, d) : [])]
        if (blocked(checks)) put(w.fy, w.week, 'daily', { status: 'blocked', why: why(checks) })
        else {
          const r = dailyRows(d, ix)
          if (!ctx.dryRun) await salesApi.importDaily(d, ctx.stores, ctx.email)
          put(w.fy, w.week, 'daily', { status: ok, source: { rows: r.rows.length, a: sum(r.rows, (x) => x.ty), b: sum(r.rows, (x) => x.ly) }, notes: [...notes(checks), ...(r.preview.unmatched.length ? [`Not in this app, so left out: ${r.preview.unmatched.join(', ')}.`] : [])] })
        }
      } catch (e) { put(w.fy, w.week, 'daily', { status: 'error', why: [exact(e, 'Could not read the file.')] }) }
    }

    if (stop()) break
    if (w.files.detailed) {
      put(w.fy, w.week, 'detailed', { status: 'working' })
      try {
        const d = parseDetailed(await bytes(w.files.detailed), w.files.detailed.name)
        const checks = [...checkDetailed(d), ...(ref ? crossDetailed(ref, d) : [])]
        if (blocked(checks)) put(w.fy, w.week, 'detailed', { status: 'blocked', why: why(checks) })
        else {
          const r = detailedRows(d, ix)
          const kept = dedupeItems(r.rows)
          const saved = ctx.dryRun ? undefined : await salesApi.importDetailed(d, ctx.stores, ctx.email, (n, total) => put(w.fy, w.week, 'detailed', { status: 'working', notes: [`Saving ${n.toLocaleString('en-AU')} of ${total.toLocaleString('en-AU')} rows`] }))
          put(w.fy, w.week, 'detailed', { status: ok, source: { rows: kept.length, a: sum(kept, (x) => x.net_sales), b: sum(kept, (x) => x.qty) }, notes: [...notes(checks), ...(saved?.note ? [saved.note] : []), ...(r.preview.unmatched.length ? [`Not in this app, so left out: ${r.preview.unmatched.join(', ')}.`] : [])] })
        }
      } catch (e) { put(w.fy, w.week, 'detailed', { status: 'error', why: [exact(e, 'Could not read the file.')] }) }
    }
  }

  // 3. Read back what is saved and compare it with each file's own totals. Any difference is shown, never smoothed over.
  if (!ctx.dryRun && !stop()) {
    const saved = new Map<string, SavedTotals[]>()
    for (const fy of new Set(state.map((s) => s.fy))) {
      try { saved.set(String(fy), await salesApi.yearTotals(fy)) } catch (e) { saved.set(String(fy), []); for (const s of state.filter((x) => x.fy === fy)) put(fy, s.week, 'weekly', { notes: [`Could not read the saved figures back: ${e instanceof Error ? e.message : 'unknown error'}.`] }) }
    }
    for (const s of [...state]) {
      for (const kind of ['weekly', 'daily', 'detailed'] as const) {
        const step = s[kind]
        if (step.status !== 'loaded' || !step.source) continue
        const got = saved.get(String(s.fy))?.find((x) => x.week === s.week && x.source === KIND_SOURCE[kind])
        const savedT: Totals = got ? { rows: got.rows, a: got.a, b: got.b } : { rows: 0, a: 0, b: 0 }
        const same = sameTotals(step.source, savedT)
        put(s.fy, s.week, kind, { saved: savedT, verified: same, ...(same ? {} : { status: 'error' as Status, why: ['What is saved does not match the file. Do not rely on this week until it is loaded again.'] }) })
      }
    }
  }
  return state
}

/** The whole check as a spreadsheet-ready list: one line per report, what the file holds and what is saved, so it can be kept as a record. */
export function resultsCsv(state: WeekState[]): string {
  const q = (v: string | number | boolean | undefined) => { const s = v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const head = ['Year', 'Week', 'Report', 'File', 'Result', 'File rows', 'File total A', 'File total B', 'Saved rows', 'Saved total A', 'Saved total B', 'Matches', 'Why or notes']
  const label = { weekly: 'Weekly (a = this year, b = last year)', daily: 'Daily (a = this year, b = last year)', detailed: 'Items (a = net sales, b = units)' }
  const lines = [head.map(q).join(',')]
  for (const w of state) for (const k of ['weekly', 'daily', 'detailed'] as const) {
    const s = w[k]
    if (s.status === 'none') continue
    lines.push([`FY${w.fy}`, w.week, label[k], s.file, s.status, s.source?.rows, s.source?.a.toFixed(2), s.source?.b.toFixed(2), s.saved?.rows, s.saved?.a.toFixed(2), s.saved?.b.toFixed(2), s.verified === undefined ? '' : s.verified ? 'yes' : 'NO', [...(s.why ?? []), ...(s.notes ?? [])].join(' | ')].map(q).join(','))
  }
  return lines.join('\n')
}
