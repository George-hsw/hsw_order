import { useEffect, useState } from 'react'
import { useConfirm } from './Confirm'
import PasswordDialog from './PasswordDialog'
import StorePanel from './StorePanel'
import { useToast } from './Toast'
import { api } from './lib/api'
import { isStale } from './lib/order'
import { ADMIN_EMAIL, DEMO, MAX_STORES, supabase, type AppUser, type Member, type StoreRow, type SyncRun } from './lib/supabase'

interface Props {
  stores: StoreRow[] // all stores, including inactive
  people: AppUser[]
  members: Member[]
  isOwner: boolean // the main admin: the only one who adds or removes admins
  onChanged: () => void
}

/** Admin only. Pick a store to see and change who is in it; the last NAV sync for each store shows beside it. */
export default function Stores({ stores, people, members, isOwner, onChanged }: Props) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [adminEmail, setAdminEmail] = useState('')
  const [adminName, setAdminName] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState<{ email: string; name: string } | null>(null) // a new person made an admin: the password dialog creates them
  const admins = people.filter((p) => p.is_admin).sort((a, b) => a.full_name.localeCompare(b.full_name))
  const known = people.find((p) => p.email.toLowerCase() === adminEmail.trim().toLowerCase())
  const isMain = adminEmail.trim().toLowerCase() === ADMIN_EMAIL
  const [openId, setOpenId] = useState<string | 'new' | null>(null)
  const [runs, setRuns] = useState<SyncRun[] | null>(null)
  const [runsFailed, setRunsFailed] = useState(false)
  const activeCount = stores.filter((s) => s.active).length
  const inStore = (id: string) => members.filter((m) => m.store_id === id)
  const managersOf = (id: string) =>
    inStore(id).filter((m) => m.role === 'manager').map((m) => people.find((p) => p.user_id === m.user_id)).filter((p): p is AppUser => !!p && p.active)
  const open = openId && openId !== 'new' ? stores.find((s) => s.id === openId) ?? null : null

  useEffect(() => {
    let live = true
    api.syncRuns().then((r) => live && setRuns(r)).catch(() => live && setRunsFailed(true))
    return () => { live = false }
  }, [])

  const call = async (body: Record<string, unknown>): Promise<boolean> => {
    if (DEMO) { toast.info('Demo mode: changes are not saved.'); return false }
    if (!supabase) return false
    const { data, error } = await supabase.functions.invoke('manage-user', { body })
    if (error || data?.error) {
      let msg = data?.error as string | undefined
      if (!msg && error && 'context' in error) msg = (await (error as { context: Response }).context.json().catch(() => null))?.error
      toast.error(msg ?? 'Could not save. Try again.')
      return false
    }
    return true
  }

  const addAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    const email = adminEmail.trim().toLowerCase()
    if (!email || isMain || known?.is_admin) return
    if (!known) return setCreating({ email, name: adminName.trim() }) // a new person: the password dialog makes their login
    if (!(await ask({
      title: `Make ${known.full_name} an admin?`,
      body: <p>They will see and change everything in every store, including people, stores, sales and analytics. They keep their password.</p>,
      confirmLabel: 'Make admin',
    }))) return
    setBusy(true)
    const ok = await call({ action: 'set_admin', email, admin: true })
    setBusy(false)
    if (!ok) return
    toast.success(`${known.full_name} is now an admin.`)
    setAdminEmail(''); setAdminName(''); onChanged()
  }

  const removeAdmin = async (p: AppUser) => {
    if (!(await ask({
      title: `Remove ${p.full_name} as an admin?`,
      body: <p>They keep their login and go back to only the stores they belong to. If they belong to none, they can no longer use the app until you add them to a store.</p>,
      confirmLabel: 'Remove admin',
    }))) return
    if (await call({ action: 'set_admin', user_id: p.user_id, admin: false })) { toast.success(`${p.full_name} is no longer an admin.`); onChanged() }
  }

  const syncCell = (id: string) => {
    if (runsFailed) return <span className="muted">Unknown</span>
    if (!runs) return <span className="muted">…</span>
    const r = runs.find((x) => x.store_id === id)
    if (!r) return <span className="chip warn">Never synced</span>
    const time = new Date(r.finished_at).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    if (!r.ok) return <><span className="chip bad">Failed</span> <small>{time}</small>{r.message && <small>{r.message}</small>}</>
    return isStale(r.finished_at) ? <><span className="chip warn">Out of date</span> <small>{time}</small></> : <><span className="chip paid">Synced</span> <small>{time}</small></>
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Stores</h1>
          <p className="muted">Using {activeCount} of {MAX_STORES} active stores. Open a store to add people, choose what each can do, and edit its details. The last NAV sync shows for each store.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" disabled={activeCount >= MAX_STORES} onClick={() => setOpenId('new')}>Add store</button>
        </div>
      </div>

      <div className="tablewrap">
        <table className="book stores">
          <thead><tr><th>Store</th><th>Code</th><th>Managers</th><th>People</th><th>ABN</th><th>Last sync</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {stores.map((s) => {
              const mgrs = managersOf(s.id)
              return (
                <tr key={s.id} className={s.active ? '' : 'inactive'}>
                  <td data-label="Store"><b>{s.name}</b>{!s.active && <small> (inactive)</small>}</td>
                  <td data-label="Code"><span className="num">{s.code}</span></td>
                  <td data-label="Managers">{mgrs.length === 0 ? <span className="chip warn">No manager yet</span> : mgrs.map((m) => <div key={m.user_id}><b>{m.full_name}</b> <small>{m.email}</small></div>)}</td>
                  <td data-label="People"><span className="num">{inStore(s.id).length}</span></td>
                  <td data-label="ABN">{s.abn ? <span className="num">{s.abn}</span> : <span className="chip warn">Not set</span>}</td>
                  <td data-label="Last sync">{syncCell(s.id)}</td>
                  <td className="rowactions">
                    <button type="button" className="btn" onClick={() => setOpenId(s.id)}>Open</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <section className="block admins">
        <h2>Admins</h2>
        <p className="muted">Admins see and change everything in every store. {isOwner ? 'Only you can add or remove admins.' : 'Only the main admin can add or remove admins.'}</p>
        <ul className="people">
          <li><div className="who-line"><b>Main admin</b><span className="muted">{ADMIN_EMAIL}</span></div></li>
          {admins.map((p) => (
            <li key={p.user_id}>
              <div className="who-line">
                <b>{p.full_name}</b><span className="muted">{p.email}</span>
                {!p.active && <span className="chip warn">Login turned off</span>}
              </div>
              {isOwner && <div className="person-actions"><button type="button" className="btn" onClick={() => void removeAdmin(p)}>Remove admin</button></div>}
            </li>
          ))}
        </ul>
        {isOwner && (
          <form onSubmit={addAdmin} className="addperson">
            <h3>Add an admin</h3>
            <div className="grid">
              <label>Email (their login)
                <input name="adminEmail" type="email" autoComplete="off" list="admin-emails" required value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
                <datalist id="admin-emails">{people.filter((p) => !p.is_admin && p.active).map((p) => <option key={p.user_id} value={p.email}>{p.full_name}</option>)}</datalist>
              </label>
              <label>Name
                <input name="adminName" autoComplete="off" required={!known} disabled={!!known} value={known ? known.full_name : adminName} onChange={(e) => setAdminName(e.target.value)} />
              </label>
            </div>
            {isMain && <p className="bad">That is already the main admin.</p>}
            {known?.is_admin && <p className="bad">{known.full_name} is already an admin.</p>}
            {known && !known.is_admin && <p className="muted">{known.full_name} already has a login. They become an admin with the same password.</p>}
            <div className="actions">
              <button type="submit" className="btn primary" disabled={busy || isMain || !!known?.is_admin}>{known ? 'Make admin' : 'Next: set a password'}</button>
            </div>
          </form>
        )}
      </section>

      {openId && (openId === 'new' || open) && (
        <StorePanel key={openId} store={open} stores={stores} people={people} members={members}
          onClose={() => setOpenId(null)} onChanged={onChanged} />
      )}
      {creating && (
        <PasswordDialog name={creating.name} email={creating.email} fn="manage-user"
          body={{ action: 'set_admin', email: creating.email, full_name: creating.name, admin: true }}
          onClose={() => setCreating(null)} onDone={() => { setAdminEmail(''); setAdminName(''); onChanged() }} />
      )}
      {confirmDialog}
    </>
  )
}
