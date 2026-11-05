import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type Kind = 'error' | 'success' | 'info'
interface Item { id: number; kind: Kind; lines: string[] }

interface Api {
  error: (message: string | string[]) => void
  success: (message: string | string[]) => void
  info: (message: string | string[]) => void
}

const Ctx = createContext<Api | null>(null)

/** Errors stay a little longer than confirmations so they can be read. */
const LIFETIME: Record<Kind, number> = { error: 9000, info: 5000, success: 4000 }

const ICON: Record<Kind, string> = {
  error: 'M12 8v5m0 3.5h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  success: 'M5 12.5 10 17.5 19 7',
  info: 'M12 11v5m0-8.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([])
  const next = useRef(1)

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), [])
  const push = useCallback((kind: Kind, message: string | string[]) => {
    const id = next.current++
    const lines = Array.isArray(message) ? message : [message]
    // The same message twice in a row replaces itself instead of stacking up.
    setItems((l) => [...l.filter((t) => t.lines.join('|') !== lines.join('|')), { id, kind, lines }].slice(-4))
    setTimeout(() => dismiss(id), LIFETIME[kind])
  }, [dismiss])

  const api = useMemo<Api>(
    () => ({ error: (m) => push('error', m), success: (m) => push('success', m), info: (m) => push('info', m) }),
    [push],
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={ICON[t.kind]} />
            </svg>
            <div className="msg">
              {t.lines.length > 1
                ? <><b>Please fix the following</b><ul>{t.lines.map((l) => <li key={l}>{l}</li>)}</ul></>
                : t.lines[0]}
            </div>
            <button type="button" className="x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>&times;</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): Api {
  const api = useContext(Ctx)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}
