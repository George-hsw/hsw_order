import { useState } from 'react'
import { useToast } from './Toast'
import { supabase } from './lib/supabase'

const MIN = 10

/** Shown before anything else when a login was made with a temporary password: choose your own, once. */
export default function ChangePassword() {
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    if (password.length < MIN) return toast.error(`Use at least ${MIN} characters.`)
    if (password !== password.trim()) return toast.error('Remove the spaces at the start or end.')
    if (password !== again) return toast.error('The two passwords are not the same.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setBusy(false); return toast.error(/same|different/i.test(error.message) ? 'Choose a password different from the temporary one.' : 'Could not save the password. Try again.') }
    const { data: done, error: flagError } = await supabase.rpc('password_changed')
    // Either way the temporary password is finished with: end every session (this one and any other) so they sign in again with the new one.
    await supabase.auth.signOut({ scope: 'global' })
    setBusy(false)
    toast[flagError || done !== true ? 'error' : 'success'](flagError || done !== true ? 'Your password was saved, but we could not finish. Sign in with the new password.' : 'Password saved. Sign in with your new password.')
  }

  return (
    <div className="loginwrap">
      <div className="hero">
        <img className="logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="Howards Storage World" width="241" height="64" />
      </div>
      <main className="login">
        <h2>Choose your password</h2>
        <p className="muted">You signed in with a temporary password. Choose your own to carry on. Use at least {MIN} characters.</p>
        <form onSubmit={save}>
          <label>New password
            <input name="password" type="password" autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>New password again
            <input name="password2" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
          </label>
          <button type="submit" className="btn primary wide" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
          <button type="button" className="btn wide" onClick={() => supabase?.auth.signOut()}>Sign out</button>
        </form>
      </main>
    </div>
  )
}
