import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { QuoteInput } from './quote'
import { DEMO, supabase } from './supabase'

// One live draft per person, shared by every device they are signed in on. See migration 015_quote_drafts.sql.
const SOURCE = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random()) // this browser, to ignore its own echo
const PUSH_DELAY = 400 // ms of quiet before a change is sent
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Three-way merge. `base` is what both devices last agreed on, `local` is this device now, `remote` is what the other
 * device just sent. A field changed here keeps this device's value, anything else takes the other device's. So typing a
 * customer name on the computer and scanning an item on the phone at the same moment keep both.
 */
export function mergeQuotes(base: QuoteInput, local: QuoteInput, remote: QuoteInput): QuoteInput {
  const out = { ...remote } as QuoteInput
  for (const k of Object.keys(local) as (keyof QuoteInput)[]) {
    if (k === 'lines' || k === 'customer') continue
    if (!same(local[k], base[k])) (out as unknown as Record<string, unknown>)[k] = local[k]
  }
  out.customer = { ...remote.customer }
  for (const k of Object.keys(local.customer) as (keyof QuoteInput['customer'])[]) {
    if (!same(local.customer[k], base.customer[k])) out.customer[k] = local.customer[k]
  }
  out.lines = remote.lines.map((rl, i) => (same(local.lines[i], base.lines[i]) ? rl : local.lines[i] ?? rl))
  return out
}

let quiet = 0 // set when this device removes the draft itself, so it does not react to its own delete

/** The draft is finished (saved as a document, or cleared on purpose): remove it for every device. */
export async function clearRemoteDraft(): Promise<void> {
  if (DEMO || !supabase) return
  quiet = Date.now() + 4000
  const { data } = await supabase.auth.getSession()
  if (data.session) await supabase.from('quote_drafts').delete().eq('user_id', data.session.user.id)
}

interface Opts {
  enabled: boolean // a new, unsaved quote: not editing a saved document
  quote: QuoteInput
  setQuote: Dispatch<SetStateAction<QuoteInput>>
  normalise: (d: Partial<QuoteInput> | undefined) => QuoteInput
  draftKey: string // the localStorage key of this device's copy; `${draftKey}:at` holds when it last changed
}

/** Keeps the quote on screen in step with the same person's other devices, live. */
export function useDraftSync({ enabled, quote, setQuote, normalise, draftKey }: Opts) {
  const quoteRef = useRef(quote)
  quoteRef.current = quote
  const base = useRef<QuoteInput | null>(null) // what both devices last agreed on
  const ready = useRef(false)
  const uid = useRef('')
  const normaliseRef = useRef(normalise)
  normaliseRef.current = normalise

  /** Send this device's quote if it differs from what both devices last agreed on. */
  const push = useRef(async () => {})
  push.current = async () => {
    if (!supabase || !ready.current || !uid.current) return
    const sending = quoteRef.current
    if (base.current ? same(sending, base.current) : same(sending, normaliseRef.current(undefined))) return // nothing to say
    const { error } = await supabase.from('quote_drafts').upsert({ user_id: uid.current, payload: sending, source: SOURCE, updated_at: new Date().toISOString() })
    if (!error) base.current = sending
  }

  // Start up: take the shared draft if it is newer than this device's, then listen for changes.
  useEffect(() => {
    if (!enabled || DEMO || !supabase) return
    const sb = supabase
    let stopped = false
    let channel: ReturnType<typeof sb.channel> | undefined
    ready.current = false

    const adopt = (remote: QuoteInput) => {
      const local = quoteRef.current
      const next = base.current && !same(local, base.current) ? mergeQuotes(base.current, local, remote) : remote
      base.current = remote
      if (!same(next, local)) setQuote(next)
    }

    ;(async () => {
      const { data: s } = await sb.auth.getSession()
      if (!s.session || stopped) return
      uid.current = s.session.user.id
      const { data: row } = await sb.from('quote_drafts').select('payload,updated_at,source').eq('user_id', uid.current).maybeSingle()
      if (stopped) return
      if (row) {
        const remote = normaliseRef.current(row.payload as Partial<QuoteInput>)
        let localAt = 0
        try { localAt = Number(localStorage.getItem(`${draftKey}:at`)) || 0 } catch { /* ignore */ }
        if (new Date(row.updated_at as string).getTime() >= localAt) adopt(remote) // the shared one is newer
        else base.current = remote // this device is newer: it is sent below
      }
      ready.current = true
      void push.current() // the first send, if this device has something the shared draft does not
      channel = sb.channel(`draft-${uid.current}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_drafts', filter: `user_id=eq.${uid.current}` }, (p) => {
          if (p.eventType === 'DELETE') {
            if (Date.now() < quiet) return // we removed it ourselves
            // finished or cleared on another device: start this one fresh too
            base.current = null
            try { localStorage.removeItem(draftKey); localStorage.removeItem(`${draftKey}:at`) } catch { /* ignore */ }
            setQuote(normaliseRef.current(undefined))
            return
          }
          const r = p.new as { payload: Partial<QuoteInput>; source: string }
          if (r.source !== SOURCE) adopt(normaliseRef.current(r.payload))
        })
        .subscribe()
    })()

    // A phone that was asleep catches up as soon as it is looked at again.
    const onVisible = async () => {
      if (document.visibilityState !== 'visible' || !uid.current) return
      const { data: row } = await sb.from('quote_drafts').select('payload,source').eq('user_id', uid.current).maybeSingle()
      if (row && (row.source as string) !== SOURCE) adopt(normaliseRef.current(row.payload as Partial<QuoteInput>))
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      if (channel) void sb.removeChannel(channel)
    }
  }, [enabled, draftKey, setQuote])

  // Send each change once things have been quiet for a moment.
  useEffect(() => {
    if (!enabled || DEMO || !supabase) return
    const t = setTimeout(() => void push.current(), PUSH_DELAY)
    return () => clearTimeout(t)
  }, [quote, enabled])
}
