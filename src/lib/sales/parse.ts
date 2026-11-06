// Reads the three weekly Power BI exports into plain rows. Nothing is stored here: the caller previews the result and, only when an
// admin confirms, sends the rows to the database. The files themselves are never kept.
import { colOf, excelDate, findRow, num, readWorkbook, text, type Row } from '../xlsx'
import type { ItemSale, StoreDay, StoreWeek, WeekDates, WeekRef } from './model'

export type ReportKind = 'detailed' | 'weekly' | 'daily'

/** Detailed Sales sheet tab to the store's name. A tab that is not here (GLEN, APL ITEMS) is reported, never guessed. */
export const TAB_STORE: Record<string, string> = {
  ARTA: 'Artarmon', ASPL: 'Aspley', BROO: 'Brookvale', BUND: 'Bundall', CAMB: 'Cambridge', CHEL: 'Cheltenham', FORT: 'Fortitude Valley',
  FYSH: 'Fyshwick', KOTA: 'Kotara', MACQ: 'Macquarie Park', MARO: 'Maroochydore', MILE: 'Mile End', MOOR: 'Moore Park', MORN: 'Mornington',
  MTGR: 'Mt. Gravatt', NORT: 'Northbridge', NUNA: 'Nunawading', PORT: 'Port Macquarie', RHOD: 'Rhodes', RICH: 'Richmond', ROBI: 'Robina',
  SOUT: 'South Wharf', SUBI: 'Subiaco',
}

/** A store name reduced so "Mt Gravatt", "Mt. Gravatt" and "Mount Gravatt" are the same key. */
export const storeKey = (name: string) => name.toLowerCase().replace(/\bmount\b/g, 'mt').replace(/[^a-z0-9]/g, '')

/** Which report a file is, from its name. */
export function kindOf(fileName: string): ReportKind | null {
  const n = fileName.toLowerCase()
  if (n.includes('detailed sales')) return 'detailed'
  if (n.includes('australian weekly')) return 'weekly'
  if (n.includes('daily sales')) return 'daily'
  return null
}

/** 2027 from "…FY2027-Week 10…" or "…FY27…". */
export function fyOf(fileName: string): number | null {
  const m = fileName.match(/FY\s*(\d{4}|\d{2})(?!\d)/i)
  if (!m) return null
  return m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1])
}
export function weekOfName(fileName: string): number | null {
  const m = fileName.match(/Week\s*(\d{1,2})(?!\d)/i)
  return m ? Number(m[1]) : null
}

/** dd/mm/yyyy text to yyyy-mm-dd, or '' */
function dmy(s: string): string {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/)
  if (!m) return ''
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

const addDays = (iso: string, d: number) => new Date(Date.parse(iso + 'T00:00:00Z') + d * 86_400_000).toISOString().slice(0, 10)

// ---------- Detailed Sales Report: one sheet per store, one row per item ----------

export type ParsedItem = Omit<ItemSale, 'inventory'>
export interface DetailedSheet { tab: string; store_name: string | null; a1: string; items: ParsedItem[] }
export interface DetailedResult { week: WeekRef; sheets: DetailedSheet[]; warnings: string[] }

const sameStore = (a: string, b: string) => storeKey(a) === storeKey(b) || storeKey(a).startsWith(storeKey(b)) || storeKey(b).startsWith(storeKey(a))

