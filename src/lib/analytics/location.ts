// Capturing where someone signs in from, when they choose to share it. The person is told first and can say no; a no is recorded as a no, and the
// app carries on. Coordinates are rounded (4 decimals is about 10 metres) and go into the same admin-only usage log as every other event.
import { DEMO } from '../supabase'
import { roundedPlace, type Place } from './place'
import { track } from './track'

// ---------- Capturing it, in the browser ----------

export type GeoPermission = 'granted' | 'denied' | 'prompt' | 'unsupported'

export async function geoPermission(): Promise<GeoPermission> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported'
  try {
    const s = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return s ? s.state : 'prompt'
  } catch { return 'prompt' } // some browsers cannot be asked without asking the person
}

/** Asks the device where it is. The browser puts up its own allow or block prompt the first time. */
export function currentPlace(timeoutMs = 10000): Promise<Place> {
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(roundedPlace(p.coords.latitude, p.coords.longitude, p.coords.accuracy)),
        (e) => resolve({ status: e.code === 1 ? 'denied' : 'unavailable' }),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60 * 1000 },
      )
    } catch { resolve({ status: 'unavailable' }) }
  })
}

const DONE_KEY = 'hsw-orders-place-done' // this browser session has had its place recorded
const DECLINED_KEY = 'hsw-orders-place-declined:' // per account, in this browser: when they last said "not now"
const ASK_AGAIN_DAYS = 30

const recorded = (p: Place) => track('sign_in_location', p)

/**
 * Once per sign-in: tell the person what is recorded and why, and ask. A yes (or a place the browser already allows) records where they are;
 * a no records that they chose not to share, and they are not asked again for 30 days. `ask` shows the notice and resolves true to share.
 */
export async function recordSignInPlace(ask: () => Promise<boolean>, email: string): Promise<void> {
  if (DEMO && !location.search.includes('place')) return // the demo shows the notice only when asked for with ?place
  try {
    if (sessionStorage.getItem(DONE_KEY)) return
    sessionStorage.setItem(DONE_KEY, '1')
  } catch { /* still try once */ }
  const perm = await geoPermission()
  if (perm === 'unsupported') return recorded({ status: 'unavailable' })
  if (perm === 'denied') return recorded({ status: 'denied' })
  if (perm === 'prompt') {
    let recently = false
    try { const t = Number(localStorage.getItem(DECLINED_KEY + email) ?? 0); recently = t > 0 && Date.now() - t < ASK_AGAIN_DAYS * 864e5 } catch { /* ask */ }
    if (recently) return recorded({ status: 'declined' })
    if (!(await ask())) {
      try { localStorage.setItem(DECLINED_KEY + email, String(Date.now())) } catch { /* ignore */ }
      return recorded({ status: 'declined' })
    }
  }
  recorded(await currentPlace())
}
