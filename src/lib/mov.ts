// Minimum order value (MOV): the least a supplier accepts on one order, in dollars excluding GST.
// The table is keyed by the 3-letter HSW supplier code. A vendor number in the app (NAV style, e.g. ANAS001) belongs to the code it starts with.
// Under the MOV the app warns and still lets the person go ahead (the same as MOQ), and holds the suggestion back from the bell.
/** HSW supplier code → MOV in dollars ex GST, and what happens if it is not met (a fee or a levy), when the supplier says so. */
export const MOV: Record<string, { mov: number; note?: string }> = {
  EVR: { mov: 300 }, ARC: { mov: 200 }, ANA: { mov: 750 }, BET: { mov: 250 }, BUD: { mov: 324 }, ZLS: { mov: 750 },
  DNE: { mov: 400 }, FIS: { mov: 275 }, CRS: { mov: 350 }, EVO: { mov: 300 }, EFP: { mov: 400 }, CPS: { mov: 250 },
  FTG: { mov: 300 }, DRF: { mov: 500 }, ISA: { mov: 500, note: '2.75% fuel levy applies' }, JOS: { mov: 500 }, JTY: { mov: 500 },
  KEN: { mov: 300 }, KES: { mov: 300 }, LSC: { mov: 550 }, LTW: { mov: 700, note: '$50 charge if under' }, MMA: { mov: 300 },
  TRA: { mov: 250 }, SHL: { mov: 150 }, BRB: { mov: 400 }, STE: { mov: 400 }, TAN: { mov: 750, note: '$24.95 shipping fee if under' },
  THR: { mov: 300 }, THU: { mov: 400 }, TOL: { mov: 250 },
}

export interface MovCheck { mov: number; short: number; met: boolean; note?: string }

/** The MOV for a vendor number, or null when the vendor has none on the list. */
export function movFor(vendorNo: string | null | undefined): { mov: number; note?: string } | null {
  const code = (vendorNo ?? '').trim().slice(0, 3).toUpperCase()
  return Object.hasOwn(MOV, code) ? MOV[code] : null
}

/** Whether an order of this cost (ex GST) reaches the vendor's MOV. Null when the vendor has no MOV. Worked in cents. */
export function movCheck(vendorNo: string | null | undefined, cost: number): MovCheck | null {
  const m = movFor(vendorNo)
  if (!m) return null
  const short = Math.max(0, Math.round(m.mov * 100) - Math.round(cost * 100)) / 100
  return { mov: m.mov, short, met: short === 0, note: m.note }
}
