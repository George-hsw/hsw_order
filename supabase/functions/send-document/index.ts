// Emails a saved quote / tax invoice (the PDF the app just built) either to the customer, with a copy to the
// store and replies going to the store, or to the store only so the store can forward it themselves.
// Needs secrets: RESEND_API_KEY, MAIL_FROM (e.g. "HSW Quotes <quotes@hsw.com.au>", a Resend-verified domain).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { cors, json } from '../_shared/cors.ts'
import { accessOf, canActOnDoc, managerEmails } from '../_shared/access.ts'

const MAX_PDF_BYTES = 3_000_000 // decoded size
const HOURLY_LIMIT = 40 // sends per signed-in user per hour: this is not a bulk mailer
const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/

const aud = (cents: number) =>
  '$' + (cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const dateAU = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof'])
const firstName = (full: string) => {
  let n = full.trim()
  if (!n) return 'there'
  if (n.includes(',')) n = n.split(',').slice(1).join(' ').trim() || n.split(',')[0].trim()
  const w = n.split(/\s+/).filter((x) => !TITLES.has(x.replace(/\./g, '').toLowerCase()))
  const f = w[0] ?? n.split(/\s+/)[0]
  return f === f.toUpperCase() || f === f.toLowerCase() ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : f
}
const safeName = (s: string) => s.replace(/[^\w\-. ]/g, '').trim() || 'document'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '')
    const { data: u } = await admin.auth.getUser(token)
    const callerEmail = u.user?.email?.toLowerCase()
    if (!callerEmail) return json({ error: 'Not signed in' }, 401)

    const b = await req.json()
    const kind = b.to === 'store' ? 'store' : 'customer'
    const pdf = typeof b.pdf_base64 === 'string' ? b.pdf_base64 : ''
    if (!pdf.startsWith('JVBERi0')) return json({ error: 'The PDF is missing or not valid' }, 400) // "%PDF-" in base64
    if (pdf.length * 0.75 > MAX_PDF_BYTES) return json({ error: 'The PDF is too large to email' }, 413)

    const { data: doc } = await admin.from('documents').select('*, stores(*)').eq('id', b.document_id).single()
    if (!doc) return json({ error: 'Document not found. Save it first.' }, 404)
    const store = doc.stores
    if (!canActOnDoc(await accessOf(admin, u.user?.id, callerEmail), doc, callerEmail))
      return json({ error: 'Not allowed for this document' }, 403)

    // Hourly limit per signed-in user
    const since = new Date(Date.now() - 3600_000).toISOString()
    const { count } = await admin.from('document_emails').select('id', { count: 'exact', head: true })
      .eq('sent_by', callerEmail).gte('sent_at', since)
    if ((count ?? 0) >= HOURLY_LIMIT) return json({ error: 'Too many emails sent this hour. Try again later.' }, 429)

    // Recipients
    const managers = await managerEmails(admin, doc.store_id)
    const storeCopy = EMAIL.test(String(store.email ?? '')) ? [String(store.email)] : managers // the store's mailbox, else its managers
    let to: string
    if (kind === 'store') {
      to = storeCopy.join(', ')
      if (!to) return json({ error: 'This store has no email or manager yet. Ask the admin to add one.' }, 400)
    } else {
      to = String(b.to_email ?? doc.customer_email ?? '').trim()
      if (!EMAIL.test(to)) return json({ error: 'Enter a valid customer email address' }, 400)
    }
    const bcc = kind === 'customer' && storeCopy.length ? storeCopy : undefined
    const replyTo = EMAIL.test(String(store.email ?? '')) ? String(store.email) : callerEmail

    // From: the configured sending address, shown under the store's name
    const mailFrom = Deno.env.get('MAIL_FROM') ?? ''
    const addr = /<([^>]+)>/.exec(mailFrom)?.[1] ?? mailFrom
    const from = `Howards Storage World ${store.name.replace(/[<>"]/g, '')} <${addr}>`

    const isInvoice = doc.doc_type === 'Tax Invoice'
    const label = isInvoice ? 'tax invoice' : 'quote'
    const subject = `${isInvoice ? 'Tax invoice' : 'Quote'} ${doc.doc_number} from Howards Storage World ${store.name}`
    const note = String(b.message ?? '').trim().slice(0, 1500)

    let balanceLine = ''
    if (isInvoice) {
      const { data: pays } = await admin.from('payments').select('amount_cents').eq('document_id', doc.id)
      const paid = (pays ?? []).reduce((a: number, p: { amount_cents: number }) => a + p.amount_cents, 0)
      const bal = doc.total_cents - paid
      balanceLine = bal > 0
        ? `<tr><td style="padding:4px 12px 4px 0;color:#6D6E71">Balance due</td><td style="padding:4px 0"><b>${aud(bal)}</b>${doc.due_date ? ` by ${dateAU(doc.due_date)}` : ''}</td></tr>`
        : `<tr><td style="padding:4px 12px 4px 0;color:#6D6E71">Balance due</td><td style="padding:4px 0"><b>Nil, paid in full</b></td></tr>`
    }
    const forwardNote = kind === 'store'
      ? `<p style="background:#f3f7f8;padding:10px 12px"><b>Copy for ${esc(store.name)}.</b> Forward this to ${esc(doc.customer_name)} when you are ready.</p>`
      : ''
    const contact = [store.phone, store.email].filter(Boolean).map((x: string) => esc(x)).join('<br>')
    const html = `<div style="font-family:Arial,sans-serif;color:#262626;max-width:560px;line-height:1.5">
  <div style="border-bottom:3px solid #0092A9;padding-bottom:8px;font-size:18px">Howards Storage World ${esc(store.name)}</div>
  ${forwardNote}
  <p>Hi ${esc(firstName(doc.customer_name))},</p>
  <p>Please find your ${label} <b>${esc(doc.doc_number)}</b> attached as a PDF.</p>
  ${note ? `<p style="white-space:pre-wrap">${esc(note)}</p>` : ''}
  <table style="border-collapse:collapse;margin:8px 0">
    <tr><td style="padding:4px 12px 4px 0;color:#6D6E71">${isInvoice ? 'Invoice' : 'Quote'}</td><td style="padding:4px 0">${esc(doc.doc_number)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6D6E71">Total (incl GST)</td><td style="padding:4px 0"><b>${aud(doc.total_cents)}</b></td></tr>
    ${balanceLine}
  </table>
  <p>If you have any questions, reply to this email${store.phone ? ` or call us on ${esc(store.phone)}` : ''}.</p>
  <p style="color:#6D6E71;font-size:13px">Howards Storage World ${esc(store.name)}<br>${contact}</p></div>`
    const text = `${kind === 'store' ? `Copy for ${store.name}. Forward this to ${doc.customer_name} when you are ready.\n\n` : ''}Hi ${firstName(doc.customer_name)},\n\nPlease find your ${label} ${doc.doc_number} attached as a PDF.\n${note ? `\n${note}\n` : ''}\nTotal (incl GST): ${aud(doc.total_cents)}\n\nIf you have any questions, reply to this email${store.phone ? ` or call us on ${store.phone}` : ''}.\n\nHowards Storage World ${store.name}${store.phone ? `\nPhone: ${store.phone}` : ''}${store.email ? `\nEmail: ${store.email}` : ''}`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from, to: to.split(', '), bcc, reply_to: replyTo, subject, html, text,
        attachments: [{ filename: `${safeName(`${doc.doc_number} ${doc.customer_name}`)}.pdf`, content: pdf }],
      }),
    })
    const ok = res.ok
    const err = ok ? null : (await res.text()).slice(0, 500)
    await admin.from('document_emails').insert({
      document_id: doc.id, store_id: doc.store_id, kind, sent_to: to, sent_by: callerEmail, error: err,
    })
    if (!ok) return json({ error: 'The email could not be sent. Check the sending domain settings.' }, 502)
    return json({ ok: true, sent_to: to, bcc: bcc?.[0] ?? null })
  } catch (e) {
    console.error(e)
    return json({ error: 'Something went wrong sending the email' }, 500)
  }
})
