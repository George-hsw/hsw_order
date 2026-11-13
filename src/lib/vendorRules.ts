// Items a supplier's range lists but a store may not order, by the item's NAV status code.
// Keyed by the 3-letter HSW supplier code a vendor number starts with (the same key as mov.ts), so MYHO001 belongs to MYH.
// The database applies the same rule to Needs ordering and the bell (migration 029): change both together.

export const NO_ORDER_STATUS: Record<string, { supplier: string; statuses: string[] }> = {
  MYH: { supplier: 'My Home Storage', statuses: ['TOS'] },
}

/** Why this item cannot be ordered from this vendor, or null when it can. */
export function noOrderReason(vendorNo: string | null | undefined, status: string | null | undefined): string | null {
  const code = (vendorNo ?? '').trim().slice(0, 3).toUpperCase()
  const rule = Object.hasOwn(NO_ORDER_STATUS, code) ? NO_ORDER_STATUS[code] : null
  const s = (status ?? '').trim().toUpperCase()
  return rule && s && rule.statuses.includes(s) ? `${rule.supplier} items with status ${s} cannot be ordered.` : null
}
