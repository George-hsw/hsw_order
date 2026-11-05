import { useEffect, useState } from 'react'
import { useToast } from './Toast'
import { DEMO, supabase } from './lib/supabase'

interface Props {
  name: string // who the password is for
  email: string | null // what they sign in with
  fn: string // the edge function that sets it: set-store-password or manage-user
  body: Record<string, unknown> // what that function needs besides the password (which store, or which person)
  onClose: () => void
  onDone: () => void // the password was set; refresh the list
}

/** Admin only: set a sign-in password for a store or a person. A generated one is shown once, to hand over. */
export default function PasswordDialog({ name, email, fn, body, onClose, onDone }: Props) {
  const toast = useToast()
  const [mode, setMode] = useState<'generate' | 'own'>('generate')
  const [own, setOwn] = useState('')
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<string | null>(null) // the generated password, once

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && shown === null) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy, shown])

  const ownOk = own.length >= 10 && own.length <= 72 && own === own.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'own' && !ownOk) return
    if (DEMO) {
      if (mode === 'generate') return setShown('Demo-Kp7W-9mTq-hY4R')
      toast.info('Demo mode: no password was set.')
      return onClose()
    }
    if (!supabase) return
    setBusy(true)
    const { data, error } = await supabase.functions.invoke(fn, {
      body: { ...body, password: mode === 'own' ? own : undefined },
    })
    setBusy(false)
    if (error || data?.error) {
      let msg = data?.error as string | undefined
      if (!msg && error && 'context' in error) msg = (await (error as { context: Response }).context.json().catch(() => null))?.error
      return toast.error(msg ?? 'Could not set the password.')
    }
    if (data.generated) setShown(data.password)
    else { toast.success(`Password set for ${name}.`); onDone(); onClose() }
  }

  const copy = async () => {
    if (shown === null) return
    try { await navigator.clipboard.writeText(shown); toast.success('Password copied.') }
    catch { toast.error('Could not copy. Select the password and copy it by hand.') }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pw-title">
      <div className="modalbox">
        <h2 id="pw-title">Password for {name}</h2>
        {shown !== null ? (
          <>
            <p>Give this to the person who will sign in. It is shown <b>only once</b> and cannot be looked up later, only reset.</p>
            <p className="secret" aria-label="The new password">{shown}</p>
            <p className="muted">They sign in with <b>{email}</b> and this password.</p>
            <div className="actions">
              <button type="button" className="btn" onClick={copy}>Copy password</button>
              <button type="button" className="btn primary" autoFocus onClick={() => { onDone(); onClose() }}>I have saved it</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="muted">Login email: {email}. Setting a new password replaces the old one straight away.</p>
            <div className="segmented" role="group" aria-label="How to choose the password">
              <button type="button" aria-pressed={mode === 'generate'} onClick={() => setMode('generate')}>Generate a strong one</button>
              <button type="button" aria-pressed={mode === 'own'} onClick={() => setMode('own')}>Choose my own</button>
            </div>
            {mode === 'own' && (
              <div className="grid one" style={{ marginTop: 'var(--space-md)' }}>
                <label>New password <small>10 to 72 characters</small>
                  <input name="newPassword" type="text" autoComplete="off" autoFocus value={own} onChange={(e) => setOwn(e.target.value)} />
                </label>
              </div>
            )}
            {mode === 'own' && own !== '' && !ownOk && <p className="bad">Use 10 to 72 characters, with no spaces at the start or end.</p>}
            <div className="actions" style={{ marginTop: 'var(--space-md)' }}>
              <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="btn primary" disabled={busy || (mode === 'own' && !ownOk)}>{busy ? 'Setting…' : mode === 'generate' ? 'Generate and set' : 'Set password'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
