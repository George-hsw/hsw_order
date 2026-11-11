import { useEffect, useRef } from 'react'
import { IDLE_KEY, IDLE_LIMIT_MS, IDLE_NOTICE_KEY, idleStatus } from './idle'
import { supabase } from './supabase'

const TOUCH_EVERY_MS = 15_000 // how often activity is written down: often enough, and cheap
const CHECK_EVERY_MS = 30_000

const read = (): number => { try { return Number(localStorage.getItem(IDLE_KEY)) || Date.now() } catch { return Date.now() } }
const write = (t: number) => { try { localStorage.setItem(IDLE_KEY, String(t)) } catch { /* private mode: the check just uses this tab */ } }

/**
 * Signs the person out after two hours with no touch, key or scroll in any tab, warning five minutes before. Activity is kept in
 * localStorage, so work in one tab keeps the others signed in. Returning to a sleeping device checks straight away.
 */
export function useIdleSignOut(enabled: boolean, onWarn: (minutes: number) => void) {
  const warned = useRef(false)
  const warn = useRef(onWarn)
  warn.current = onWarn

  useEffect(() => {
    if (!enabled || !supabase) return
    write(Date.now())
    let lastWrite = Date.now()
    const touch = () => {
      const now = Date.now()
      if (now - lastWrite < TOUCH_EVERY_MS) return
      lastWrite = now; write(now); warned.current = false
    }
    const check = () => {
      const status = idleStatus(read(), Date.now())
      if (status === 'expired') {
        try { sessionStorage.setItem(IDLE_NOTICE_KEY, '1') } catch { /* ignore */ }
        void supabase!.auth.signOut()
      } else if (status === 'warn' && !warned.current) {
        warned.current = true
        warn.current(Math.max(1, Math.ceil((IDLE_LIMIT_MS - (Date.now() - read())) / 60_000)))
      }
    }
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(check, CHECK_EVERY_MS)
    return () => { events.forEach((e) => window.removeEventListener(e, touch)); document.removeEventListener('visibilitychange', onVisible); window.clearInterval(timer) }
  }, [enabled])
}
