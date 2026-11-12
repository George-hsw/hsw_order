import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import Loading from './Loading'
import type { Session } from '@supabase/supabase-js'
import Analytics from './Analytics'
import Home from './Home'
import Login from './Login'
import Notifications from './Notifications'
import Order from './Order'
import Orders from './Orders'
import PriceCheck from './PriceCheck'
import Sales, { type OrderJump } from './Sales'
import Stores from './Stores'
import Tour from './Tour'
import { useToast } from './Toast'
import { api } from './lib/api'
import { useNotices } from './lib/useNotices'
import type { Target } from './lib/notifications'
import { installErrorTracking, startSession, track } from './lib/analytics/track'
import { AREAS, areaOf, isAreaId, visibleTabs, type AreaId, type Tab } from './lib/sections'
import { demoMembers, demoStores, demoUsers } from './lib/demo'
import { ADMIN_EMAIL, DEMO, supabase, type AppUser, type DocRow, type Member, type StoreRow } from './lib/supabase'
import type { Line } from './lib/quote'
import { useIdleSignOut } from './lib/useIdleSignOut'

// The quote screens carry the PDF library, so they load only when someone opens the Quote tab.
const Builder = lazy(() => import('./Builder'))
const Documents = lazy(() => import('./Documents'))
const Reports = lazy(() => import('./Reports'))
const Tansel = lazy(() => import('./Tansel')) // carries the Tansel packer table, so it loads only when opened

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
  if (DEMO) { const as = new URLSearchParams(location.search).get('as'); return <Shell session={{ user: { email: as ? `${as}@hsw.com.au` : ADMIN_EMAIL } } as Session} /> } // ?as=priya: see the demo as a store manager, not the admin
  if (!supabase) {
    return (
      <main className="login">
        <h1>Setup needed</h1>
        <p>This build has no Supabase connection. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see README).</p>
      </main>
    )
  }
  if (session === undefined) return <main className="container page"><Loading /></main>
  if (!session) return <Login />
  return <Shell session={session} />
}

