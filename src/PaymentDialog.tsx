import { useState } from 'react'
import Modal from './Modal'
import { useToast } from './Toast'
import { money } from './lib/quote'
import { DEMO, isoDate, supabase, type PaymentRow } from './lib/supabase'

/** The parts of a saved document the payment dialog needs, so the Builder can use it before the list is loaded. */
export interface PayDoc { id: string; doc_type: 'Quote' | 'Tax Invoice' | 'Customer Order'; doc_number: string; customer_name: string; total_cents: number; payments: PaymentRow[] }

export const paidOf = (d: { payments: { amount_cents: number }[] }) => d.payments.reduce((a, p) => a + p.amount_cents, 0)

/** Records a deposit or payment on a quote or an invoice, and emails the store's managers. */
export function PaymentDialog({ doc, onClose, onDone }: { doc: PayDoc; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const balance = doc.total_cents - paidOf(doc)
  const quote = doc.doc_type !== 'Tax Invoice' // quotes and customer orders take deposits
  const [kind, setKind] = useState<'deposit' | 'payment'>(paidOf(doc) === 0 ? 'deposit' : 'payment')
  const [amount, setAmount] = useState((balance / 100).toFixed(2))
  const [paidOn, setPaidOn] = useState(isoDate(new Date()))
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ balance_cents: number; emailed_to: string | null; warning: string } | null>(null)


  const amt = Math.round(Number(amount.replace(/[$,]/g, '')) * 100)
  const valid = Number.isFinite(amt) && amt > 0 && amt <= balance

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (DEMO) return setResult({ balance_cents: balance - amt, emailed_to: 'owner@example.com (demo, not sent)', warning: '' })
    if (!supabase || !valid) return
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('record-payment', {
      body: { document_id: doc.id, kind, amount: amt / 100, paid_on: paidOn, reference },
    })
    setBusy(false)
    if (error || data?.error) {
      let msg = data?.error as string | undefined
      if (!msg && error && 'context' in error) msg = (await (error as { context: Response }).context.json().catch(() => null))?.error
      return toast.error(msg ?? 'Could not record the payment.')
    }
    setResult(data)
  }

  return (
    <Modal labelledBy="pay-title" onClose={onClose}>
      <div className="modalbox">
        <h2 id="pay-title">{quote ? 'Record deposit for' : 'Record payment for'} {doc.doc_number}</h2>
        {result ? (
          <>
            <p className="note">Recorded. Balance due is now {money(result.balance_cents)}.</p>
            {result.emailed_to && <p>Notification emailed to <b>{result.emailed_to}</b>.</p>}
            {result.warning && <p className="note bad">{result.warning}</p>}
            <div className="actions"><button type="button" className="btn primary" data-autofocus="" onClick={onDone}>Done</button></div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="muted">{doc.customer_name}. Total {money(doc.total_cents)}, balance due {money(balance)}.</p>
            <div className="grid one">
              <label>Type
                <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as 'deposit' | 'payment')}>
                  <option value="deposit">Deposit / advance received</option>
                  <option value="payment">{quote ? 'Full payment received' : 'Payment received'}</option>
                </select>
              </label>
              <label>Amount received (AUD)<input name="amount" inputMode="decimal" autoComplete="off" data-autofocus="" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <label>Date received<input name="paidOn" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
              <label>Reference <small>optional, e.g. POS receipt no.</small><input name="reference" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
            </div>
            <p className="muted">Confirm the money has been taken through the store POS. The store managers will be emailed the amount, the balance still due and the due date.</p>
            {!valid && amount !== '' && <p className="bad">Enter an amount between $0.01 and {money(balance)}.</p>}
            <div className="actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn primary" disabled={!valid || busy}>{busy ? 'Recording…' : 'Record & notify managers'}</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}
