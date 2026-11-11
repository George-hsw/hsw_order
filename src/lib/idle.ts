// Signing people out when a device has been left alone, so a forgotten phone or shared PC does not stay logged in.

/** How long a device may sit with no activity before it is signed out. */
export const IDLE_LIMIT_MS = 2 * 60 * 60 * 1000
/** The warning comes this long before the sign-out. */
export const IDLE_WARN_MS = 5 * 60 * 1000
export const IDLE_KEY = 'hsw-orders-last-active' // shared by every tab of the app in this browser
export const IDLE_NOTICE_KEY = 'hsw-orders-idle-signout' // tells the sign-in screen why the person is back there

export type IdleStatus = 'active' | 'warn' | 'expired'

/** Where a device stands, given when it was last used. */
export function idleStatus(lastActive: number, now: number, limit = IDLE_LIMIT_MS, warnBefore = IDLE_WARN_MS): IdleStatus {
  const idle = now - lastActive
  if (idle >= limit) return 'expired'
  return idle >= limit - warnBefore ? 'warn' : 'active'
}
