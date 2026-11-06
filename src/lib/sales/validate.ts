// The gate before anything is saved. Every figure that goes in must agree with a total the report states for itself, or with another
// report of the same week. A failed check blocks the import: a wrong number in front of a store is worse than a late one.
import { storeKey, type DailyResult, type DetailedResult, type WeeklyResult } from './parse'

export interface Check { label: string; ok: boolean; detail: string; blocking: boolean }

const TOL = 0.5 // a few cents of rounding in the sheet, never a real difference
const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol
const n2 = (n: number) => n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const blocked = (checks: Check[]) => checks.some((c) => c.blocking && !c.ok)
export const failures = (checks: Check[]) => checks.filter((c) => !c.ok)

export function checkDetailed(r: DetailedResult): Check[] {
  const out: Check[] = []
  for (const s of r.sheets) {
    const t = s.totals
    const who = s.store_name ?? s.tab
    out.push({ label: `${who}: net sales add up`, ok: near(t.header_net, t.sum_net), blocking: true, detail: `The sheet says ${n2(t.header_net)}; its ${t.rows.toLocaleString('en-AU')} item rows add up to ${n2(t.sum_net)}.` })
    out.push({ label: `${who}: units add up`, ok: near(t.header_qty, t.sum_qty), blocking: true, detail: `The sheet says ${t.header_qty}; its item rows add up to ${t.sum_qty}.` })
    out.push({ label: `${who}: nothing dropped`, ok: near(t.kept_net, t.sum_net) && near(t.kept_qty, t.sum_qty), blocking: true, detail: `Kept rows add up to ${n2(t.kept_net)} and ${t.kept_qty} units; all rows ${n2(t.sum_net)} and ${t.sum_qty}.` })
    const seen = new Set<string>(); let dup = 0
    for (const i of s.items) { if (seen.has(i.item_code)) dup++; seen.add(i.item_code) }
    out.push({ label: `${who}: no repeated items`, ok: dup === 0, blocking: true, detail: `${dup} item code${dup === 1 ? ' appears' : 's appear'} more than once.` })
    out.push({ label: `${who}: right week`, ok: !t.sheet_week || t.sheet_week === r.week.week, blocking: true, detail: `The sheet says week ${t.sheet_week}; the file name says week ${r.week.week}.` })
  }
  return out
}

export function checkWeekly(r: WeeklyResult): Check[] {
  const out: Check[] = []
  const cur = r.rows.filter((x) => x.week === r.current.week)
  const ty = cur.reduce((a, x) => a + x.ty_sales, 0)
  const ly = cur.reduce((a, x) => a + x.ly_sales, 0)
  if (r.summary) {
    out.push({ label: `Week ${r.current.week} sales add up to the report's total`, ok: near(ty, r.summary.ty), blocking: true, detail: `Store rows add up to ${n2(ty)}; the report's Group Turnover says ${n2(r.summary.ty)}.` })
    out.push({ label: `Week ${r.current.week} last year adds up to the report's total`, ok: near(ly, r.summary.ly), blocking: true, detail: `Store rows add up to ${n2(ly)}; the report's Group Turnover says ${n2(r.summary.ly)}.` })
  } else out.push({ label: 'Report total found', ok: false, blocking: false, detail: 'The Summary-Wk sheet has no Group Turnover line, so the store rows could not be checked against a total.' })
  const keys = new Set<string>(); let dup = 0
  for (const x of r.rows) { const k = `${x.week}|${x.store_name}|${x.co_fran}`; if (keys.has(k)) dup++; keys.add(k) }
  out.push({ label: 'No repeated store and week', ok: dup === 0, blocking: true, detail: `${dup} store and week rows appear more than once.` })
  const weeks = new Set(r.rows.map((x) => x.week))
  const missing: number[] = []
  for (let w = 1; w <= r.current.week; w++) if (!weeks.has(w)) missing.push(w)
  out.push({ label: `Weeks 1 to ${r.current.week} all present`, ok: missing.length === 0, blocking: false, detail: `Missing: ${missing.join(', ')}.` })
  const neg = r.rows.filter((x) => x.ty_sales < 0 || x.ly_sales < 0).length
  out.push({ label: 'No negative sales', ok: neg === 0, blocking: true, detail: `${neg} rows have negative sales.` })
  return out
}

export function checkDaily(r: DailyResult): Check[] {
  const out: Check[] = []
  for (const t of r.totals) {
    const d = r.days.filter((x) => x.location === t.location)
    const ty = d.reduce((a, x) => a + x.ty, 0)
    const ly = d.reduce((a, x) => a + x.ly, 0)
    out.push({ label: `${t.store_name || t.location}: days add up to the week`, ok: d.length === 7 && near(ty, t.ty_total) && (t.ly_total === 0 || near(ly, t.ly_total)), blocking: true,
      detail: `${d.length} days. This year adds up to ${n2(ty)} (the sheet says ${n2(t.ty_total)}); last year ${n2(ly)} (the sheet says ${n2(t.ly_total)}).` })
  }
  return out
}

/** The daily and weekly reports are different exports of the same sales, so a store's seven days must equal its week. */
export function crossCheck(weekly: WeeklyResult, daily: DailyResult): Check[] {
  if (weekly.current.fy !== daily.week.fy || weekly.current.week !== daily.week.week) return []
  const wk = new Map(weekly.rows.filter((x) => x.week === daily.week.week).map((x) => [storeKey(x.store_name), x]))
  const out: Check[] = []
  for (const t of daily.totals) {
    const w = wk.get(storeKey(t.store_name))
    if (!w) { out.push({ label: `${t.store_name}: in the weekly report`, ok: false, blocking: false, detail: 'This store is in the daily report but not the weekly one.' }); continue }
    out.push({ label: `${t.store_name}: daily matches weekly`, ok: near(w.ty_sales, t.ty_total, 1) && (t.ly_total === 0 || near(w.ly_sales, t.ly_total, 1)), blocking: true,
      detail: `Weekly says ${n2(w.ty_sales)} (last year ${n2(w.ly_sales)}); daily says ${n2(t.ty_total)} (last year ${n2(t.ly_total)}).` })
  }
  return out
}
