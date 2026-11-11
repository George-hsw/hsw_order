import type { ReactNode } from 'react'

/**
 * A short label whose explanation shows only on hover, on keyboard focus, or when it is tapped on a phone, so a row stays clean.
 * The explanation is also its accessible name, so it is read out in full.
 */
export default function Tag({ tone = 'plain', tip, children }: { tone?: 'plain' | 'ok' | 'warn' | 'error' | 'promo'; tip: string; children: ReactNode }) {
  return <span className={'tag ' + tone} tabIndex={0} data-tip={tip} role="note" aria-label={`${typeof children === 'string' ? children : ''}: ${tip}`.replace(/^: /, '')}>{children}</span>
}
