import { useState } from 'react'
import Loading from './Loading'
import { money } from './lib/order'

export interface PrepLine { code: string; description: string; qty: number; cost: number; why: string; brief: string; hold: boolean; stock: number; moq: number }

const toQty = (text: string) => { const n = parseInt(text.replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : 0 }

/**
 * The prepared purchase order for a vendor: every item the rules say to order, with the suggested quantity filled in and a tick on each line.
 * The person changes any quantity or unticks a line, then adds the lot to the order in one go. Items whose minimum order is a very long time
 * of sales are listed unticked, for the person to decide. Nothing is saved until the button is pressed.
 */
export default function PreparedOrder({ vendor, weeks, lines, loading, busy, added, onAdd, onUndo }: {
  vendor: string; weeks: number; lines: PrepLine[]; loading: boolean; busy: boolean; added: number
  onAdd: (entries: { code: string; qty: number }[]) => void; onUndo: () => void
}) {
  const [qty, setQty] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [open, setOpen] = useState<string | null>(null)
  const valueOf = (l: PrepLine) => qty[l.code] ?? String(l.qty)
  const isOn = (l: PrepLine) => checked[l.code] ?? !l.hold
  const chosen = lines.filter((l) => isOn(l) && toQty(valueOf(l)) > 0)
  const units = chosen.reduce((a, l) => a + toQty(valueOf(l)), 0)
  const cost = chosen.reduce((a, l) => a + toQty(valueOf(l)) * l.cost, 0)
  const edited = Object.keys(qty).length > 0 || Object.keys(checked).length > 0
  const decide = lines.filter((l) => l.hold).length

  if (loading) return <Loading rows={4} />
  return (
    <section className="prepared" aria-label={`Prepared order for ${vendor}`}>
      {added > 0 && (
        <p className="note" role="status">Added {added} {added === 1 ? 'line' : 'lines'} to the order. <button type="button" className="quiet" disabled={busy} onClick={onUndo}>Undo</button></p>
      )}
      {lines.length === 0 ? (
        <div className="state"><p>Nothing needs ordering for {vendor} right now</p><p className="muted">Everything it sells is covered for {weeks} {weeks === 1 ? 'week' : 'weeks'}. Use All items to order anything yourself.</p></div>
      ) : (
        <>
          <div className="prephead">
            <div>
              <h3>Prepared order</h3>
              <p className="muted">To hold {weeks} {weeks === 1 ? 'week' : 'weeks'} of stock, from recent sales, stock, orders and waiting customers. Change any quantity or untick a line. Nothing is ordered until you copy it into NAV.</p>
            </div>
            <div className="actions">
              {edited && <button type="button" className="btn" disabled={busy} onClick={() => { setQty({}); setChecked({}) }}>Reset to suggestions</button>}
              <button type="button" className="btn primary" disabled={busy || chosen.length === 0} onClick={() => onAdd(chosen.map((l) => ({ code: l.code, qty: toQty(valueOf(l)) })))}>
                {busy ? 'Adding…' : `Add ${chosen.length} ${chosen.length === 1 ? 'line' : 'lines'} to the order`}
              </button>
            </div>
          </div>
          <p className="prepsum"><b>{chosen.length}</b> {chosen.length === 1 ? 'line' : 'lines'}, <b>{units.toLocaleString('en-AU')}</b> {units === 1 ? 'unit' : 'units'}, about <b>{money(cost)}</b> at cost.{decide > 0 && <> {decide} {decide === 1 ? 'line is' : 'lines are'} unticked for you to decide, because one minimum order lasts a very long time.</>}</p>
          <div className="tablewrap">
            <table className="book prep">
              <thead><tr><th>Item</th><th>Description</th><th className="r">In stock</th><th className="r">MOQ</th><th className="r">Suggested</th><th className="r">Order qty</th><th className="r">Cost</th></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const q = toQty(valueOf(l))
                  return (
                    <tr key={l.code} className={isOn(l) ? undefined : 'off'}>
                      <td data-label="Item" className="num">
                        <label className="tick"><input type="checkbox" checked={isOn(l)} onChange={(e) => setChecked({ ...checked, [l.code]: e.target.checked })} aria-label={`Include ${l.description}`} />{l.code}</label>
                      </td>
                      <td data-label="Description" className="desc">
                        {l.description}
                        <small className="muted">{l.brief}{l.hold && <span className="chk warn"> Your call: one MOQ lasts a long time</span>}</small>
                        <button type="button" className="quiet why" aria-expanded={open === l.code} onClick={() => setOpen(open === l.code ? null : l.code)}>{open === l.code ? 'Hide the working' : 'Why?'}</button>
                        {open === l.code && <small className="muted">{l.why}</small>}
                      </td>
                      <td data-label="In stock" className="r">{l.stock}</td>
                      <td data-label="MOQ" className="r">{l.moq}</td>
                      <td data-label="Suggested" className="r">{l.qty}</td>
                      <td data-label="Order qty" className="r">
                        <input className="qty" inputMode="numeric" autoComplete="off" aria-label={`Order quantity for ${l.description}`} value={valueOf(l)} onChange={(e) => setQty({ ...qty, [l.code]: e.target.value.replace(/\D/g, '') })} />
                      </td>
                      <td data-label="Cost" className="r">{isOn(l) && q > 0 ? money(q * l.cost) : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
