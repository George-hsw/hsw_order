import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import Analytics from './Analytics'
import Home from './Home'
import Login from './Login'
import Order from './Order'
import Orders from './Orders'
import PriceCheck from './PriceCheck'
import Sales, { type OrderJump } from './Sales'
import Stores from './Stores'
import Tour from './Tour'
import { useToast } from './Toast'
import { api } from './lib/api'
import { installErrorTracking, startSession, track } from './lib/analytics/track'
import { AREAS, areaOf, isAreaId, visibleTabs, type AreaId, type Tab } from './lib/sections'
import { demoMembers, demoStores, demoUsers } from './lib/demo'
import { ADMIN_EMAIL, DEMO, supabase, type AppUser, type DocRow, type Member, type StoreRow } from './lib/supabase'

// The quote screens carry the PDF library, so they load only when someone opens the Quote tab.
const Builder = lazy(() => import('./Builder'))
const Documents = lazy(() => import('./Documents'))
const Reports = lazy(() => import('./Reports'))

type View = 'home' | Tab

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
  const [view, setView] = useState<View>('home') // always Home after sign-in
  const lastKey = `hsw-last-area:${email}`
  const [lastArea, setLastArea] = useState<AreaId | null>(() => { try { const v = localStorage.getItem(lastKey); return isAreaId(v) ? v : null } catch { return null } })
  const [allStores, setAllStores] = useState<StoreRow[] | null>(null)
  const [people, setPeople] = useState<AppUser[] | null>(null) // admin: everyone. everyone else: people in their stores
  const [members, setMembers] = useState<Member[]>([]) // who is in which store, and as what
  const [jump, setJump] = useState<OrderJump | null>(null) // set when the Sales tab sends someone to order an item
  const [refresh, setRefresh] = useState(0) // bumped when an order is saved so Orders reloads
  const [openDoc, setOpenDoc] = useState<DocRow | null>(null) // a quote or invoice being reopened
  const [builderKey, setBuilderKey] = useState(0) // changes to start the builder from blank
  const [docRefresh, setDocRefresh] = useState(0) // bumped when a quote is saved so Documents reloads

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

  // Usage log for the admin's Analytics tab: one sign-in per browser session, each tab opened, and any error that reaches the screen.
  useEffect(() => { startSession(); return installErrorTracking() }, [])
  useEffect(() => { track('tab_view', { tab: view === 'new' ? 'quote: new' : view === 'docs' ? 'quote: documents' : view === 'reports' ? 'quote: reports' : view }) }, [view])

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
  const sees = isAdmin || active.length > 0 // quote reports, and who created what: everyone works with their whole store
  const canPay = (storeId: string) => isAdmin || active.some((s) => s.id === storeId) // anyone in the store can take a deposit or payment
  const noAccess = allStores && !isAdmin && active.length === 0

  const goHome = () => { setJump(null); setView('home') }
  const goTab = (t: Tab) => { if (t !== 'order') setJump(null); if (t === 'new') { setOpenDoc(null); setBuilderKey((k) => k + 1) } setView(t) }
  const pickArea = (id: AreaId) => {
    try { localStorage.setItem(lastKey, id) } catch { /* ignore */ }
    setLastArea(id)
    setJump(null)
    setView(AREAS.find((a) => a.id === id)!.tabs[0].tab)
  }
  const openDocument = (d: DocRow) => { setOpenDoc(d); setBuilderKey((k) => k + 1); setView('new') }
  const tabBtn = (t: Tab, label: string) => (
    <button key={t} type="button" className="tab" data-tour={t} aria-current={view === t ? 'page' : undefined} onClick={() => goTab(t)}>{label}</button>
  )
  const area = view === 'home' ? null : areaOf(view)
  // Customer orders still to order, shown on Home so nobody forgets them.
  const [waitingCount, setWaitingCount] = useState(0)
  const activeIds = active.map((s) => s.id).join(',')
  useEffect(() => {
    if (view !== 'home' || !activeIds) return
    let live = true
    api.customerOrders(activeIds.split(',')).then((n) => live && setWaitingCount(n.length)).catch(() => live && setWaitingCount(0))
    return () => { live = false }
  }, [view, activeIds])
  const works = isAdmin || active.length > 0

  return (
    <>
      <header className="topbar">
        <div className="container bar">
          <button type="button" className="logobtn" aria-label="Home" title="Home" onClick={goHome}>
            <img className="logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="Howards Storage World" width="120" height="32" />
          </button>
          {area && (
            <nav aria-label="Main">
              <button type="button" className="tab" data-tour="home" onClick={goHome}>Home</button>
              {visibleTabs(area, works).map((t) => tabBtn(t.tab, t.label))}
            </nav>
          )}
          <div className="who">
            <span><span className="who-name">{isAdmin ? 'Admin' : me?.full_name ?? active[0]?.name ?? ''}</span><small>{email}</small></span>
            <button type="button" className="quiet help" aria-label="Take the tour" title="Take the tour" onClick={() => setTour(true)}>?</button>
            <button type="button" className="quiet" onClick={() => (DEMO ? toast.info('Demo mode: there is no sign-in.') : supabase!.auth.signOut())}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="container page">
        {!allStores || (!people && view !== 'order' && view !== 'home') ? <p className="muted">Loading…</p>
          : noAccess ? <p className="note bad">This email is not linked to an active store. Ask the admin ({ADMIN_EMAIL}).</p>
          : view === 'home' ? <Home isAdmin={isAdmin} last={lastArea} onPick={pickArea} alerts={waitingCount ? { order: `${waitingCount} customer ${waitingCount === 1 ? 'order' : 'orders'} to order` } : {}} />
          : view === 'new' ? <Suspense fallback={<p className="muted">Loading…</p>}><Builder key={builderKey} email={email} isAdmin={multi} stores={active} openDoc={openDoc} canPay={canPay} onSaved={() => setDocRefresh((r) => r + 1)} onNew={() => goTab('new')} /></Suspense>
          : view === 'docs' ? <Suspense fallback={<p className="muted">Loading…</p>}><Documents isAdmin={multi} showBy={sees} canPay={canPay} names={names} refreshKey={docRefresh} onOpen={openDocument} /></Suspense>
          : view === 'reports' && sees ? <Suspense fallback={<p className="muted">Loading…</p>}><Reports isAdmin={multi} stores={active} names={names} /></Suspense>
          : view === 'order' ? <Order key={jump ? jump.vendor + jump.item : 'order'} email={email} multi={multi} stores={active} names={names} jump={jump} onSaved={() => setRefresh((r) => r + 1)} />
          : view === 'orders' ? <Orders multi={multi} stores={active} names={names} refreshKey={refresh} />
          : view === 'price' ? <PriceCheck stores={active} multi={multi} onOrder={(j) => { setJump(j); setView('order') }} />
          : view === 'sales' ? <Sales email={email} isAdmin={isAdmin} stores={active} allStores={allStores} onOrder={(j) => { setJump(j); setView('order') }} />
          : view === 'analytics' && isAdmin ? <Analytics stores={allStores} people={people ?? []} />
          : view === 'stores' && isAdmin ? <Stores stores={allStores} people={people ?? []} members={members} onChanged={() => { loadStores(); loadPeople() }} />
          : null}
      </main>
      {tour && allStores && people && <Tour isAdmin={isAdmin} manager={active.length > 0 || isAdmin} onClose={closeTour} />}
    </>
  )
}
