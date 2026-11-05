import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import Login from './Login'
import Order from './Order'
import Orders from './Orders'
import Reports from './Reports'
import Stores from './Stores'
import Tour from './Tour'
import { useToast } from './Toast'
import { demoMembers, demoStores, demoUsers } from './lib/demo'
import { ADMIN_EMAIL, DEMO, supabase, type AppUser, type Member, type StoreRow } from './lib/supabase'

type Tab = 'order' | 'orders' | 'reports' | 'stores'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined) // undefined = still checking
  useEffect(() => {
    if (DEMO || !supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (DEMO && location.search.includes('login')) return <Login /> // preview the sign-in screen
  if (DEMO) return <Shell session={{ user: { email: ADMIN_EMAIL } } as Session} />
  if (!supabase) {
    return (
      <main className="login">
        <h1>Setup needed</h1>
        <p>This build has no Supabase connection. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see README).</p>
      </main>
    )
  }
  if (session === undefined) return <main className="container page"><p className="muted">Loading…</p></main>
  if (!session) return <Login />
  return <Shell session={session} />
}

function Shell({ session }: { session: Session }) {
  const toast = useToast()
  const email = (session.user.email ?? '').toLowerCase()
  const isAdmin = email === ADMIN_EMAIL
  const [tab, setTab] = useState<Tab>('order')
  const [allStores, setAllStores] = useState<StoreRow[] | null>(null)
  const [people, setPeople] = useState<AppUser[] | null>(null) // admin: everyone. everyone else: people in their stores
  const [members, setMembers] = useState<Member[]>([]) // who is in which store, and as what
  const [refresh, setRefresh] = useState(0) // bumped when an order is saved so Orders and Reports reload

  // The tour is shown once per account. The account remembers it (user_metadata), so a new phone or browser does not
  // show it again; the browser copy covers accounts that finished it before this existed.
  const tourKey = `hsw-orders-tour-v1:${email}`
  const seenOnAccount = session.user.user_metadata?.tour_seen === true
  const seenOnDevice = (() => { try { return localStorage.getItem(tourKey) === '1' } catch { return false } })()
  const [tour, setTour] = useState(() => (DEMO ? location.search.includes('tour') : !(seenOnAccount || seenOnDevice)))
  const markSeen = useCallback(() => {
    try { localStorage.setItem(tourKey, '1') } catch { /* ignore */ }
    if (!DEMO && supabase) void supabase.auth.updateUser({ data: { tour_seen: true } })
  }, [tourKey])
  const closeTour = () => { setTour(false); if (!seenOnAccount) markSeen() }
  useEffect(() => { if (seenOnDevice && !seenOnAccount) markSeen() }, [seenOnDevice, seenOnAccount, markSeen])

  const loadStores = useCallback(async () => {
    if (DEMO) return setAllStores(demoStores())
    const { data } = await supabase!.from('stores').select('*').order('name')
    setAllStores((data ?? []) as StoreRow[])
  }, [])
  useEffect(() => { loadStores() }, [loadStores])

  const loadPeople = useCallback(async () => {
    if (DEMO) { setMembers(demoMembers()); return setPeople(demoUsers()) }
    const [u, m] = await Promise.all([
      supabase!.from('app_users').select('*').order('full_name'),
      supabase!.from('store_members').select('user_id,store_id,role'),
    ])
    setMembers((m.data ?? []) as Member[])
    setPeople((u.data ?? []) as AppUser[])
  }, [])
  useEffect(() => { loadPeople() }, [loadPeople])

  const me = (people ?? []).find((p) => p.user_id === session.user.id)
  const active = (allStores ?? []).filter((s) => s.active) // Row Level Security already limits this to the person's own stores
  const multi = isAdmin || active.length > 1 // may pick the store
  const names = Object.fromEntries((people ?? []).map((p) => [p.email.toLowerCase(), p.full_name]))
  const noAccess = allStores && !isAdmin && active.length === 0

  const tabBtn = (t: Tab, label: string) => (
    <button type="button" className="tab" data-tour={t} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>{label}</button>
  )

  return (
    <>
      <header className="topbar">
        <div className="container bar">
          <img className="logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="Howards Storage World" width="120" height="32" />
          <nav aria-label="Main">
            {tabBtn('order', 'Order')}
            {tabBtn('orders', 'Orders')}
            {tabBtn('reports', 'Reports')}
            {isAdmin && tabBtn('stores', 'Stores')}
          </nav>
          <div className="who">
            <span><span className="who-name">{isAdmin ? 'Admin' : me?.full_name ?? active[0]?.name ?? ''}</span><small>{email}</small></span>
            <button type="button" className="quiet help" aria-label="Take the tour" title="Take the tour" onClick={() => setTour(true)}>?</button>
            <button type="button" className="quiet" onClick={() => (DEMO ? toast.info('Demo mode: there is no sign-in.') : supabase!.auth.signOut())}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="container page">
        {!allStores || !people ? <p className="muted">Loading…</p>
          : noAccess ? <p className="note bad">This email is not linked to an active store. Ask the admin ({ADMIN_EMAIL}).</p>
          : tab === 'order' ? <Order email={email} multi={multi} stores={active} names={names} onSaved={() => setRefresh((r) => r + 1)} />
          : tab === 'orders' ? <Orders multi={multi} stores={active} names={names} refreshKey={refresh} />
          : tab === 'reports' ? <Reports multi={multi} stores={active} names={names} refreshKey={refresh} />
          : tab === 'stores' && isAdmin ? <Stores stores={allStores} people={people} members={members} onChanged={() => { loadStores(); loadPeople() }} />
          : null}
      </main>
      {tour && allStores && people && <Tour isAdmin={isAdmin} manager={active.length > 0 || isAdmin} onClose={closeTour} />}
    </>
  )
}
