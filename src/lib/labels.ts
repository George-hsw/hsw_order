import { jsPDF } from 'jspdf'

/**
 * Price labels printed on A4 sheets, in the sizes of the two Excel templates
 * (HSWC_Master_label.xlsx and Howards_Clearance_Labels.xlsx). Prices are RRP including GST.
 */
export type TemplateId = 'shelf' | 'hook' | 'clearance' | 'strip'

export interface Template {
  id: TemplateId
  name: string
  hint: string
  w: number // mm
  h: number
  cols: number
  rows: number
  clearance: boolean // shows a discount, so each label needs a Discount %
}

export const TEMPLATES: Template[] = [
  { id: 'shelf', name: 'Shelf strip', hint: '58 × 25 mm', w: 58, h: 25, cols: 3, rows: 11, clearance: false },
  { id: 'hook', name: 'Hook', hint: '45 × 30 mm', w: 45, h: 30, cols: 4, rows: 9, clearance: false },
  { id: 'clearance', name: 'Clearance', hint: '52 × 74 mm', w: 52, h: 74, cols: 3, rows: 3, clearance: true },
  { id: 'strip', name: 'Clearance strip', hint: '70 × 28 mm', w: 70, h: 28, cols: 2, rows: 9, clearance: true },
]
export const templateOf = (id: TemplateId): Template => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]
export const perSheet = (t: Template) => t.cols * t.rows

/** One line in the print queue: an item and how many labels of it. */
export interface QueueItem {
  code: string
  description: string
  price: number | null // RRP including GST (the "was" price on a clearance label)
  barcode?: string
  qty: number
  discount: string // raw input, 0-100, clearance labels only
}

export const MAX_QTY = 99

/** The discount as a number between 0 and 100, or null when it is blank or not a number. */
export function discountOf(raw: string): number | null {
  const t = raw.trim().replace('%', '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null
}

/** The clearance price: was × (1 − discount), to the cent. */
export const nowPrice = (was: number, discountPct: number) => Math.round(was * (1 - discountPct / 100) * 100) / 100

/** What stops an item from being printed on this template (empty when it is fine). */
export function problemOf(i: QueueItem, t: Template): string {
  if (i.price === null || i.price <= 0) return 'No price'
  if (t.clearance && discountOf(i.discount) === null) return 'Add a discount %'
  return ''
}

export const labelCount = (queue: QueueItem[]) => queue.reduce((n, i) => n + i.qty, 0)

export interface SheetState {
  total: number // labels in the queue
  perSheet: number
  sheets: number // sheets needed, counting a part-filled one
  onLast: number // labels on the last sheet (perSheet when it is full)
  spaceLeft: number // empty spaces on the last sheet
  fullSheets: number
}

/** How the queue fills the sheets. startAt (1-based) leaves the first spaces on the first sheet empty, for a sheet already part used. */
export function sheetState(total: number, per: number, startAt = 1): SheetState {
  const skip = Math.min(Math.max(startAt, 1), per) - 1
  const used = total + skip
  const sheets = used === 0 ? 0 : Math.ceil(used / per)
  const onLast = used === 0 ? 0 : used - (sheets - 1) * per
  return { total, perSheet: per, sheets, onLast, spaceLeft: sheets === 0 ? 0 : per - onLast, fullSheets: Math.floor(used / per) }
}

/** The queue as one label per copy, in order. */
export const expand = (queue: QueueItem[]): QueueItem[] => queue.flatMap((i) => Array.from({ length: i.qty }, () => i))

/** The labels that fill whole sheets only, leaving the rest in the queue. */
export function splitFull(queue: QueueItem[], per: number, startAt = 1): { print: QueueItem[]; keep: QueueItem[] } {
  const all = expand(queue)
  const room = Math.floor((all.length + Math.min(Math.max(startAt, 1), per) - 1) / per) * per - (Math.min(Math.max(startAt, 1), per) - 1)
  return { print: all.slice(0, Math.max(0, room)), keep: all.slice(Math.max(0, room)) }
}

/** Turns one-per-copy labels back into queue lines. */
export function regroup(labels: QueueItem[]): QueueItem[] {
  const out: QueueItem[] = []
  for (const l of labels) {
    const last = out[out.length - 1]
    if (last && last.code === l.code && last.discount === l.discount) last.qty++
    else out.push({ ...l, qty: 1 })
  }
  return out
}

// The label colours are those of the printed templates (they are not screen colours).
type RGB = [number, number, number]
const TEAL: RGB = [23, 106, 114]
const CHARCOAL: RGB = [60, 60, 59]
const YELLOW: RGB = [255, 209, 0]
const INK: RGB = [0, 0, 0]
const WHITE: RGB = [255, 255, 255]
const GREY: RGB = [150, 150, 150]
const aud = (n: number) => `$${n.toFixed(2).replace(/\.00$/, '')}`
const PAD = 1.8

export interface PrintOptions {
  startAt: number // 1-based position of the first label on the first sheet
  barcode: boolean // print the barcode number as small text (shelf and hook)
  teal: boolean // a teal band instead of white (shelf and hook)
}

export function buildLabelsPdf(labels: QueueItem[], t: Template, o: PrintOptions): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const per = perSheet(t)
  const left = (210 - t.cols * t.w) / 2
  const top = (297 - t.rows * t.h) / 2
  const skip = Math.min(Math.max(o.startAt, 1), per) - 1
  const slots = skip + labels.length
  const pages = Math.max(1, Math.ceil(slots / per))
  for (let p = 0; p < pages; p++) {
    if (p > 0) doc.addPage()
    for (let n = 0; n < per; n++) {
      const idx = p * per + n - skip
      const x = left + (n % t.cols) * t.w
      const y = top + Math.floor(n / t.cols) * t.h
      doc.setDrawColor(...GREY).setLineWidth(0.1).setLineDashPattern([0.8, 0.8], 0).rect(x, y, t.w, t.h).setLineDashPattern([], 0) // a faint cut line
      if (idx >= 0 && idx < labels.length) drawLabel(doc, t, x, y, labels[idx], o)
    }
  }
  return doc
}

