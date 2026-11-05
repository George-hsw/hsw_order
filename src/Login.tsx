import { useState } from 'react'
import { useToast } from './Toast'
import { supabase } from './lib/supabase'

const SUPPORT = 'support@hsw.com.au'

/** Sign in with your own email and password. Anyone who is stuck is sent to support. */
export default function Login() {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    setBusy(false)
    if (error) toast.error(error.status === 429 ? 'Too many attempts. Wait a few minutes and try again.' : 'That email or password is not right.')
  }

  return (
    <div className="loginwrap">
      <div className="hero">
        <img className="logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="Howards Storage World" width="241" height="64" />
      </div>
      <main className="login">
        <h2>Sign in</h2>
        <p className="muted">Use your email and password.</p>
        <form onSubmit={signIn}>
          <label>Email
            <input name="email" type="email" autoComplete="username" inputMode="email" required autoFocus value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="name@hsw.com.au" />
          </label>
          <label>Password
            <input name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" className="btn primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="muted">Unable to log in? Reach out to <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>.</p>
      </main>
    </div>
  )
}
