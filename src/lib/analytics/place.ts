// A place someone shared when they signed in, and what can be worked out from it. Pure functions, so they are tested without a browser.

export type Place =
  | { status: 'shared'; lat: number; lng: number; acc: number }
  | { status: 'declined' | 'denied' | 'unavailable' }

/** What the admin reads when there is no place to show. */
export const NO_PLACE_LABEL: Record<'declined' | 'denied' | 'unavailable', string> = {
  declined: 'Chose not to share',
  denied: 'Blocked in the browser',
  unavailable: 'Not available on this device',
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp

export const roundedPlace = (lat: number, lng: number, acc: number): Place =>
  ({ status: 'shared', lat: round(lat, 4), lng: round(lng, 4), acc: Math.min(99999, Math.max(0, Math.round(acc))) })

/** The place an event carries, or null when it carries none (or something that is not a place). */
export function placeOfDetail(detail: Record<string, unknown> | null | undefined): Place | null {
  const d = detail ?? {}
  if (d.status === 'declined' || d.status === 'denied' || d.status === 'unavailable') return { status: d.status }
  if (d.status === 'shared' && typeof d.lat === 'number' && typeof d.lng === 'number' && Math.abs(d.lat) <= 90 && Math.abs(d.lng) <= 180) {
    return { status: 'shared', lat: d.lat, lng: d.lng, acc: typeof d.acc === 'number' ? d.acc : 0 }
  }
  return null
}

/** Straight-line distance between two places in kilometres (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export const mapLink = (p: { lat: number; lng: number }) => `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`
