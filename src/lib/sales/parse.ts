// Reads the three weekly Power BI exports into plain rows. Nothing is stored here: the caller previews the result and, only when an
// admin confirms, sends the rows to the database. The files themselves are never kept.
import { colOf, excelDate, findRow, num, readWorkbook, text, type Row } from '../xlsx'
import type { ItemSale, StoreDay, StoreWeek, WeekDates, WeekRef } from './model'

import type { Check } from './validate'

/** A format check: the file must look the way finance's export always looks. A failure blocks the import. */
const fmt = (label: string, ok: boolean, detail: string): Check => ({ label, ok, detail, blocking: true })
const absent = (header: Row, names: string[]) => names.filter((n) => colOf(header, n) < 0)

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
/** Totals the sheet states in its own header row, beside what the rows underneath add up to. They must agree. */
export interface SheetTotals { header_net: number; header_qty: number; sum_net: number; sum_qty: number; kept_net: number; kept_qty: number; rows: number; sheet_week: number }
export interface DetailedSheet { tab: string; store_name: string | null; a1: string; items: ParsedItem[]; totals: SheetTotals }
export interface DetailedResult { week: WeekRef; sheets: DetailedSheet[]; warnings: string[]; format: Check[] }

const DETAILED_HEADERS = ['No.', 'Item Description', 'MOQ', 'Item Vendor No.', 'Business Rank', 'Item Division Code', 'Inventory', 'Net Sales', 'QTY Sold', 'Ranking', 'No Stores Stocking', 'Potential Sales', 'Potential Sales Growth', 'Potential Ranking', 'Potential Loss']

const sameStore = (a: string, b: string) => storeKey(a) === storeKey(b) || storeKey(a).startsWith(storeKey(b)) || storeKey(b).startsWith(storeKey(a))

export function parseDetailed(data: Uint8Array, fileName: string): DetailedResult {
  const warnings: string[] = []
  const wb = readWorkbook(data, (n) => n in TAB_STORE)
  const fy = fyOf(fileName)
  if (!fy) throw new Error('The file name has no financial year (like FY2027), so I cannot tell which year this is.')
  let week = weekOfName(fileName) ?? 0
  const sheets: DetailedSheet[] = []
  const format: Check[] = []
  for (const s of wb.sheets) {
    if (s.hidden) continue
    if (!(s.name in TAB_STORE)) { warnings.push(`Sheet ${s.name} is not one of the stores, so it was skipped.`); continue }
    const rows = s.rows
    const a1 = text(rows[0]?.[0])
    const w = Number(text(rows[0]?.[1]).replace(/\D/g, '')) || 0
    if (w) { if (week && week !== w) warnings.push(`Sheet ${s.name} says week ${w} but the first sheet said week ${week}.`); week = week || w }
    const hr = findRow(rows, 0, 'No.', 12)
    if (hr < 0) { format.push(fmt(`${s.name}: item table found`, false, 'No header row starting with "No." in the first rows.')); continue }
    const h = rows[hr]
    const lost = absent(h, DETAILED_HEADERS)
    const labels = (rows[hr - 1] ?? []).map(text)
    const sw = labels.indexOf('STORE WEEKLY'), gw = labels.indexOf('GROUP WEEKLY')
    const nets = h.map(text).filter((x) => x === 'Net Sales').length, qtys = h.map(text).filter((x) => x === 'QTY Sold').length
    format.push(fmt(`${s.name}: expected columns`, lost.length === 0 && nets >= 3 && qtys >= 3, lost.length ? `Missing: ${lost.join(', ')}.` : `Net Sales appears ${nets} times and QTY Sold ${qtys} (3 each expected: store week, store year to date, group week).`))
    const cn = colOf(h, 'Net Sales', 0), cy = colOf(h, 'Net Sales', 1), cg = colOf(h, 'Net Sales', 2), yt = labels.indexOf('STORE YTD')
    format.push(fmt(`${s.name}: store and group blocks in place`, sw >= 0 && yt >= 0 && gw >= 0 && sw <= cn && cn < yt && yt <= cy && cy < gw && gw <= cg, 'The STORE WEEKLY and GROUP WEEKLY labels are not above the columns they should be. The columns may have moved.'))
    const c = {
      desc: colOf(h, 'Item Description'), moq: colOf(h, 'MOQ'), vendor: colOf(h, 'Item Vendor No.'), brank: colOf(h, 'Business Rank'),
      div: colOf(h, 'Item Division Code'), net: colOf(h, 'Net Sales', 0), qty: colOf(h, 'QTY Sold', 0), rank: colOf(h, 'Ranking'),
      gnet: colOf(h, 'Net Sales', 2), gqty: colOf(h, 'QTY Sold', 2), stocking: colOf(h, 'No Stores Stocking'), psales: colOf(h, 'Potential Sales'),
      ploss: colOf(h, 'Potential Loss'),
    }
    const missing = Object.entries(c).filter(([, v]) => v < 0).map(([k]) => k)
    if (missing.length) continue // reported by the column check above
    const name = TAB_STORE[s.name]
    if (a1 && !sameStore(a1, name)) warnings.push(`Sheet ${s.name} says "${a1}" in A1 but is filed under ${name}. I used the tab name.`)
    const items: ParsedItem[] = []
    let sumNet = 0, sumQty = 0, nRows = 0
    for (let r = hr + 1; r < rows.length; r++) {
      const row: Row | undefined = rows[r]
      const code = text(row?.[0])
      if (!row || !code) continue
      const qty = num(row[c.qty]); const rank = num(row[c.rank]); const loss = num(row[c.ploss])
      sumNet += num(row[c.net]); sumQty += qty; nRows++
      if (qty === 0 && rank <= 0 && loss <= 0 && num(row[c.net]) === 0) continue // only items with a sale, a refund, a rank or lost sales: the rest is the whole range
      items.push({
        item_code: code, description: text(row[c.desc]), vendor_no: text(row[c.vendor]) || null, division: text(row[c.div]) || null,
        qty, net_sales: num(row[c.net]), store_rank: Math.max(0, Math.round(rank)), group_qty: num(row[c.gqty]), group_net: num(row[c.gnet]),
        stores_stocking: Math.round(num(row[c.stocking])), business_rank: Math.round(num(row[c.brank])), potential_sales: num(row[c.psales]),
        potential_loss: loss, moq: Math.max(1, num(row[c.moq], 1)),
      })
    }
    const totals: SheetTotals = {
      header_net: num(rows[0]?.[c.net]), header_qty: num(rows[0]?.[c.qty]), sum_net: sumNet, sum_qty: sumQty, rows: nRows, sheet_week: w,
      kept_net: items.reduce((a, i) => a + i.net_sales, 0), kept_qty: items.reduce((a, i) => a + i.qty, 0),
    }
    sheets.push({ tab: s.name, store_name: name, a1, items, totals })
  }
  const have = new Set(sheets.map((s) => s.tab))
  const gone = Object.keys(TAB_STORE).filter((t) => !have.has(t))
  format.push(fmt('All store sheets present', gone.length === 0, `Missing or unreadable: ${gone.join(', ')}.`))
  if (!week) throw new Error('I cannot tell which week this is. Put it in the file name, like "Week10".')
  return { week: { fy, week }, sheets, warnings, format }
}