function Shell({ session }: { session: Session }) {
  const toast = useToast()
  useIdleSignOut(!DEMO, (m) => toast.info(`This device has been idle. You will be signed out in about ${m} ${m === 1 ? 'minute' : 'minutes'}. Tap or press anything to stay signed in.`))
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
  const [salesStart, setSalesStart] = useState<{ storeId: string; code: string } | null>(null) // an item sent to Sales from Price check
  const [seed, setSeed] = useState<Line[] | null>(null) // lines a new quote starts with, from the Tansel finder
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
    if (DEMO) {
      const all = demoStores()
      if (isAdmin) return setAllStores(all)
      const me = demoUsers().find((u) => u.email === email)
      const mine = new Set(demoMembers().filter((m) => m.user_id === me?.user_id).map((m) => m.store_id))
      return setAllStores(all.filter((s) => mine.has(s.id)))
    }
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

  const notices = useNotices({ isAdmin, stores: active, refreshKey: refresh + docRefresh })
  // A notice's button: straight to the screen, and for the Order tab to the vendor and filter.
  const goTarget = (t: Target) => {
    if (t.view === 'order' && t.vendor) setJump({ storeId: t.storeId ?? active[0]?.id ?? '', vendor: t.vendor, item: '', show: t.show })
    else setJump(null)
    setView(t.view)
  }
  const goHome = () => { setJump(null); setView('home') }
  const goTab = (t: Tab) => { if (t !== 'order') setJump(null); if (t === 'sales') setSalesStart(null); if (t === 'new') { setOpenDoc(null); setSeed(null); setBuilderKey((k) => k + 1) } setView(t) }
  const quoteFrom = (lines: Line[]) => { setOpenDoc(null); setSeed(lines); setBuilderKey((k) => k + 1); setView('new') }
  const pickArea = (id: AreaId) => {
    try { localStorage.setItem(lastKey, id) } catch { /* ignore */ }
    setLastArea(id)
    setJump(null)
    setSalesStart(null)
    setView(AREAS.find((a) => a.id === id)!.tabs[0].tab)
  }
  const openDocument = (d: DocRow) => { setOpenDoc(d); setBuilderKey((k) => k + 1); setView('new') }
  const tabBtn = (t: Tab, label: string) => (
    <button key={t} type="button" className="tab" data-tour={t} aria-current={view === t ? 'page' : undefined} onClick={() => goTab(t)}>{label}</button>
  )
  const area = view === 'home' ? null : areaOf(view)
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
            {active.length > 0 && <Notifications shown={notices.shown} count={notices.count} urgent={notices.urgent} loading={notices.loading} partial={notices.partial} onHide={notices.hide} onGo={goTarget} onReload={notices.reload} />}
            <button type="button" className="quiet help" aria-label="Take the tour" title="Take the tour" onClick={() => setTour(true)}>?</button>
            <button type="button" className="quiet" onClick={() => (DEMO ? toast.info('Demo mode: there is no sign-in.') : supabase!.auth.signOut())}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="container page">
        <div className={view === 'home' ? undefined : 'screen'} key={view}>
        {!allStores || (!people && view !== 'order' && view !== 'home') ? <Loading />
          : noAccess ? <p className="note bad">This email is not linked to an active store. Ask the admin ({ADMIN_EMAIL}).</p>
          : view === 'home' ? <Home isAdmin={isAdmin} last={lastArea} onPick={pickArea} />
          : view === 'new' ? <Suspense fallback={<Loading />}><Builder key={builderKey} seed={seed} email={email} isAdmin={multi} stores={active} openDoc={openDoc} canPay={canPay} onSaved={() => setDocRefresh((r) => r + 1)} onNew={() => goTab('new')} /></Suspense>
          : view === 'docs' ? <Suspense fallback={<Loading />}><Documents isAdmin={multi} showBy={sees} canPay={canPay} names={names} refreshKey={docRefresh} onOpen={openDocument} /></Suspense>
          : view === 'reports' && sees ? <Suspense fallback={<Loading />}><Reports isAdmin={multi} stores={active} names={names} /></Suspense>
          : view === 'order' ? <Order key={jump ? jump.vendor + jump.item + (jump.show ?? '') : 'order'} email={email} multi={multi} stores={active} names={names} jump={jump} canManage={(storeId) => isAdmin || (members ?? []).some((m) => m.user_id === session.user.id && m.store_id === storeId && m.role === 'manager')} onSaved={() => setRefresh((r) => r + 1)} />
          : view === 'orders' ? <Orders multi={multi} stores={active} names={names} refreshKey={refresh} />
          : view === 'price' ? <PriceCheck stores={active} multi={multi} onQuote={quoteFrom} onOrder={(j) => { setJump(j); setView('order') }} onSales={(storeId, code) => { setSalesStart({ storeId, code }); setView('sales') }} />
          : view === 'tansel' ? <Suspense fallback={<Loading />}><Tansel stores={active} multi={multi} draftKey={`hsw-quote-draft:${email}`} onQuote={quoteFrom} /></Suspense>
          : view === 'sales' ? <Sales key={salesStart ? `${salesStart.storeId}:${salesStart.code}` : 'sales'} start={salesStart} email={email} isAdmin={isAdmin} stores={active} allStores={allStores} onOrder={(j) => { setJump(j); setView('order') }} />
          : view === 'analytics' && isAdmin ? <Analytics stores={allStores} people={people ?? []} />
          : view === 'stores' && isAdmin ? <Stores stores={allStores} people={people ?? []} members={members} onChanged={() => { loadStores(); loadPeople() }} />
          : null}
        </div>
      </main>
      {tour && allStores && people && <Tour isAdmin={isAdmin} manager={active.length > 0 || isAdmin} onClose={closeTour} />}
    </>
  )
}
