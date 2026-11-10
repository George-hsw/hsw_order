import { useEffect, useRef, useState } from 'react'
import { useEscapeKey } from './Charts'
import { track } from './lib/analytics/track'
import type { Notice, Target } from './lib/notifications'

interface Props {
  shown: Notice[]
  count: number
  urgent: boolean
  loading: boolean
  partial: boolean
  onHide: (list: Notice[]) => void
  onGo: (t: Target) => void
  onReload: () => void
}

const LEVEL_WORD = { bad: 'Urgent', warn: 'Check', info: 'For your information' } as const

/** The bell in the top corner: what needs attention, one line each, with a button that goes straight to it. */
export default function Notifications({ shown, count, urgent, loading, partial, onHide, onGo, onReload }: Props) {
  const [open, setOpen] = useState(false)
  const bell = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEscapeKey(open, () => { setOpen(false); bell.current?.focus() })
  useEffect(() => { if (open) { onReload(); track('notices_open', { count }); panel.current?.focus() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => setOpen(false)
  return (
    <>
      <button ref={bell} type="button" className="quiet bellbtn" aria-label={count ? `Notifications, ${count} to look at${urgent ? ', some urgent' : ''}` : 'Notifications, none'}
        aria-expanded={open} aria-controls="noticepanel" title="Notifications" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7" /><path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {count > 0 && <span className={`bellcount${urgent ? ' urgent' : ''}`} aria-hidden="true">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <>
          <div className="noticescrim" onClick={close} aria-hidden="true" />
          <div id="noticepanel" ref={panel} className="noticepanel" role="region" aria-label="Notifications" tabIndex={-1}>
            <div className="noticehead">
              <h2>Notifications</h2>
              {shown.length > 0 && <button type="button" className="quiet" onClick={() => onHide(shown)}>Mark all read</button>}
            </div>
            {loading && shown.length === 0 ? <p className="muted">Checking…</p>
              : shown.length === 0 ? <p className="muted">Nothing needs your attention right now.</p>
              : (
                <ul className="noticelist">
                  {shown.map((n) => (
                    <li key={n.key} className={`notice ${n.level}`}>
                      <div>
                        <small className="muted">{LEVEL_WORD[n.level]}, {n.group}</small>
                        <b>{n.title}</b>
                        {n.detail && <p className="muted">{n.detail}</p>}
                      </div>
                      <div className="noticeacts">
                        {n.go && <button type="button" className="btn" onClick={() => { close(); onGo(n.go!) }}>Open</button>}
                        <button type="button" className="quiet" onClick={() => onHide([n])}>Hide</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            {partial && <p className="note">Some checks could not load, so this list may be missing things. <button type="button" className="quiet" onClick={onReload}>Try again</button></p>}
            <p className="muted noticefoot">Hidden items come back after a day (a week for information) if the problem is still there.</p>
          </div>
        </>
      )}
    </>
  )
}
