import { useConfirm } from './Confirm'
import { useToast } from './Toast'
import { DEMO, supabase } from './lib/supabase'
import { visibleAreas, type AreaId } from './lib/sections'

// One simple line drawing for each area, in the same stroke as the other icons (24 x 24, currentColor).
const ICON: Record<AreaId, string> = {
  quote: 'M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6',
  order: 'M3 8l9-5 9 5v8l-9 5-9-5z M3 8l9 5 9-5 M12 13v8',
  stocktake: 'M9 4h6l1 2h3v14H5V6h3z M9 13l2 2 4-4',
  price: 'M3 12V4h8l10 10-8 8z M7.5 7.5h.01',
  sales: 'M4 20h16 M7 20v-7 M12 20V6 M17 20v-9',
  admin: 'M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 5v4 M6 15v4',
}

/** What opens after sign-in: one tile for each area the person can use. The one they used last is marked. */
export default function Home({ isAdmin, last, onPick }: { isAdmin: boolean; last: AreaId | null; onPick: (id: AreaId) => void }) {
  const [ask, dialog] = useConfirm()
  const toast = useToast()
  const signOutEverywhere = async () => {
    if (DEMO || !supabase) return toast.info('Demo mode: there is no sign-in.')
    if (!(await ask({ title: 'Sign out of every device?', body: 'This phone, this computer and any other device you are signed in on will be signed out. You will need your password to sign in again.', confirmLabel: 'Sign out everywhere', danger: true }))) return
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) toast.error('Could not sign you out of the other devices. Try again.')
  }
  return (
    <div className="homepage">
      <div className="pagehead">
        <div>
          <h1>Home</h1>
          <p className="muted">Choose what you want to do.</p>
        </div>
      </div>
      <div className="hometiles">
        {visibleAreas(isAdmin).map((a) => (
          <button key={a.id} type="button" className={`flagbtn hometile${last === a.id ? ' last' : ''}`} data-tour={a.id} onClick={() => onPick(a.id)}>
            <span className="tileicon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[a.id]} /></svg>
            </span>
            <b>{a.label}</b>
            <span>{a.blurb}</span>
            {last === a.id && <small className="muted">Last used</small>}
          </button>
        ))}
      </div>
      <details className="storedetails security">
        <summary>Account security</summary>
        <p className="muted">Lost a phone, or shared your login by mistake? Sign out of every device at once. Devices are also signed out by themselves after 2 hours without use.</p>
        <div className="actions"><button type="button" className="btn" onClick={() => void signOutEverywhere()}>Sign out of every device</button></div>
      </details>
      {dialog}
    </div>
  )
}
