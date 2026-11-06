// Sends small usage events to the admin's log. It never blocks the screen and never throws: if the log cannot be written, the person
// carries on. The database fills in who it was, so an event cannot name someone else. No quantities, passwords or file contents are sent.
import { DEMO, supabase } from '../supabase'

const SESSION_KEY = 'hsw-orders-session'
const DEVICE_KEY = 'hsw-orders-device'

const rand = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 24)

function stored(storage: Storage | undefined, key: string): string {
  try {
    const have = storage?.getItem(key)
    if (have) return have
    const fresh = rand()
    storage?.setItem(key, fresh)
    return fresh
  } catch { return '' }
}

/** "Chrome on Windows": enough to tell devices apart without keeping the full browser string. */
export function deviceLabel(ua: string): string {
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Unknown system'
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${br} on ${os}`
}

const sessionId = () => stored(typeof sessionStorage === 'undefined' ? undefined : sessionStorage, SESSION_KEY)
const deviceId = () => stored(typeof localStorage === 'undefined' ? undefined : localStorage, DEVICE_KEY)

let errorsSent = 0
const sentErrors = new Set<string>()

export function track(kind: string, detail: Record<string, unknown> = {}, storeId?: string | null): void {
  if (DEMO || !supabase) return
  try {
    void supabase.from('app_events').insert({
      kind, detail, store_id: storeId ?? null, session_id: sessionId(), device: deviceLabel(navigator.userAgent), device_id: deviceId(),
    }).then(() => undefined, () => undefined)
  } catch { /* the log is never worth breaking the app for */ }
}

/** Records one sign-in per browser session (a refresh is not a new sign-in). */
export function startSession(): void {
  try {
    if (sessionStorage.getItem(SESSION_KEY + '-started')) return
    sessionStorage.setItem(SESSION_KEY + '-started', '1')
  } catch { /* still record it */ }
  track('session_start')
}

/** Records a problem, at most five a session and each message once, trimmed so nothing long or private is kept. */
export function trackError(where: string, message: unknown): void {
  const text = (message instanceof Error ? message.message : String(message ?? 'Unknown error')).replace(/\s+/g, ' ').slice(0, 200)
  if (errorsSent >= 5 || sentErrors.has(where + text)) return
  errorsSent++
  sentErrors.add(where + text)
  track('error', { message: text, where })
}

export function installErrorTracking(): () => void {
  const onError = (e: ErrorEvent) => trackError('screen', e.message)
  const onRejection = (e: PromiseRejectionEvent) => trackError('request', e.reason)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection) }
}