function words(doc: jsPDF, s: string, w: number, size: number, bold: boolean, maxLines: number): string[] {
  doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size)
  const lines: string[] = doc.splitTextToSize(s.trim(), w)
  if (lines.length <= maxLines) return lines
  const cut = lines.slice(0, maxLines)
  cut[maxLines - 1] = cut[maxLines - 1].replace(/.{0,2}$/, '…')
  return cut
}

function drawLabel(doc: jsPDF, t: Template, x: number, y: number, l: QueueItem, o: PrintOptions) {
  const put = (s: string, px: number, py: number, size: number, bold: boolean, color: RGB, align: 'left' | 'right' | 'center' = 'left') => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(...color)
    doc.text(s, px, py, { align })
  }
  const was = l.price ?? 0
  const iw = t.w - 2 * PAD

  if (t.id === 'shelf' || t.id === 'hook') {
    const hook = t.id === 'hook'
    const ink = o.teal ? WHITE : INK
    if (o.teal) doc.setFillColor(...TEAL).rect(x, y, t.w, t.h, 'F')
    doc.setDrawColor(...GREY).setLineWidth(0.1).setLineDashPattern([0.8, 0.8], 0).rect(x, y, t.w, t.h).setLineDashPattern([], 0)
    const lines = words(doc, l.description, iw, hook ? 8 : 8, true, 2)
    lines.forEach((s, i) => put(s, x + PAD, y + PAD + 3 + i * 3.4, hook ? 8 : 8, true, ink))
    put(aud(was), x + PAD, y + t.h - PAD - (o.barcode ? 3 : 1.5), hook ? 22 : 26, true, ink)
    put(l.code, x + t.w - PAD, y + t.h - PAD - (o.barcode ? 3 : 1.5), 8, true, ink, 'right')
    if (o.barcode && l.barcode) put(l.barcode, x + t.w - PAD, y + t.h - PAD + 0.6, 6, false, ink, 'right')
    return
  }

  const disc = discountOf(l.discount) ?? 0
  const now = nowPrice(was, disc)
  const pct = `${Number.isInteger(disc) ? disc : disc.toFixed(1)}%`
  if (t.id === 'clearance') {
    doc.setFillColor(...CHARCOAL).rect(x, y, t.w, 14, 'F')
    put('CLEARANCE', x + t.w / 2, y + 9.5, 17, true, YELLOW, 'center')
    put(`${pct} OFF`, x + t.w / 2, y + 28, 26, true, INK, 'center')
    put('Was', x + PAD + 2, y + 38, 11, false, INK)
    const wasText = aud(was)
    put(wasText, x + t.w - PAD - 2, y + 38, 12, false, INK, 'right')
    const tw = doc.getTextWidth(wasText)
    doc.setDrawColor(...INK).setLineWidth(0.35).line(x + t.w - PAD - 2 - tw, y + 37, x + t.w - PAD - 2, y + 37) // struck through
    put('NOW', x + PAD + 2, y + 50, 13, true, INK)
    put(aud(now), x + t.w - PAD - 2, y + 51, 28, true, INK, 'right')
    words(doc, l.description, iw, 10, false, 2).forEach((s, i) => put(s, x + t.w / 2, y + 59 + i * 4.2, 10, false, INK, 'center'))
    put(`While stocks last · ${l.code}`, x + t.w / 2, y + t.h - 3, 7.5, false, INK, 'center')
    return
  }

  // clearance strip: a charcoal block on the left with the discount, the details on the right
  const bw = 20
  doc.setFillColor(...CHARCOAL).rect(x, y, bw, t.h, 'F')
  put('CLEARANCE', x + bw / 2, y + 6, 6.5, true, YELLOW, 'center')
  put(pct, x + bw / 2, y + 17, 20, true, YELLOW, 'center')
  put('OFF', x + bw / 2, y + 23, 8, true, YELLOW, 'center')
  const rx = x + bw + PAD
  const rw = t.w - bw - 2 * PAD
  words(doc, l.description, rw, 8.5, true, 2).forEach((s, i) => put(s, rx, y + 5.5 + i * 3.6, 8.5, true, INK))
  const wasText = aud(was)
  put(wasText, rx, y + 15.5, 10, false, INK)
  const tw = doc.getTextWidth(wasText)
  doc.setDrawColor(...INK).setLineWidth(0.3).line(rx, y + 14.6, rx + tw, y + 14.6)
  put(aud(now), x + t.w - PAD, y + 21.5, 20, true, INK, 'right')
  put(`${l.code} · While stocks last`, rx, y + t.h - 2.2, 6.5, false, INK)
}
