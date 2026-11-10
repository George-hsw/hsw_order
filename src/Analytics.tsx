import { useEffect, useMemo, useState } from 'react'
import Loading from './Loading'
import { BarList, ChartCard, ColumnChart, Legend, StatTile } from './Charts'
import { loadEvents, pruneEvents } from './lib/analytics/api'
import {
  KIND_LABEL, PERIOD_LABEL, TZ, byHour, byStore, daily, findings, periodStart, quietPeople, summarise, topErrors, userRows, type Finding, type Period,
} from './lib/analytics/model'
import { useLoad } from './lib/useLoad'
import type { AppUser, StoreRow } from './lib/supabase'
import { reveal } from './lib/motion'

const PERIODS: Period[] = ['1', '7', '30', '90']
const when = (iso: string) => (iso ? new Date(iso).toLocaleString('en-AU', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never')
const SEV: Record<Finding['severity'], { chip: string; label: string }> = { high: { chip: 'bad', label: 'Look now' }, medium: { chip: 'warn', label: 'Worth a look' }, low: { chip: '', label: 'For information' } }

/** Admin only: who is using the app, what they do, what breaks, and anything unusual. Built from the usage log (migration 013). */
export default function Analytics({ stores, people }: { stores: StoreRow[]; people: AppUser[] }) {
  const [period, setPeriod] = useState<Period>('7')
  const [allActivity, setAllActivity] = useState(false)
  // Always read back 30 days so a new device can be told from a known one, then narrow to the chosen period on screen.
  const reach = period === '90' ? 90 : 30
  const log = useLoad(() => loadEvents(new Date(Date.now() - reach * 864e5)), [reach])
  useEffect(() => { pruneEvents().catch(() => undefined) }, []) // keeps six months, quietly

  const all = log.data?.events ?? []
  const events = useMemo(() => { const from = periodStart(period).toISOString(); return all.filter((e) => e.at >= from) }, [all, period])
  const sum = useMemo(() => summarise(events), [events])
  const names = useMemo(() => new Map(stores.map((s) => [s.id, s.name])), [stores])
  const persons = useMemo(() => people.map((p) => ({ email: p.email.toLowerCase(), name: p.full_name, active: p.active })), [people])
  const days = Math.max(7, Math.min(Number(period), 30))
  const perDay = useMemo(() => daily(all, days), [all, days])
  const hours = useMemo(() => byHour(events), [events])
  const storeUse = useMemo(() => byStore(events), [events])
  const users = useMemo(() => userRows(events, persons), [events, persons])
  const quiet = useMemo(() => quietPeople(all, persons), [all, persons])
  const issues = useMemo(() => findings(all), [all])
  const errors = useMemo(() => topErrors(events), [events])
  const quietStores = useMemo(() => { const seen = new Set(storeUse.map((s) => s.store_id)); return stores.filter((s) => s.active && !seen.has(s.id)) }, [stores, storeUse])
  const dayLabel = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Analytics</h1>
          <p className="muted">Who is using the app, what they do, what goes wrong, and anything unusual. Times are Sydney time.</p>
        </div>
      </div>
      <div className="filters">
        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map((p) => <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</button>)}
        </div>
        <button type="button" className="btn" onClick={log.retry}>Refresh</button>
      </div>

      {log.failed ? (
        <div className="state error" role="alert"><p>Could not load the usage log</p><p className="muted">Has migration 013 been applied? Check your connection and try again.</p>
          <div className="actions"><button type="button" className="btn" onClick={log.retry}>Try again</button></div></div>
      ) : log.loading ? <Loading /> : (
        <div className="viz-stack" ref={reveal}>
          {log.data?.truncated && <p className="note bad">There is more activity than can be shown, so this is the newest part of the period.</p>}

          <section className="sheet viz-card">
            <div className="viz-head"><div><h2>Needs a look</h2><p className="muted">Plain rules over the last 24 hours. They point at things worth checking; none is proof of anything.</p></div></div>
            {!issues.length ? <p className="viz-empty">Nothing unusual in the last 24 hours.</p> : (
              <ul className="findings">
                {issues.map((f, i) => (
                  <li key={i}>
                    <span className={`chip ${SEV[f.severity].chip}`}>{SEV[f.severity].label}</span>
                    <div><b>{f.title}</b><p>{f.who}. {f.detail}</p></div>
                    <small>{when(f.at)}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="kpis">
            <StatTile label="People who used it" value={String(sum.users)} ly={`${persons.filter((p) => p.active).length} active accounts`} />
            <StatTile label="Sign-ins" value={String(sum.sessions)} />
            <StatTile label="Orders copied for NAV" value={String(sum.copied)} ly={`${sum.ordered} marked as ordered`} />
            <StatTile label="Orders deleted" value={String(sum.deleted)} />
            <StatTile label="Errors" value={String(sum.errors)} ly={sum.errors ? 'See below' : 'None'} />
          </div>

          <ChartCard title="Each day" sub="People who used the app and sign-ins"
            legend={<Legend items={[{ tone: 'ty', label: 'People' }, { tone: 'ly', label: 'Sign-ins' }]} />}
            table={{ head: ['Day', 'People', 'Sign-ins', 'Orders copied'], rows: perDay.slice().reverse().map((d) => [d.day, d.users, d.sessions, d.copied]) }}>
            <ColumnChart label="People and sign-ins each day" cats={perDay.map((d) => dayLabel(d.day))} fmt={(n) => String(n)} series={[{ name: 'People', tone: 'ty', values: perDay.map((d) => d.users) }, { name: 'Sign-ins', tone: 'ly', values: perDay.map((d) => d.sessions) }]} />
          </ChartCard>

          <div className="viz-two">
            <ChartCard title="Time of day" sub="Sign-ins by hour"
              table={{ head: ['Hour', 'Sign-ins'], rows: hours.map((n, h) => [`${h}:00`, n]) }}>
              <ColumnChart label="Sign-ins by hour of the day" cats={hours.map((_, h) => String(h))} fmt={(n) => String(n)} height={200} series={[{ name: 'Sign-ins', tone: 'ty', values: hours }]} />
            </ChartCard>
            <ChartCard title="Stores by activity" sub="Orders opened, copied and so on"
              table={{ head: ['Store', 'Actions', 'People', 'Orders copied', 'Last active'], rows: storeUse.map((s) => [names.get(s.store_id) ?? 'Unknown', s.events, s.users, s.copied, when(s.last)]) }}>
              <BarList rows={storeUse.slice(0, 10).map((s) => ({ key: s.store_id, label: names.get(s.store_id) ?? 'Unknown', sub: `${s.users} ${s.users === 1 ? 'person' : 'people'}, ${s.copied} copied`, value: s.events, text: String(s.events) }))} empty="No store activity in this period." />
              {quietStores.length > 0 && <p className="viz-pick">No activity from: {quietStores.map((s) => s.name).join(', ')}.</p>}
            </ChartCard>
          </div>

          <section className="sheet viz-card">
            <div className="viz-head"><div><h2>People</h2><p className="muted">Newest first</p></div></div>
            {!users.length ? <p className="viz-empty">Nobody used the app in this period.</p> : (
              <div className="tablewrap">
                <table className="viz-table cells">
                  <thead><tr><th>Person</th><th className="r">Sign-ins</th><th className="r">Orders</th><th className="r">Errors</th><th>Last seen</th><th>Device</th></tr></thead>
                  <tbody>{users.map((u) => (
                    <tr key={u.email}>
                      <td className="full" data-label="Person"><b>{u.name}</b>{u.name !== u.email && <small className="sub">{u.email}</small>}</td>
                      <td className="r s2" data-label="Sign-ins">{u.sessions}</td><td className="r s2" data-label="Orders">{u.orders}</td><td className="r s2" data-label="Errors">{u.errors || '–'}</td><td className="s3" data-label="Last seen">{when(u.last_seen)}</td><td className="s3" data-label="Device">{u.device || '–'}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            )}
            {quiet.length > 0 && <p className="viz-pick">Active accounts with no activity in the last {reach} days: {quiet.map((p) => p.name).join(', ')}.</p>}
          </section>

          <section className="sheet viz-card">
            <div className="viz-head"><div><h2>Errors</h2><p className="muted">What went wrong, most common first</p></div></div>
            {!errors.length ? <p className="viz-empty">No errors in this period.</p> : (
              <div className="tablewrap">
                <table className="viz-table cells">
                  <thead><tr><th>What happened</th><th>Where</th><th className="r">Times</th><th className="r">People</th><th>Last</th></tr></thead>
                  <tbody>{errors.map((e) => <tr key={e.message}><td className="full" data-label="What happened">{e.message}</td><td className="s3" data-label="Where">{e.where || '–'}</td><td className="r s3" data-label="Times">{e.count}</td><td className="r s3" data-label="People">{e.people}</td><td className="s3" data-label="Last">{when(e.last)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="sheet viz-card">
            <div className="viz-head"><div><h2>Recent activity</h2><p className="muted">The latest {allActivity ? 40 : 10} actions</p></div></div>
            <div className="tablewrap">
              <table className="viz-table cells">
                <thead><tr><th>When</th><th>Person</th><th>Did</th><th>Store</th></tr></thead>
                <tbody>{events.slice(0, allActivity ? 40 : 10).map((e) => (
                  <tr key={e.id}><td className="s3 o3" data-label="When">{when(e.at)}</td><td className="full o2" data-label="Person">{people.find((p) => p.email.toLowerCase() === e.email)?.full_name ?? e.email}</td>
                    <td className="full o1" data-label="Did">{KIND_LABEL[e.kind] ?? e.kind}{typeof e.detail.tab === 'string' ? `: ${e.detail.tab}` : typeof e.detail.view === 'string' ? `: ${e.detail.view}` : ''}</td><td className="s3 o4" data-label="Store">{e.store_id ? names.get(e.store_id) ?? '–' : '–'}</td></tr>))}</tbody>
              </table>
            </div>
            {!allActivity && events.length > 10 && <button type="button" className="btn" onClick={() => setAllActivity(true)}>Show the latest 40</button>}
          </section>
        </div>
      )}
    </>
  )
}
