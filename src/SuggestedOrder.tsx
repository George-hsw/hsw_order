import { useState } from 'react'
import { money } from './lib/order'

export interface SuggestedLine { code: string; description: string; qty: number; cost: number; why: string; hold: boolean }

/**
 * The suggested order for the chosen vendor: what the rules would order, with the working for each line. Nothing is ordered until the person
 * presses Fill, and filled quantities are ordinary quantities they can change, or undo in one go.
 */
export default function SuggestedOrder({ vendor, weeks, lines, held, busy, filled, onFill, onUndo }: {
  vendor: string; weeks: number; lines: SuggestedLine[]; held: SuggestedLine[]; busy: boolean; filled: number
  onFill: () => void; onUndo: () => void
}) {
  const [open, setOpen] = useState(false)
  const units = lines.reduce((a, l) => a + l.qty, 0)
  const cost = lines.reduce((a, l) => a + l.qty * l.cost, 0)
  if (!lines.length && !held.length && !filled) return null
  return (
    <section className="sheet viz-card suggest" aria-label={`Suggested order for ${vendor}`}>
      <div className="viz-head">
        <div>
          <h2>Suggested order</h2>
          <p className="muted">To hold {weeks} {weeks === 1 ? 'week' : 'weeks'} of stock, from recent sales, stock, orders and waiting customers. Only a suggestion: nothing is ordered until you copy it into NAV.</p>
        </div>
        <div className="actions">
          {filled > 0 && <button type="button" className="btn" disabled={busy} onClick={onUndo}>Undo the {filled} filled</button>}
          <button type="button" className="btn primary" disabled={busy || !lines.length} onClick={onFill}>{busy ? 'Filling…' : `Fill ${lines.length} suggested ${lines.length === 1 ? 'quantity' : 'quantities'}`}</button>
        </div>
      </div>
      {lines.length > 0
        ? <p><b>{lines.length}</b> {lines.length === 1 ? 'item' : 'items'} to order, <b>{units.toLocaleString('en-AU')}</b> {units === 1 ? 'unit' : 'units'}, about <b>{money(cost)}</b> at cost.{held.length > 0 && <> {held.length} more {held.length === 1 ? 'needs' : 'need'} your decision.</>}</p>
        : <p className="muted">{filled > 0 ? 'The suggested quantities are filled in below.' : `Nothing to suggest for ${vendor} right now.`}{held.length > 0 && <> {held.length} {held.length === 1 ? 'item needs' : 'items need'} your decision.</>}</p>}
      {(lines.length > 0 || held.length > 0) && (
        <button type="button" className="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide the working' : 'Show the working for each line'}</button>
      )}
      {open && (
        <ul className="suglist">
          {[...lines, ...held].map((l) => (
            <li key={l.code}>
              <span><b>{l.code}</b> {l.description}<small className="muted">{l.why}</small></span>
              <span className="sugqty num">{l.hold ? <small className="chk warn">Your call: {l.qty}</small> : <>Suggest {l.qty}</>}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
