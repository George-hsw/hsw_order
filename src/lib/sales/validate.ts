// The gate before anything is saved. Every figure that goes in must agree with a total the report states for itself, or with another
// report of the same week. A failed check blocks the import: a wrong number in front of a store is worse than a late one.
import { storeKey, TAB_STORE, type DailyResult, type DetailedResult, type WeeklyResult } from './parse'

export interface Check { label: string; ok: boolean; detail: string; blocking: boolean }

const TOL = 0.5 // a few cents of rounding in the sheet, never a real difference
const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol
const n2 = (n: number) => n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const blocked = (checks: Check[]) => checks.some((c) => c.blocking && !c.ok)
export const failures = (checks: Check[]) => checks.filter((c) => !c.ok)

export function checkDetailed(r: DetailedResult): Check[] {
  const out: Check[] = [...r.format]
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
  const out: Check[] = [...r.format]
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
  const out: Check[] = [...r.format]
  for (const t of r.totals) {
    const d = r.days.filter((x) => x.location === t.location)
    const ty = d.reduce((a, x) => a + x.ty, 0)
    const ly = d.reduce((a, x) => a + x.ly, 0)
    out.push({ label: `${t.store_name || t.location}: days add up to the week`, ok: d.length === 7 && near(ty, t.ty_total) && (t.ly_total === 0 || near(ly, t.ly_total)), blocking: true,
      detail: `${d.length} days. This year adds up to ${n2(ty)} (the sheet says ${n2(t.ty_total)}); last year ${n2(ly)} (the sheet says ${n2(t.ly_total)}).` })
  }
  return out
}

/**
 * Proves each Detailed Sales sheet belongs to the store it is filed under. A sheet's header holds the store's total stock at cost, and the
 * weekly report holds the same figure for each store, so the two must agree to the cent. (This is how a sheet whose A1 names the wrong store,
 * like CAMB saying Bundall, is shown to be the right store after all.)
 */
export function crossDetailed(weekly: WeeklyResult, detailed: DetailedResult): Check[] {
  if (weekly.current.fy !== detailed.week.fy) return []
  const wk = new Map(weekly.rows.filter((x) => x.week === detailed.week.week).map((x) => [storeKey(x.store_name), x]))
  if (!wk.size) return []
  const out: Check[] = []
  for (const s of detailed.sheets) {
    const w = s.store_name ? wk.get(storeKey(s.store_name)) : undefined
    if (!w) { out.push({ label: `${s.store_name ?? s.tab}: found in the weekly report`, ok: false, blocking: true, detail: 'No store with this name in the weekly report for the same week.' }); continue }
    out.push({ label: `${s.store_name}: stock matches the weekly report`, ok: near(s.totals.header_stock, w.stock, 1), blocking: true,
      detail: `The sheet's stock at cost is ${n2(s.totals.header_stock)} but the weekly report has ${n2(w.stock)} for ${w.store_name}. The sheet may belong to a different store.` })
    // The items a store sold in a week are part of what it sold in that week, so they cannot add up to more than its weekly sales. Across the real
    // FY27 weeks the item sheets come to 71% to 90% of the weekly sales; a sheet above 102% holds figures from somewhere else.
    if (w.ty_sales > 0) out.push({ label: `${s.store_name}: item sales fit inside the week's sales`, ok: s.totals.sum_net <= w.ty_sales * 1.02, blocking: true,
      detail: `The item sheet adds up to ${n2(s.totals.sum_net)} of net sales but the weekly report says the whole store sold ${n2(w.ty_sales)}. The sheet probably holds another week or another store.` })
  }
  // A store the weekly report shows trading but with no sheet here is shown, never hidden: its items are missing for this week. The other stores
  // are still right, so this does not block (the first weeks of FY27 came without a Cambridge sheet).
  const have = new Set(detailed.sheets.map((s) => storeKey(s.store_name ?? s.tab)))
  for (const [tab, name] of Object.entries(TAB_STORE)) {
    const w = have.has(storeKey(name)) ? undefined : wk.get(storeKey(name))
    if (w && w.co_fran !== 'Closed' && w.co_fran !== 'eShop' && w.ty_sales !== 0) out.push({ label: `${name}: items missing this week`, ok: false, blocking: false, detail: `The weekly report shows ${n2(w.ty_sales)} of sales for ${name} but this file has no ${tab} sheet, so ${name} has no item figures for this week.` })
  }
  return out
}

/** The daily and weekly reports are different exports of the same sales, so a store's seven days must equal its week. */
export function crossCheck(weekly: WeeklyResult, daily: DailyResult): Check[] {
  if (weekly.current.fy !== daily.week.fy || weekly.current.week !== daily.week.week) return []
  const wk = new Map(weekly.rows.filter((x) => x.week === daily.week.week).map((x) => [storeKey(x.store_name), x]))
  const out: Check[] = []
  const inDaily = new Set(daily.totals.map((t) => storeKey(t.store_name)))
  const absent = [...wk.values()].filter((w) => w.co_fran !== 'Closed' && w.co_fran !== 'eShop' && !inDaily.has(storeKey(w.store_name))).map((w) => w.store_name)
  if (absent.length) out.push({ label: 'Every trading store is in the daily report', ok: false, blocking: false, detail: `In the weekly report but not the daily one, so they will have no day-by-day figures: ${absent.join(', ')}.` })
  for (const t of daily.totals) {
    const w = wk.get(storeKey(t.store_name))
    if (!w) { out.push({ label: `${t.store_name}: in the weekly report`, ok: false, blocking: false, detail: 'This store is in the daily report but not the weekly one.' }); continue }
    out.push({ label: `${t.store_name}: daily matches weekly`, ok: near(w.ty_sales, t.ty_total, 1) && (t.ly_total === 0 || near(w.ly_sales, t.ly_total, 1)), blocking: true,
      detail: `Weekly says ${n2(w.ty_sales)} (last year ${n2(w.ly_sales)}); daily says ${n2(t.ty_total)} (last year ${n2(t.ly_total)}).` })
  }
  return out
}