export function parseDetailed(data: Uint8Array, fileName: string): DetailedResult {
  const warnings: string[] = []
  const wb = readWorkbook(data, (n) => n in TAB_STORE)
  const fy = fyOf(fileName)
  if (!fy) throw new Error('The file name has no financial year (like FY2027), so I cannot tell which year this is.')
  let week = weekOfName(fileName) ?? 0
  const sheets: DetailedSheet[] = []
  for (const s of wb.sheets) {
    if (s.hidden) continue
    if (!(s.name in TAB_STORE)) { warnings.push(`Sheet ${s.name} is not one of the stores, so it was skipped.`); continue }
    const rows = s.rows
    const a1 = text(rows[0]?.[0])
    const w = Number(text(rows[0]?.[1]).replace(/\D/g, '')) || 0
    if (w) { if (week && week !== w) warnings.push(`Sheet ${s.name} says week ${w} but the first sheet said week ${week}.`); week = week || w }
    const hr = findRow(rows, 0, 'No.', 12)
    if (hr < 0) { warnings.push(`Sheet ${s.name} has no item table, so it was skipped.`); continue }
    const h = rows[hr]
    const c = {
      desc: colOf(h, 'Item Description'), moq: colOf(h, 'MOQ'), vendor: colOf(h, 'Item Vendor No.'), brank: colOf(h, 'Business Rank'),
      div: colOf(h, 'Item Division Code'), net: colOf(h, 'Net Sales', 0), qty: colOf(h, 'QTY Sold', 0), rank: colOf(h, 'Ranking'),
      gnet: colOf(h, 'Net Sales', 2), gqty: colOf(h, 'QTY Sold', 2), stocking: colOf(h, 'No Stores Stocking'), psales: colOf(h, 'Potential Sales'),
      ploss: colOf(h, 'Potential Loss'),
    }
    const missing = Object.entries(c).filter(([, v]) => v < 0).map(([k]) => k)
    if (missing.length) { warnings.push(`Sheet ${s.name} is missing columns (${missing.join(', ')}), so it was skipped.`); continue }
    const name = TAB_STORE[s.name]
    if (a1 && !sameStore(a1, name)) warnings.push(`Sheet ${s.name} says "${a1}" in A1 but is filed under ${name}. I used the tab name.`)
    const items: ParsedItem[] = []
    for (let r = hr + 1; r < rows.length; r++) {
      const row: Row | undefined = rows[r]
      const code = text(row?.[0])
      if (!row || !code) continue
      const qty = num(row[c.qty]); const rank = num(row[c.rank]); const loss = num(row[c.ploss])
      if (qty === 0 && rank <= 0 && loss <= 0) continue // only items that sold, were ranked or lost sales: the rest is the whole range
      items.push({
        item_code: code, description: text(row[c.desc]), vendor_no: text(row[c.vendor]) || null, division: text(row[c.div]) || null,
        qty, net_sales: num(row[c.net]), store_rank: Math.max(0, Math.round(rank)), group_qty: num(row[c.gqty]), group_net: num(row[c.gnet]),
        stores_stocking: Math.round(num(row[c.stocking])), business_rank: Math.round(num(row[c.brank])), potential_sales: num(row[c.psales]),
        potential_loss: loss, moq: Math.max(1, num(row[c.moq], 1)),
      })
    }
    sheets.push({ tab: s.name, store_name: name, a1, items })
  }
  if (!sheets.length) throw new Error('No store sheets were found in that file.')
  if (!week) throw new Error('I cannot tell which week this is. Put it in the file name, like "Week10".')
  return { week: { fy, week }, sheets, warnings }
}

// ---------- Australian Weekly Sales: the Database sheet has every week, every store ----------

export interface WeeklyResult { weeks: WeekDates[]; rows: StoreWeek[]; current: WeekRef; warnings: string[] }

export function parseWeekly(data: Uint8Array, fileName: string): WeeklyResult {
  const warnings: string[] = []
  const wb = readWorkbook(data, (n) => n === 'Database' || n === 'Summary-Wk')
  const db = wb.sheet('Database')
  const sum = wb.sheet('Summary-Wk')
  if (!db?.rows.length) throw new Error('That file has no Database sheet.')
  const fy = fyOf(fileName)
  if (!fy) throw new Error('The file name has no financial year (like FY2027), so I cannot tell which year this is.')
  const hr = findRow(db.rows, 0, 'Store', 8)
  if (hr < 0) throw new Error('The Database sheet has no header row.')
  const h = db.rows[hr]
  const need = ['Store', 'Co/Fran', 'State', 'Week No', 'TY Sales', 'LY Sales']
  const c = (n: string) => colOf(h, n)
  for (const n of need) if (c(n) < 0) throw new Error(`The Database sheet has no "${n}" column.`)

  // The week the report was run for, and the Monday it starts on, from the Summary sheet (its "week beg" is the Sunday before).
  const cur = Number(text(sum?.rows[0]?.[7])) || weekOfName(fileName) || 0
  const begSerial = num(sum?.rows[0]?.[3])
  if (!cur) throw new Error('I cannot tell which week this report is for.')
  let currentStart = ''
  if (begSerial > 40000) currentStart = addDays(excelDate(begSerial), 1)
  else warnings.push('The Summary sheet has no week start date, so weeks are shown without dates until the Daily Sales file is imported.')

  const rows: StoreWeek[] = []
  const seen = new Set<number>()
  for (let r = hr + 1; r < db.rows.length; r++) {
    const row = db.rows[r]
    const store = text(row?.[c('Store')])
    const wk = Math.round(num(row?.[c('Week No')]))
    if (!row || !store || !wk) continue
    seen.add(wk)
    rows.push({
      fy, week: wk, store_id: null, store_name: store, co_fran: text(row[c('Co/Fran')]), state: text(row[c('State')]), region: text(row[c('RM')]),
      centre_type: text(row[c('Centre Type')]), retail_sqm: num(row[c('Retail SQM')]),
      ty_sales: num(row[c('TY Sales')]), ly_sales: num(row[c('LY Sales')]),
      ty_trans: Math.round(num(row[c('No. of transactions')])), ly_trans: Math.round(num(row[c('No. of transactions LY')])),
      member_sales: num(row[c('Member Sales')]), member_trans: Math.round(num(row[c('Member Trans')])),
      stock: num(row[c('Stock')]), sys_sales: num(row[c('SYS')]), gp_ty: num(row[c('GP Wk')]), gp_ly: num(row[c('GP Wk LY')]),
      qty_sold: Math.round(num(row[c('Qty Sold')])), basket: num(row[c('Basket Size')]), l4l_adjust: num(row[c('L4L Adjust')]),
    })
  }
  if (!rows.length) throw new Error('The Database sheet has no rows.')
  const weeks: WeekDates[] = [...seen].sort((a, b) => a - b).map((w) => {
    const start = currentStart ? addDays(currentStart, (w - cur) * 7) : ''
    return { fy, week: w, week_start: start, week_end: start ? addDays(start, 6) : '' }
  })
  return { weeks, rows, current: { fy, week: cur }, warnings }
}