// ---------- Australian Weekly Sales: the Database sheet has every week, every store ----------

export interface WeeklyResult { weeks: WeekDates[]; rows: StoreWeek[]; current: WeekRef; warnings: string[]; format: Check[]; summary: { ty: number; ly: number; week: number } | null }

const WEEKLY_HEADERS = ['Store', 'RM', 'Co/Fran', 'State', 'Retail SQM', 'Centre Type', 'Week No', 'L4L Adjust', 'TY Sales', 'LY Sales', 'No. of transactions', 'No. of transactions LY', 'Member Sales', 'Member Trans', 'Stock', 'SYS', 'GP Wk', 'GP Wk LY', 'Qty Sold', 'Basket Size']

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
  const wLost = absent(h, WEEKLY_HEADERS)
  const format: Check[] = [
    fmt('Database sheet: expected columns', wLost.length === 0, `Missing: ${wLost.join(', ')}.`),
    fmt('Summary-Wk sheet: expected layout', text(sum?.rows[0]?.[0]) === 'Current Week Report' && text(sum?.rows[0]?.[6]) === 'Week No.' && text(sum?.rows[3]?.[0]) === 'Group Turnover', 'The Summary-Wk sheet no longer has Current Week Report, Week No. and Group Turnover where they were.'),
  ]

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
  // The report's own Group Turnover line for the current week: the Database rows for that week must add up to it.
  const g = sum?.rows[3]
  const summary = g && text(g[0]).toLowerCase() === 'group turnover' ? { ty: num(g[3]), ly: num(g[2]), week: cur } : null
  return { weeks, rows, current: { fy, week: cur }, warnings, summary, format }
}

// ---------- Daily Sales: sales for each weekday, this year and last year ----------

export interface DailyRow { location: string; store_name: string; weekday: number; ty: number; ly: number }
export interface DailyTotal { location: string; store_name: string; ty_total: number; ly_total: number }
export interface DailyResult { week: WeekRef; dates: WeekDates; days: DailyRow[]; warnings: string[]; totals: DailyTotal[]; format: Check[] }

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

  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const format: Check[] = []
  const dayLabels = (value.rows[3] ?? []).map(text)
  const tyDays = [11, 12, 13, 14, 15, 16].map((i) => num(head[i]))
  format.push(fmt('Daily Sales Report_Value: Mon to Sun twice, then Full Week', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].every((d) => dayLabels.filter((x) => x === d).length === 2) && dayLabels.some((x) => x.startsWith('Full Week')), 'The weekday header row is not Mon to Sun for each year with a Full Week column.'))
  format.push(fmt("This year's dates run Tuesday to Sunday in order", tyDays.every((d, i) => (i === 0 ? d > 40000 : d === tyDays[i - 1] + 1)), 'The date serials after the Monday date are not six days in a row.'))
  const grab = (sheet: string) => {
    const s = wb.sheet(sheet)
    const out = new Map<string, { name: string; d: number[]; total: number }>()
    if (!s?.rows.length) return out
    const hr = findRow(s.rows, 1, 'Location', 8)
    if (hr < 0) { format.push(fmt(`${sheet}: header row`, false, 'No row with Location in column B.')); return out }
    const hh = (s.rows[hr] ?? []).map(text)
    format.push(fmt(`${sheet}: columns are Location, Store Name, Monday to Sunday, Total`, hh[1] === 'Location' && hh[2] === 'Store Name' && DAYS.every((d, i) => hh[3 + i] === d) && hh[10] === 'Total', `Found: ${hh.slice(1, 11).join(', ')}.`))
    for (let r = hr + 1; r < s.rows.length; r++) {
      const row = s.rows[r]
      const loc = text(row?.[1])
      if (!row || !loc) continue
      out.set(loc.toUpperCase(), { name: text(row[2]), d: [3, 4, 5, 6, 7, 8, 9].map((i) => num(row[i])), total: num(row[10]) })
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
  const totals: DailyTotal[] = [...ty].map(([location, t]) => ({ location, store_name: t.name, ty_total: t.total, ly_total: ly.get(location)?.total ?? 0 }))
  return { week: { fy, week }, dates: { fy, week, week_start: start, week_end: addDays(start, 6) }, days, warnings, totals, format }
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
