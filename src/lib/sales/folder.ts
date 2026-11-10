// Plans a folder of past weekly reports: which file is which, which weeks are covered, and which are missing. Pure, so it is unit-tested.
import { fyOf, kindOf, weekOfName, type ReportKind } from './parse'

export interface Named { name: string; lastModified: number }
export interface PlannedWeek<T extends Named> {
  fy: number
  week: number
  files: Partial<Record<ReportKind, T>>
  covered: boolean // no file of its own, but the newest weekly report of that year holds this week
  ignored: string[] // a second copy of a file for the same week (the older one is left out)
}
export interface FolderPlan<T extends Named> {
  weeks: PlannedWeek<T>[]
  /** The weekly report with the highest week of each year. It holds every week up to there, so it is the one that is imported. */
  latestWeekly: Map<number, T>
  /** Files whose name does not say what they are. The screen asks the file itself: a Power BI item export is recognised by its content. */
  unknown: { name: string; why: string; file: T }[]
}

export function planFolder<T extends Named>(files: T[]): FolderPlan<T> {
  const by = new Map<string, PlannedWeek<T>>()
  const unknown: { name: string; why: string; file: T }[] = []
  for (const f of files) {
    if (!/\.xlsx$/i.test(f.name) || f.name.startsWith('~$')) continue
    const kind = kindOf(f.name), fy = fyOf(f.name), week = weekOfName(f.name)
    if (!kind) { unknown.push({ name: f.name, why: 'The name does not say Detailed Sales, Australian Weekly or Daily Sales.', file: f }); continue }
    if (!fy || !week) { unknown.push({ name: f.name, why: 'The name needs the year and week, like FY2027 and Week 10.', file: f }); continue }
    const key = `${fy}|${week}`
    const w = by.get(key) ?? { fy, week, files: {}, covered: false, ignored: [] }
    const had = w.files[kind]
    if (!had) w.files[kind] = f
    else if (f.lastModified > had.lastModified) { w.ignored.push(had.name); w.files[kind] = f } // two copies: the newer file wins
    else w.ignored.push(f.name)
    by.set(key, w)
  }
  const latestWeekly = new Map<number, T>()
  for (const w of by.values()) {
    const f = w.files.weekly
    if (!f) continue
    const have = latestWeekly.get(w.fy)
    if (!have || weekOfName(have.name)! < w.week) latestWeekly.set(w.fy, f)
  }
  // Weeks with no file of their own but inside the newest weekly report of their year are still listed, so a gap is visible.
  for (const [fy, f] of latestWeekly) {
    const top = weekOfName(f.name)!
    for (let wk = 1; wk <= top; wk++) if (!by.has(`${fy}|${wk}`)) by.set(`${fy}|${wk}`, { fy, week: wk, files: {}, covered: true, ignored: [] })
  }
  const weeks = [...by.values()].sort((a, b) => a.fy - b.fy || a.week - b.week)
  return { weeks, latestWeekly, unknown }
}