// ---------- Daily Sales: sales for each weekday, this year and last year ----------

export interface DailyRow { location: string; store_name: string; weekday: number; ty: number; ly: number }
export interface DailyResult { week: WeekRef; dates: WeekDates; days: DailyRow[]; warnings: string[] }

export function parseDaily(data: Uint8Array, fileName: string): DailyResult {
  const warnings: string[] = []
  const wb = readWorkbook(data, (n) => n === 'Daily Sales Report_Value' || /^FY\d\d$/.test(n))
  const value = wb.sheet('Daily Sales Report_Value')
  const fy = fyOf(fileName)
  if (!value?.rows.length) throw new Error('That file has no "Daily Sales Report_Value" sheet.')
  if (!fy) throw new Error('The file name has no financial year (like FY2027), so I cannot tell which year this is.')
  const head = value.rows[2] ?? []
  const label = head.map(text).find((t) => /^\d{4}-\d{2} Week \d+$/.test(t)) ?? ''
  const week = Number((label.match(/Week (\d+)/) ?? [])[1]) || weekOfName(fileName) || 0
  if (!week) throw new Error('I cannot tell which week this is.')
  // This year's block: seven numeric Tue to Sun serials after the Monday text date.
  const monIdx = head.reduce<number>((last, c, i) => (typeof c === 'string' && dmy(c) !== '' ? i : last), -1) // the later of the two Monday dates is this year's
  let start = monIdx >= 0 ? dmy(String(head[monIdx])) : ''
  const sunSerial = monIdx >= 0 ? num(head[monIdx + 6]) : 0
  if (!start && sunSerial > 40000) start = addDays(excelDate(sunSerial), -6)
  if (!start) throw new Error('I cannot find this year\'s dates in the Daily Sales Report_Value sheet.')

  const grab = (sheet: string) => {
    const s = wb.sheet(sheet)
    const out = new Map<string, { name: string; d: number[] }>()
    if (!s?.rows.length) return out
    const hr = findRow(s.rows, 1, 'Location', 8)
    if (hr < 0) return out
    for (let r = hr + 1; r < s.rows.length; r++) {
      const row = s.rows[r]
      const loc = text(row?.[1])
      if (!row || !loc) continue
      out.set(loc.toUpperCase(), { name: text(row[2]), d: [3, 4, 5, 6, 7, 8, 9].map((i) => num(row[i])) })
    }
    return out
  }
  const ty = grab(`FY${String(fy).slice(-2)}`)
  const ly = grab(`FY${String(fy - 1).slice(-2)}`)
  if (!ty.size) throw new Error(`That file has no FY${String(fy).slice(-2)} sheet with store rows.`)
  const days: DailyRow[] = []
  for (const [loc, t] of ty) {
    const l = ly.get(loc)
    if (!l) warnings.push(`${t.name || loc} has no last-year days.`)
    t.d.forEach((v, i) => days.push({ location: loc, store_name: t.name, weekday: i + 1, ty: v, ly: l?.d[i] ?? 0 }))
  }
  return { week: { fy, week }, dates: { fy, week, week_start: start, week_end: addDays(start, 6) }, days, warnings }
}

/** What an import of the daily report writes, once locations are matched to stores. */
export const toStoreDays = (week: WeekRef, days: DailyRow[], idOf: (location: string, storeName: string) => string | undefined): { rows: StoreDay[]; unmatched: string[] } => {
  const rows: StoreDay[] = []
  const unmatched = new Set<string>()
  for (const d of days) {
    const id = idOf(d.location, d.store_name)
    if (!id) { unmatched.add(d.store_name || d.location); continue }
    rows.push({ fy: week.fy, week: week.week, store_id: id, weekday: d.weekday, ty: d.ty, ly: d.ly })
  }
  return { rows, unmatched: [...unmatched] }
}
