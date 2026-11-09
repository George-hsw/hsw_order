// Records a payment / deposit against a Quote (an advance) or a Tax Invoice, then emails the store's managers:
// what was received, the balance still due, and the due date.
// Needs secrets: RESEND_API_KEY, MAIL_FROM (e.g. "HSW Quotes <quotes@hsw.com.au>")
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from '../_shared/cors.ts'
import { accessOf, canTakePayment, managerEmails } from '../_shared/access.ts'

const aud = (cents: number) =>
  '$' + (cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const dateAU = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

    // Who is calling?
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '')
    const { data: u } = await admin.auth.getUser(token)
    const callerEmail = u.user?.email?.toLowerCase()
    if (!callerEmail) return json({ error: 'Not signed in' }, 401)

    const b = await req.json()
    const amountCents = Math.round(Number(b.amount) * 100)
    const kind = b.kind === 'deposit' ? 'deposit' : 'payment'
    if (!Number.isFinite(amountCents) || amountCents <= 0) return json({ error: 'Enter an amount greater than $0' }, 400)
    const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(b.paid_on ?? '') ? b.paid_on : new Date().toISOString().slice(0, 10)

    const { data: doc } = await admin.from('documents').select('*, stores(*)').eq('id', b.document_id).single()
    if (!doc) return json({ error: 'Document not found' }, 404)
    const store = doc.stores
    if (!canTakePayment(await accessOf(admin, u.user?.id, callerEmail), doc))
      return json({ error: 'Not allowed for this document' }, 403)
    if (doc.status === 'void') return json({ error: 'This document is void' }, 400)
    const what = doc.doc_type === 'Quote' ? 'Quote' : doc.doc_type === 'Customer Order' ? 'Customer order' : 'Invoice'

    const { data: prior } = await admin.from('payments').select('amount_cents').eq('document_id', doc.id)
    const paidBefore = (prior ?? []).reduce((a, p) => a + p.amount_cents, 0)
    const balanceBefore = doc.total_cents - paidBefore
    if (amountCents > balanceBefore)
      return json({ error: `That is more than the balance due (${aud(balanceBefore)})` }, 400)

    const { data: pay, error: pe } = await admin.from('payments').insert({
      document_id: doc.id, store_id: doc.store_id, kind, amount_cents: amountCents,
      paid_on: paidOn, reference: b.reference?.toString().slice(0, 200) || null, recorded_by: callerEmail,
    }).select('id').single()
    if (pe) throw pe

    const paid = paidBefore + amountCents
    const balance = doc.total_cents - paid
    await admin.from('documents').update({ status: balance === 0 ? 'paid' : 'part_paid' }).eq('id', doc.id)

    // ---- notify the store's managers (else the store's own email) ----
    const managers = await managerEmails(admin, doc.store_id)
    const to = managers.length ? managers : store.email ? [String(store.email)] : []
    let emailed = false
    let warning = ''
    if (to.length === 0) {
      warning = 'This store has no manager yet, so no notification was sent. Add one on the Stores tab.'
    } else {
      const label = kind === 'deposit' ? 'Deposit received' : 'Payment received'
      const subject =
        `${label} – ${doc.doc_number} – ${aud(amountCents)}` +
        (balance > 0 ? ` (balance ${aud(balance)})` : ' (paid in full)')
      const row = (k: string, v: string, bold = false) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6D6E71">${k}</td><td style="padding:6px 0;${bold ? 'font-weight:700;font-size:16px' : ''}">${v}</td></tr>`
      const html = `<div style="font-family:Arial,sans-serif;color:#262626;max-width:520px">
  <div style="border-bottom:3px solid #0092A9;padding-bottom:8px;font-size:18px">Howards Storage World – ${esc(store.name)}</div>
  <p style="font-size:16px"><b>${label}</b> on ${esc(doc.doc_number)}</p>
  <table style="border-collapse:collapse">
    ${row('Customer', esc(doc.customer_name))}
    ${row(kind === 'deposit' ? 'Deposit received' : 'Payment received', aud(amountCents), true)}
    ${row('Received on', dateAU(paidOn))}
    ${b.reference ? row('Reference', esc(String(b.reference))) : ''}
    ${row(`${what} total`, aud(doc.total_cents))}
    ${row('Total paid so far', aud(paid))}
    ${row('Balance due', balance > 0 ? aud(balance) : 'Nil – paid in full', true)}
    ${balance > 0 && doc.due_date ? row('Due date', dateAU(doc.due_date), true) : ''}
  </table>
  <p style="color:#6D6E71;font-size:12px">Recorded by ${esc(callerEmail)}. Automatic message from the HSW Quote &amp; Invoice Builder.</p></div>`
      const text =
        `${label} on ${doc.doc_number}\nCustomer: ${doc.customer_name}\nReceived: ${aud(amountCents)} on ${dateAU(paidOn)}\n` +
        `${what} total: ${aud(doc.total_cents)}\nPaid so far: ${aud(paid)}\nBalance due: ${balance > 0 ? aud(balance) : 'Nil'}` +
        (balance > 0 && doc.due_date ? `\nDue date: ${dateAU(doc.due_date)}` : '')

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: Deno.env.get('MAIL_FROM'), to, subject, html, text }),
      })
      if (res.ok) {
        emailed = true
        await admin.from('payments').update({ emailed_at: new Date().toISOString() }).eq('id', pay.id)
      } else {
        warning = 'Payment recorded, but the notification email failed to send.'
        await admin.from('payments').update({ email_error: (await res.text()).slice(0, 500) }).eq('id', pay.id)
      }
    }
    return json({ ok: true, paid_cents: paid, balance_cents: balance, emailed, emailed_to: emailed ? to.join(', ') : null, warning })
  } catch (e) {
    console.error(e)
    return json({ error: 'Something went wrong recording the payment' }, 500)
  }
})
