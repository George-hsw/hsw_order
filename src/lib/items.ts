import type { Item } from './quote'

export interface PriceList {
  generatedAt: string | null
  source: string
  items: Item[]
}

type Row = [string, string, number | null, string, string?]

/** Loads the price snapshot published next to the app (public/items.json). */
export async function loadPriceList(): Promise<PriceList> {
  const res = await fetch(`${import.meta.env.BASE_URL}items.json`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`Could not load price list (${res.status})`)
  const data = (await res.json()) as { generatedAt: string | null; source: string; items: Row[] }
  return {
    generatedAt: data.generatedAt,
    source: data.source,
    items: data.items.map(([code, description, price, status, barcode]) => ({
      code, description, price, status, barcode: barcode || undefined,
    })),
  }
}

export const indexItems = (items: Item[]) => new Map(items.map((i) => [i.code, i]))
export const indexBarcodes = (items: Item[]) => {
  const m = new Map<string, Item>()
  for (const i of items) if (i.barcode) m.set(i.barcode, i)
  return m
}

/**
 * Resolve a scanned/typed value to an item: exact barcode, exact item code, or the
 * barcode with its check digit / leading zero differences (UPC-A 12 vs EAN-13 13 digits).
 */
export function findByScan(value: string, byCode: Map<string, Item>, byBarcode: Map<string, Item>): Item | undefined {
  const v = value.trim()
  if (!v) return undefined
  return (
    byBarcode.get(v) ??
    byCode.get(v) ??
    byCode.get(v.toUpperCase()) ??
    (/^\d+$/.test(v) ? byBarcode.get(v.padStart(13, '0')) ?? byBarcode.get(v.replace(/^0+/, '')) : undefined)
  )
}

/** Case-insensitive search by code, barcode or description for the item picker. */
export function searchItems(items: Item[], term: string, limit = 12): Item[] {
  const t = term.trim().toLowerCase()
  if (t.length < 2) return []
  const words = t.split(/\s+/)
  const out: Item[] = []
  for (const it of items) {
    const hay = (it.code + ' ' + it.description + ' ' + (it.barcode ?? '')).toLowerCase()
    if (words.every((w) => hay.includes(w))) {
      out.push(it)
      if (out.length >= limit) break
    }
  }
  return out
}
