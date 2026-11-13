import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { money, parseQty, syncedLabel, vendorOf, type Product } from './lib/order'
import { addCounts, adjustValue, fmtDiff, fmtQty, verdict } from './lib/stocktake'
import type { CountLine } from './lib/supabase'

interface Props {
  product: Product
  existing: CountLine | undefined // the item has been counted already in this count
  conflict: CountLine | null | undefined // someone else counted it while this was open (null = they removed it)
  busy: boolean
  onSave: (counted: number) => void
  onRemove: () => void
  onClose: () => void
}

/**
 * One item in a stock take. Step 1: type what is on the shelf (the system's number stays hidden so nobody counts to match it).
 * Step 2: the system's number appears. A match saves straight away; a difference asks "Keep this count?" before it saves.
 */
export default function CountSheet({ product, existing, conflict, busy, onSave, onRemove, onClose }: Props) {
  const { item, stock } = product
  const vendor = vendorOf(item, stock)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'add' | 'replace'>('add') // counted before: add this count to the earlier one, or replace it
  const [checked, setChecked] = useState<number | null>(null) // the total that is being compared, once the count is typed in
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { if (conflict !== undefined) setChecked(null) }, [conflict])

  const system = existing ? Number(existing.system_qty) : stock?.inventory ?? 0
  const typed = parseQty(text)
  const badQty = text.trim() !== '' && typed === null
  const total = (n: number) => (existing && mode === 'add' ? addCounts(existing.counted, n) : n)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (typed === null || busy) return
    const t = total(typed)
    if (verdict(t, system).kind === 'match') return onSave(t) // nothing to decide: save and move on
    setChecked(t)
  }

  const step = (d: number) => setText(String(Math.max(0, (typed ?? 0) + d)))
  const v = checked === null ? null : verdict(checked, system)
  const diff = checked === null ? 0 : checked - system

  return (
    <Modal labelledBy="count-title" onClose={onClose}>
      <div className="modalbox">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="count-title">{item.description}</h2>
        <p className="muted"><span className="num">{item.code}</span>{vendor && <>, {vendor}</>}{item.barcode && <>, barcode <span className="num">{item.barcode}</span></>}</p>

        {conflict !== undefined && (
          <p className="note bad">
            {conflict ? `${conflict.updated_by ?? 'Someone'} counted this as ${conflict.counted} just now.` : 'Someone removed this count just now.'} Check it and count again.
          </p>
        )}
        {existing && conflict === undefined && <p className="note">Counted earlier: <b className="num">{existing.counted}</b>{existing.updated_by ? `, by ${existing.updated_by}` : ''}.</p>}

        {v === null || checked === null ? (
          <form onSubmit={submit}>
            {existing && (
              <div className="segmented" role="group" aria-label="What to do with the earlier count">
                <button type="button" aria-pressed={mode === 'add'} onClick={() => setMode('add')}>Add to the {existing.counted} counted</button>
                <button type="button" aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>Replace it</button>
              </div>
            )}
            <label>How many are there? <small>{existing && mode === 'add' ? 'a shelf, the back room, another bay' : 'count what you can see'}</small>
              <div className="stepper">
                <button type="button" className="btn" aria-label="One fewer" onClick={() => step(-1)} disabled={(typed ?? 0) <= 0}>−</button>
                <input ref={input} className="qty" name="counted" inputMode="numeric" autoComplete="off" aria-label="Quantity counted" aria-invalid={badQty} aria-describedby={badQty ? 'count-err' : undefined} value={text} onChange={(e) => setText(e.target.value)} />
                <button type="button" className="btn" aria-label="One more" onClick={() => step(1)}>+</button>
              </div>
            </label>
            {badQty && <p id="count-err" className="bad" role="alert">Enter a whole number, like 6. Use 0 if there are none.</p>}
            <div className="actions">
              {existing && <button type="button" className="btn danger" onClick={onRemove} disabled={busy}>Remove this count</button>}
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn primary" disabled={typed === null || busy}>{busy ? 'Saving…' : 'Check against the system'}</button>
            </div>
          </form>
        ) : (
          <>
            <dl className="facts">
              <div><dt>System says</dt><dd className="num">{fmtQty(system)}</dd></div>
              <div><dt>You counted</dt><dd className="num">{checked}</dd></div>
              <div><dt>Difference</dt><dd className="num">{fmtDiff(diff)}</dd></div>
            </dl>
            <p className="muted facts-note">{existing ? 'Compared with the stock when this item was first counted.' : syncedLabel(stock?.synced_at)}{!stock && ' This store has no stock record for the item, so the system says 0.'}</p>
            <p><span className={'chip ' + (diff < 0 ? 'bad' : 'warn')}>{fmtDiff(diff)}</span> {fmtQty(Math.abs(diff))} {diff > 0 ? 'more' : 'fewer'} than the system, worth {money(adjustValue({ counted: checked, system_qty: system, unit_cost: stock?.store_cost ?? existing?.unit_cost ?? 0 }))} at cost.</p>
            <p><b>Keep this count?</b></p>
            <div className="actions">
              <button type="button" className="btn" onClick={() => { setChecked(null); setText(''); setTimeout(() => input.current?.focus(), 0) }} disabled={busy}>No, recount</button>
              <button type="button" className="btn primary" onClick={() => onSave(checked)} disabled={busy}>{busy ? 'Saving…' : 'Yes, keep it'}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
