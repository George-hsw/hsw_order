import { useEffect, useRef, useState } from 'react'
import { api } from './lib/api'
import { trackError } from './lib/analytics/track'
import { useToast } from './Toast'
import type { BlockedItem } from './lib/supabase'
import type { Product } from './lib/order'

const REASONS = ['Clearance', 'Not sellable here', 'Other']

/**
 * A store's ordering preferences, opened from the Order screen before a vendor is chosen. For now one: items the store will not order
 * (not sellable here, or in clearance). A blocked item is left out of suggestions, Needs ordering, the bell and the order lists at this store only.
 * Everyone in the store can see the list; the manager (and the admin) can add to it and take items off it, and the database enforces that too.
 */
export default function StorePrefs({ storeId, storeName, email, canManage, blocked, failed, onChange }: {
  storeId: string; storeName: string; email: string; canManage: boolean; blocked: BlockedItem[] | null; failed: boolean; onChange: () => void
}) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [reason, setReason] = useState(REASONS[0])
  const [hits, setHits] = useState<Product[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const asked = useRef('')
  const list = blocked ?? []
  const isBlocked = new Set(list.map((b) => b.item_code))

  // Matches come up as the manager types, the same as Price check.
  useEffect(() => {
    const v = text.trim()
    asked.current = v
    if (v.length < 2) { setHits([]); return }
    const t = setTimeout(() => {
      api.findItems(storeId, v).then((r) => { if (asked.current === v) setHits(r) }).catch((e) => trackError('blocked search', e))
    }, 220)
    return () => clearTimeout(t)
  }, [text, storeId])

  const change = async (code: string, name: string, on: boolean) => {
    setBusy(code)
    try {
      await api.setBlocked(storeId, code, on, email, on ? reason : '')
      onChange()
      toast.success(on ? `${name} will no longer be ordered at ${storeName}.` : `${name} can be ordered again at ${storeName}.`)
      if (on) { setText(''); setHits([]) }
    } catch (e) {
      trackError('blocked items', e)
      toast.error(`Could not ${on ? 'block' : 'unblock'} ${name}. Only the store’s manager can change this list.`)
    } finally { setBusy(null) }
  }

  return (
    <details className="storedetails prefs">
      <summary>Store preferences{list.length > 0 && <span className="chip warn">{list.length} blocked</span>}</summary>
      <div className="prefsbody">
        <h3>Items this store will not order</h3>
        <p className="muted">Not sellable here, or in clearance? Block it. It is left out of the suggested order, Needs ordering, the bell and the order lists at {storeName} only. Other stores are not affected.</p>

        {canManage ? (
          <div className="prefsadd">
            <div className="findrow">
              <input type="search" name="blockFind" aria-label="Find an item to block" placeholder="Find an item to block: number, barcode or name" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
              <label className="inline">Reason
                <select name="blockReason" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
              </label>
            </div>
            {hits.length > 0 && (
              <ul className="pricehits prefshits">
                {hits.slice(0, 8).map((h) => (
                  <li key={h.item.code}>
                    <div className="hit">
                      <span><b>{h.item.description || h.item.code}</b><small>{h.item.code}{h.stock?.vendor_no ?? h.item.vendor_no ? `, ${h.stock?.vendor_no ?? h.item.vendor_no}` : ''}</small></span>
                      {isBlocked.has(h.item.code)
                        ? <span className="chip">Already blocked</span>
                        : <button type="button" className="btn" disabled={busy === h.item.code} onClick={() => void change(h.item.code, h.item.description || h.item.code, true)}>{busy === h.item.code ? 'Blocking…' : 'Block'}</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : <p className="note">Only the store’s manager can change this list.</p>}

        {failed && <p className="note bad" role="alert">The blocked list did not load, so items blocked here may still show. Reload to try again.</p>}
        {blocked === null ? <p className="muted">Loading…</p> : failed && list.length === 0 ? null : list.length === 0 ? <p className="muted">No blocked items at {storeName}.</p> : (
          <ul className="blockedlist">
            {list.map((b) => (
              <li key={b.item_code}>
                <div className="hit">
                  <span>
                    <b>{b.description}</b>
                    <small>{b.item_code}{b.vendor_no ? `, ${b.vendor_no}` : ''}{b.blocked_by ? `, blocked by ${b.blocked_by.split('@')[0]}` : ''}, {new Date(b.blocked_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</small>
                  </span>
                  {b.reason && <span className="chip">{b.reason}</span>}
                  {canManage && <button type="button" className="btn" disabled={busy === b.item_code} onClick={() => void change(b.item_code, b.description, false)}>{busy === b.item_code ? 'Working…' : 'Unblock'}</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
