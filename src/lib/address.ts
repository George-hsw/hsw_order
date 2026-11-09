// Address suggestions from Photon (komoot.io), a free search service built on OpenStreetMap. No account or key.
// Only what is typed in the address box is sent (without any unit number), and only once it is long enough to search.

export interface Suggestion {
  street: string // "Unit 5, 12 Smith St" or the place name
  suburb: string // "Mornington VIC 3931", the format the quote and PDF already use
  label: string // the full line shown in the list
}

const STATES: Record<string, string> = {
  'new south wales': 'NSW', victoria: 'VIC', queensland: 'QLD', 'south australia': 'SA',
  'western australia': 'WA', tasmania: 'TAS', 'northern territory': 'NT', 'australian capital territory': 'ACT',
}

interface Feature { properties: Record<string, string | undefined> }

export interface Typed { unit: string; rest: string }

/**
 * Splits a unit off the front of what was typed: "unit 5, 1212 heather" and "5/1212 heather" both give unit "Unit 5"
 * and rest "1212 heather". The search service does badly with unit numbers, so only the rest is searched.
 */
export function parseTyped(text: string): Typed {
  const t = text.trim()
  const word = t.match(/^(unit|apt|apartment|flat|shop|suite|level|lot|u)\s*\.?\s*(\w+)\s*[,\s-]+(?=\d)/i)
  if (word) {
    const kind = word[1].toLowerCase()
    const label = kind === 'u' ? 'Unit' : kind === 'apt' ? 'Apartment' : kind[0].toUpperCase() + kind.slice(1)
    return { unit: `${label} ${word[2].toUpperCase()}`, rest: t.slice(word[0].length) }
  }
  const slash = t.match(/^(\d+[a-z]?)\s*\/\s*(?=\d)/i)
  if (slash) return { unit: `Unit ${slash[1].toUpperCase()}`, rest: t.slice(slash[0].length) }
  return { unit: '', rest: t }
}

/** Turns one Photon result into the two lines the quote uses. Returns null for results with no street or place. */
export function toSuggestion(f: Feature, unit = '', typedNumber = ''): Suggestion | null {
  const p = f.properties
  // A whole street with no house number on the map: use the street and suburb, and the number that was typed.
  const streetOnly = !p.street && p.osm_key === 'highway' && !!p.name
  if (!p.street && !streetOnly) return null // not an address: a suburb, a landmark or the like
  const road = p.street ? [p.housenumber ?? typedNumber, p.street].filter(Boolean).join(' ') : [typedNumber, p.name].filter(Boolean).join(' ')
  if (!road) return null
  const street = unit ? `${unit}, ${road}` : road
  const place = p.district ?? p.locality ?? p.city ?? ''
  const state = p.state ? (STATES[p.state.toLowerCase()] ?? p.state) : ''
  const suburb = [place, state, p.postcode].filter(Boolean).join(' ')
  return { street, suburb, label: [street, suburb].filter(Boolean).join(', ') }
}

/** The house number in what was typed, if any. */
export function typedNumber(rest: string): string {
  return rest.toLowerCase().split(/[\s,]+/).find((t) => /^\d+[a-z]?(-\d+[a-z]?)?$/.test(t)) ?? ''
}

/** True when a result really is what was typed: the house number agrees and every word typed starts a word of the result. */
export function matchesTyped(f: Feature, rest: string): boolean {
  const p = f.properties
  const tokens = rest.toLowerCase().split(/[\s,]+/).filter(Boolean)
  const num = tokens.find((t) => /^\d+[a-z]?(-\d+[a-z]?)?$/.test(t))
  if (num && p.street && p.housenumber) {
    const have = (p.housenumber ?? '').toLowerCase().split(/[-/]/)
    const want = num.split('-')
    if (!want.every((w) => have.includes(w)) && !(have.length === 2 && want.length === 1 && Number(have[0]) <= Number(want[0]) && Number(want[0]) <= Number(have[1]))) return false
  }
  // Words typed must start a word of the street, or of the suburb. The metro city (Photon files Bulleen and Essendon
  // under "Melbourne") only counts when the result has no suburb of its own, so a typed suburb has to be the real one.
  const words = (v: (string | undefined)[]) => v.filter(Boolean).join(' ').toLowerCase().split(/[\s,]+/)
  const hay = [...words([p.street, p.name]), ...words([p.district, p.locality, p.postcode, p.district || p.locality ? undefined : p.city])]
  return tokens.filter((t) => t !== num).every((t) => hay.some((h) => h.startsWith(t)))
}

/** Up to five Australian address suggestions for what has been typed so far. */
export async function searchAddress(text: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const { unit, rest } = parseTyped(text)
  if (rest.trim().length < 4) return []
  // bbox is Australia, so overseas matches are left out
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(rest.trim())}&limit=10&lang=en&bbox=112,-44,154,-9`
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const body = (await res.json()) as { features?: Feature[] }
  const seen = new Set<string>()
  const exact: Suggestion[] = [] // the house number is on the map
  const streets: Suggestion[] = [] // only the street is: shown after, with the number that was typed
  for (const f of body.features ?? []) {
    if (!matchesTyped(f, rest)) continue
    const s = toSuggestion(f, unit, typedNumber(rest))
    if (!s || seen.has(s.label)) continue
    seen.add(s.label)
    ;(f.properties.housenumber ? exact : streets).push(s)
  }
  return [...exact, ...streets].slice(0, 5)
}
