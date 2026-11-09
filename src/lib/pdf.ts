import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Logo } from './logo'
import { dateAU, isPlaceholder, money, type Computed, type QuoteInput, type Settings } from './quote'

// Plain, document-style layout modelled on the hsw.com.au order invoice: big logo, grey title,
// company block, Billing / Shipping details, a small facts grid, ruled item list, right-aligned totals.
const GREY: [number, number, number] = [140, 140, 140]
const INK: [number, number, number] = [0, 0, 0]
const RULE: [number, number, number] = [60, 60, 60]
const aud = (cents: number) => `${money(cents)} AUD`

type TextOpts = { bold?: boolean; size?: number; color?: [number, number, number]; align?: 'left' | 'right' | 'center'; maxWidth?: number }

/** Builds the customer-facing Quote / Tax Invoice as an A4 PDF. */
export function buildPdf(q: QuoteInput, c: Computed, s: Settings, logo?: Logo | null): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 15
  const R = W - M
  const isInvoice = q.docType === 'Tax Invoice'
  const store = c.store
  const text = (t: string, x: number, y: number, o: TextOpts = {}) => {
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal').setFontSize(o.size ?? 9).setTextColor(...(o.color ?? INK))
    doc.text(t, x, y, { align: o.align, maxWidth: o.maxWidth })
  }

  // Logo, large, top left
  let y = 12
  if (logo) {
    const lw = 105
    const lh = lw * (logo.height / logo.width)
    doc.addImage(logo.data, 'PNG', M, y, lw, lh)
    y += lh + 6
  } else {
    text('Howards Storage World', M, y + 10, { bold: true, size: 26 })
    y += 22
  }

  // Grey title
  text(`Howards Storage World ${isInvoice ? 'tax invoice' : 'quote'} #${c.docNumber}`, M, y, { bold: true, size: 11, color: GREY })
  y += 8

  // Company block
  const legal = isPlaceholder(s.legalName) ? 'Howards Storage World' : s.legalName
  const from = [
    `Howards Storage World${store ? ` ${store.name}` : ''}`,
    store?.address ?? '',
    store?.suburb ?? '',
    'Australia',
    [store?.phone, store?.email].filter(Boolean).join('   '),
  ].filter(Boolean)
  from.forEach((t, i) => text(t, M, y + i * 4.2, { bold: i < 4, size: 8.5 }))
  y += from.length * 4.2 + 3
  text(legal, M, y, { bold: true, size: 8.5 })
  if (!isPlaceholder(s.abn)) text(`ABN: ${s.abn}`, M, y + 4.2, { bold: true, size: 8.5 })
  y += (isPlaceholder(s.abn) ? 4.2 : 8.4) + 5

  // Billing and shipping details
  const colB = M
  const colS = M + 92
  text('Billing Details', colB, y, { bold: true, size: 10 })
  text('Shipping Details', colS, y, { bold: true, size: 10 })
  const cu = q.customer
  const billing = [
    cu.name.trim(), cu.company.trim(), cu.abn.trim() ? `ABN: ${cu.abn.trim()}` : '',
    cu.address.trim(), cu.suburb.trim(), cu.phone.trim(), cu.email.trim(),
  ].filter(Boolean)
  const shipping: string[] = cu.deliverTo.trim()
    ? doc.splitTextToSize(cu.deliverTo.trim(), 80)
    : [cu.name.trim(), cu.address.trim(), cu.suburb.trim()].filter(Boolean)
  const rows = Math.max(billing.length, shipping.length)
  billing.forEach((t, i) => text(t, colB, y + 5.5 + i * 4.2, { size: 8.5, maxWidth: 85 }))
  shipping.forEach((t, i) => text(t, colS, y + 5.5 + i * 4.2, { size: 8.5 }))
  y += 5.5 + rows * 4.2 + 5

  // Facts grid
  const facts: [string, string, string, string][] = [
    [isInvoice ? 'Invoice:' : 'Quote:', `#${c.docNumber}`, 'Date:', dateAU(c.date)],
    ['Served by:', q.servedBy.trim() || '-', isInvoice ? 'Due date:' : 'Valid until:', dateAU(c.secondDate)],
  ]
  facts.forEach(([l1, v1, l2, v2], i) => {
    const fy = y + i * 5.2
    text(l1, colB, fy, { bold: true, size: 8.5 }); text(v1, colB + 30, fy, { size: 8.5 })
    text(l2, colS, fy, { bold: true, size: 8.5 }); text(v2, colS + 30, fy, { size: 8.5 })
  })
  y += facts.length * 5.2 + 1
  doc.setDrawColor(...RULE).setLineWidth(0.3).line(M, y, R, y)
  y += 6

  // Items
  text('Items', M, y, { bold: true, size: 12 })
  const hasDisc = c.lines.some((l) => l.discount > 0)
  const rightCols = hasDisc ? [0, 3, 4, 5] : [0, 3, 4]
  autoTable(doc, {
    startY: y + 3,
    margin: { left: M, right: M },
    theme: 'plain',
    head: [['Qty', 'Code/SKU', 'Product Name', 'Price', ...(hasDisc ? ['Disc'] : []), 'Total']],
    body: c.lines.map((l) => [
      String(l.qty), l.code || '-', l.description, aud(l.unitCents),
      ...(hasDisc ? [l.discount > 0 ? `${Math.round(l.discount * 1000) / 10}%` : ''] : []),
      aud(l.totalCents),
    ]),
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 1.6, bottom: 1.6, left: 1.5, right: 1.5 }, textColor: INK, overflow: 'linebreak' },
    headStyles: { fontStyle: 'bold' },
    columnStyles: hasDisc
      ? { 0: { halign: 'right', cellWidth: 10 }, 1: { cellWidth: 22 }, 3: { halign: 'right', cellWidth: 28 }, 4: { halign: 'right', cellWidth: 14 }, 5: { halign: 'right', cellWidth: 28 } }
      : { 0: { halign: 'right', cellWidth: 10 }, 1: { cellWidth: 24 }, 3: { halign: 'right', cellWidth: 32 }, 4: { halign: 'right', cellWidth: 32 } },
    didParseCell: (d) => { if (d.section === 'head' && rightCols.includes(d.column.index)) d.cell.styles.halign = 'right' },
    didDrawCell: (d) => {
      // a thin rule under the header row
      if (d.section === 'head') doc.setDrawColor(...RULE).setLineWidth(0.2).line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height)
    },
  })
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  doc.setDrawColor(...RULE).setLineWidth(0.3).line(M, y + 1, R, y + 1)
  y += 7

  // Keep the totals, notes and terms together
  if (y + 70 > H - 20) { doc.addPage(); y = 20 }

  // Totals, right aligned
  const lx = R - 52
  const total = (label: string, value: string, bold = false) => {
    text(`${label}:`, lx, y, { bold, size: 8.5, align: 'right' })
    text(value, R, y, { bold, size: 8.5, align: 'right' })
    y += 5.4
  }
  total('Subtotal', aud(c.itemsCents))
  total('Delivery' + (q.deliveryNote.trim() && c.deliveryCents > 0 ? ` (${q.deliveryNote.trim()})` : ''), c.deliveryCents > 0 ? aud(c.deliveryCents) : 'Not included')
  total('Installation' + (q.installNote.trim() && c.installCents > 0 ? ` (${q.installNote.trim()})` : ''), c.installCents > 0 ? aud(c.installCents) : 'Not included')
  total('Grand total', aud(c.totalCents), true)
  total('GST Included in total', aud(c.gstCents))
  if (isInvoice || c.paidCents > 0) {
    total(isInvoice ? 'Paid' : 'Deposit received', aud(c.paidCents))
    total('Balance due', aud(c.balanceCents), true)
  }
  y += 4

  // Notes, how to accept or pay
  const block = (title: string, body: string[]) => {
    text(title, M, y, { bold: true, size: 10 })
    y += 5
    body.forEach((line) => {
      const parts: string[] = doc.splitTextToSize(line, W - 2 * M)
      parts.forEach((p) => { text(p, M, y, { size: 8.5 }); y += 4.1 })
    })
    y += 3
  }
  if (q.notes.trim()) block('Notes', [q.notes.trim()])
  block(isInvoice ? 'How to pay' : 'How to accept this quote', [
    isInvoice ? s.howToPay : s.howToAccept,
    isInvoice ? `Account name: ${s.bankName}    BSB: ${s.bsb}    Account: ${s.account}    Reference: ${c.docNumber}` : `Quote number: ${c.docNumber}`,
  ])

  // Terms and footer at the foot of the last page
  const terms: string[] = doc.splitTextToSize(s.terms, W - 2 * M)
  const ty = Math.max(y + 2, H - 20 - terms.length * 3.2)
  terms.forEach((t, i) => text(t, M, ty + i * 3.2, { size: 7, color: GREY }))
  text(`${s.footer}  -  ${s.website}`, M, H - 9, { bold: true, size: 8.5, color: GREY })

  const pages = doc.getNumberOfPages()
  if (pages > 1) {
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p)
      text(`${c.docNumber}   Page ${p} of ${pages}`, R, H - 5, { size: 7.5, color: GREY, align: 'right' })
    }
  }
  return doc
}
