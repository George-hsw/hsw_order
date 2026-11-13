import { useMemo, useState } from 'react'
import { useConfirm } from './Confirm'
import Modal from './Modal'
import PasswordDialog from './PasswordDialog'
import { useToast } from './Toast'
import { ADMIN_EMAIL, DEMO, ROLE_LABEL, supabase, type AppUser, type Member, type StoreRow } from './lib/supabase'

type Level = 'admin' | 'area' | 'store'
type Filter = 'all' | Level
type Pick = 'manager' | 'staff'

interface Props {
  stores: StoreRow[] // every store, including inactive
  people: AppUser[]
  members: Member[]
  isOwner: boolean // the main admin: the only one who adds or removes admins, or changes another admin
  onChanged: () => void
}

const LEVEL_LABEL: Record<Level, string> = { admin: 'Admin', area: 'Manager', store: 'Store user' }
const LEVEL_HELP: Record<Level, string> = {
  admin: 'Sees and changes everything in every store: stores, people, sales and analytics.',
  area: 'Reads every store’s sales and nothing else. Cannot order, quote, count stock or change anything.',
  store: 'Works in the stores they are added to, as a manager or as store staff.',
}
const FILTER_LABEL: Record<Filter, string> = { all: 'Everyone', admin: 'Admins', area: 'Managers', store: 'Store users' }
const levelOf = (p: AppUser): Level => (p.is_admin ? 'admin' : p.sees_all_sales ? 'area' : 'store')

/** Calls the manage-user function, which is the only thing that writes people. Shows its own message on failure. */
function useManageUser() {
  const toast = useToast()
  return async (body: Record<string, unknown>): Promise<boolean> => {
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
}

/** Admin only. Everyone who can sign in, what each can do, and where. Admins change everything; managers only read sales. */
export default function Users({ stores, people, members, isOwner, onChanged }: Props) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | 'new' | null>(null)
  const others = people.filter((p) => p.email.toLowerCase() !== ADMIN_EMAIL)
  const open = openId && openId !== 'new' ? others.find((p) => p.user_id === openId) ?? null : null
  const count = (f: Filter) => (f === 'all' ? others.length : others.filter((p) => levelOf(p) === f).length)

  const storesOf = (p: AppUser) => members.filter((m) => m.user_id === p.user_id).map((m) => ({ m, s: stores.find((s) => s.id === m.store_id) })).filter((r): r is { m: Member; s: StoreRow } => !!r.s)
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return others
      .filter((p) => (filter === 'all' || levelOf(p) === filter) && (!term || p.full_name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term)))
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [others, q, filter])

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Users</h1>
          <p className="muted">Everyone who can sign in. Admins change everything. Managers read every store’s sales and nothing else. Store users work in their own stores.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => setOpenId('new')}>Add user</button>
        </div>
      </div>

      <div className="filters">
        <input type="search" name="userSearch" aria-label="Search people" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="segmented" role="group" aria-label="Who to show">
          {(['all', 'admin', 'area', 'store'] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{FILTER_LABEL[f]} ({count(f)})</button>
          ))}
        </div>
      </div>

      <div className="tablewrap">
        <table className="book users">
          <thead><tr><th>Person</th><th>Access</th><th>Stores</th><th>Login</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            <tr>
              <td data-label="Person"><b>Main admin</b><small className="sub">{ADMIN_EMAIL}</small></td>
              <td data-label="Access"><span className="chip quote">Admin</span></td>
              <td data-label="Stores">All stores</td>
              <td data-label="Login"><span className="chip paid">Active</span></td>
              <td className="rowactions" />
            </tr>
            {rows.map((p) => {
              const level = levelOf(p)
              const mine = storesOf(p)
              return (
                <tr key={p.user_id} className={p.active ? '' : 'inactive'}>
                  <td data-label="Person"><b>{p.full_name}</b><small className="sub">{p.email}</small></td>
                  <td data-label="Access"><span className={'chip' + (level === 'admin' ? ' quote' : level === 'area' ? ' warn' : '')}>{LEVEL_LABEL[level]}</span></td>
                  <td data-label="Stores">
                    {level !== 'store' && mine.length === 0 ? 'All stores'
                      : mine.length === 0 ? <span className="chip warn">No store yet</span>
                      : mine.map(({ m, s }) => <div key={s.id}>{s.name} <small>{ROLE_LABEL[m.role]}</small></div>)}
                  </td>
                  <td data-label="Login">{p.active ? <span className="chip paid">Active</span> : <span className="chip warn">Cannot sign in</span>}</td>
                  <td className="rowactions"><button type="button" className="btn" aria-label={`Open ${p.full_name}`} onClick={() => setOpenId(p.user_id)}>Open</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="state compact"><p>No one matches</p><p className="muted">Try another name, or choose Everyone.</p></div>}
      </div>

      {openId === 'new' && <AddUser stores={stores.filter((s) => s.active)} people={people} isOwner={isOwner} onClose={() => setOpenId(null)} onChanged={onChanged} />}
      {open && <Person key={open.user_id} p={open} stores={stores} members={members} isOwner={isOwner} onClose={() => setOpenId(null)} onChanged={onChanged} />}
    </>
  )
}

function CloseX({ onClose, disabled }: { onClose: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="modal-x" aria-label="Close" onClick={onClose} disabled={disabled}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
    </button>
  )
}

/** The three kinds of access, as buttons with the one that is chosen pressed, and a line saying what it means. */
function LevelPick({ value, onPick, canAdmin, disabled }: { value: Level; onPick: (l: Level) => void; canAdmin: boolean; disabled?: boolean }) {
  return (
    <>
      <div className="segmented" role="group" aria-label="What this person can do">
        {(['store', 'area', 'admin'] as const).map((l) => (
          <button key={l} type="button" aria-pressed={value === l} disabled={disabled || (l === 'admin' && !canAdmin)} onClick={() => onPick(l)}>{LEVEL_LABEL[l]}</button>
        ))}
      </div>
      <p className="muted">{LEVEL_HELP[value]}{!canAdmin && value !== 'admin' ? ' Only the main admin can make someone an admin.' : ''}</p>
    </>
  )
}

function AddUser({ stores, people, isOwner, onClose, onChanged }: { stores: StoreRow[]; people: AppUser[]; isOwner: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const call = useManageUser()
  const [ask, confirmDialog] = useConfirm()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [level, setLevel] = useState<Level>('store')
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '')
  const [role, setRole] = useState<Pick>('staff')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState<Record<string, unknown> | null>(null) // a new person: the password dialog makes their login
  const clean = email.trim().toLowerCase()
  const known = people.find((p) => p.email.toLowerCase() === clean)
  const isMain = clean === ADMIN_EMAIL
  const same = !!known && levelOf(known) === level && level !== 'store'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clean || isMain || same || busy) return
    const body: Record<string, unknown> =
      level === 'store' ? { action: 'add', store_id: storeId, email: clean, role }
      : level === 'area' ? { action: 'set_area', email: clean, enabled: true }
      : { action: 'set_admin', email: clean, admin: true }
    if (!known) return setCreating({ ...body, full_name: name.trim() })
    if (level === 'admin' && !(await ask({ title: `Make ${known.full_name} an admin?`, body: <p>They will see and change everything in every store. They keep their password.</p>, confirmLabel: 'Make admin' }))) return
    setBusy(true)
    const ok = await call(body)
    setBusy(false)
    if (!ok) return
    toast.success(`${known.full_name} is now ${level === 'admin' ? 'an admin' : level === 'area' ? 'a manager' : 'in this store'}.`)
    onChanged(); onClose()
  }

  return (
    <Modal labelledBy="adduser-title" onClose={() => { if (!busy) onClose() }}>
      <div className="modalbox wide panel">
        <CloseX onClose={onClose} disabled={busy} />
        <h2 id="adduser-title">Add a user</h2>
        <form onSubmit={submit}>
          <div className="grid">
            <label>Email (their login)
              <input name="userEmail" type="email" autoComplete="off" list="user-emails" required data-autofocus="" value={email} onChange={(e) => setEmail(e.target.value)} />
              <datalist id="user-emails">{people.map((p) => <option key={p.user_id} value={p.email}>{p.full_name}</option>)}</datalist>
            </label>
            <label>Name
              <input name="userName" autoComplete="off" required={!known} disabled={!!known} value={known ? known.full_name : name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <LevelPick value={level} onPick={setLevel} canAdmin={isOwner} />
          {level === 'store' && (
            <div className="grid">
              <label>Store
                <select name="userStore" value={storeId} onChange={(e) => setStoreId(e.target.value)} required>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label>Permission
                <select name="userRole" value={role} onChange={(e) => setRole(e.target.value as Pick)}>
                  <option value="staff">{ROLE_LABEL.staff}</option>
                  <option value="manager">{ROLE_LABEL.manager}</option>
                </select>
              </label>
            </div>
          )}
          {isMain && <p className="bad">That is the main admin address.</p>}
          {same && <p className="bad">{known?.full_name} is already {level === 'admin' ? 'an admin' : 'a manager'}.</p>}
          {known && !same && !isMain && <p className="muted">{known.full_name} already has a login, so no new password is needed.</p>}
          <div className="actions">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy || isMain || same || (level === 'store' && !storeId)}>{known ? 'Add' : 'Next: set a password'}</button>
          </div>
        </form>
      </div>
      {confirmDialog}
      {creating && (
        <PasswordDialog name={String(creating.full_name)} email={clean} fn="manage-user" body={creating}
          onClose={() => setCreating(null)} onDone={() => { onChanged(); onClose() }} />
      )}
    </Modal>
  )
}

function Person({ p, stores, members, isOwner, onClose, onChanged }: { p: AppUser; stores: StoreRow[]; members: Member[]; isOwner: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const call = useManageUser()
  const [ask, confirmDialog] = useConfirm()
  const [busy, setBusy] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [addStore, setAddStore] = useState('')
  const [addRole, setAddRole] = useState<Pick>('staff')
  const level = levelOf(p)
  const canChange = isOwner || level !== 'admin' // only the main admin changes another admin
  const mine = members.filter((m) => m.user_id === p.user_id).map((m) => ({ m, s: stores.find((s) => s.id === m.store_id) })).filter((r): r is { m: Member; s: StoreRow } => !!r.s)
  const freeStores = stores.filter((s) => s.active && !mine.some(({ s: x }) => x.id === s.id))

  const run = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    const ok = await call(body)
    setBusy(false)
    if (ok) { toast.success(done); onChanged() }
    return ok
  }

  const pickLevel = async (next: Level) => {
    if (next === level || !canChange) return
    if (next === 'admin' && !(await ask({ title: `Make ${p.full_name} an admin?`, body: <p>They will see and change everything in every store, including people, stores, sales and analytics.</p>, confirmLabel: 'Make admin' }))) return
    if (level === 'admin' && !(await ask({ title: `Remove ${p.full_name} as an admin?`, body: <p>They keep their login. They go back to {next === 'area' ? 'reading every store’s sales' : 'only the stores they belong to'}.</p>, confirmLabel: 'Remove admin' }))) return
    if (level === 'admin' && !(await call({ action: 'set_admin', user_id: p.user_id, admin: false }))) return
    if (level === 'area' && !(await call({ action: 'set_area', user_id: p.user_id, enabled: false }))) return
    if (next === 'admin') await run({ action: 'set_admin', email: p.email, admin: true }, `${p.full_name} is now an admin.`)
    else if (next === 'area') await run({ action: 'set_area', email: p.email, enabled: true }, `${p.full_name} is now a manager.`)
    else { toast.success(`${p.full_name} is now a store user.`); onChanged() }
  }

  const setActive = async (next: boolean) => {
    if (!next && !(await ask({ title: `Turn off ${p.full_name}?`, body: <p>They won’t be able to sign in. What they made stays, and you can turn them back on later.</p>, confirmLabel: 'Turn off' }))) return
    await run({ action: 'update', user_id: p.user_id, active: next }, next ? `${p.full_name} can sign in again.` : `${p.full_name} can no longer sign in.`)
  }
  const remove = async () => {
    if (!(await ask({ title: `Delete ${p.full_name}?`, body: <p>Their login is removed and they leave every store. The quotes, invoices and orders they made stay. This cannot be undone.</p>, confirmLabel: 'Delete user', danger: true }))) return
    if (await run({ action: 'delete', user_id: p.user_id }, `${p.full_name} deleted.`)) onClose()
  }

  return (
    <Modal labelledBy="person-title" onClose={() => { if (!busy) onClose() }}>
      <div className="modalbox wide panel">
        <CloseX onClose={onClose} disabled={busy} />
        <h2 id="person-title">{p.full_name}</h2>
        <p className="muted">{p.email}{!p.active ? '. Cannot sign in at the moment.' : ''}</p>

        <section aria-labelledby="access-title">
          <h3 id="access-title">Access</h3>
          <LevelPick value={level} onPick={(l) => void pickLevel(l)} canAdmin={isOwner} disabled={busy || !canChange} />
          {!canChange && <p className="muted">Only the main admin can change another admin.</p>}
        </section>

        {level !== 'admin' && (
          <section aria-labelledby="where-title">
            <h3 id="where-title">Stores</h3>
            {level === 'area' && <p className="muted">A manager reads every store’s sales. A store added here also lets them work in it.</p>}
            {mine.length === 0 ? (
              <p className="muted">{level === 'store' ? 'Not in any store yet, so they cannot use the app until you add one.' : 'Not in a store of their own.'}</p>
            ) : (
              <ul className="people">
                {mine.map(({ m, s }) => (
                  <li key={s.id}>
                    <div className="who-line"><b>{s.name}</b>{!s.active && <span className="chip warn">Inactive</span>}</div>
                    <div className="person-actions">
                      <select name={`role-${s.id}`} aria-label={`Permission in ${s.name}`} value={m.role} disabled={busy || !canChange}
                        onChange={(e) => void run({ action: 'set_role', user_id: p.user_id, store_id: s.id, role: e.target.value }, 'Permission changed.')}>
                        <option value="manager">{ROLE_LABEL.manager}</option>
                        <option value="staff">{ROLE_LABEL.staff}</option>
                      </select>
                      <button type="button" className="btn" disabled={busy || !canChange}
                        onClick={() => void run({ action: 'remove', user_id: p.user_id, store_id: s.id }, `${p.full_name} removed from ${s.name}.`)}>Remove from store</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {freeStores.length > 0 && canChange && (
              <form className="addperson" onSubmit={(e) => { e.preventDefault(); if (addStore) void run({ action: 'add', store_id: addStore, email: p.email, role: addRole }, `${p.full_name} added.`).then((ok) => { if (ok) setAddStore('') }) }}>
                <h4>Add to a store</h4>
                <div className="grid">
                  <label>Store
                    <select name="addStore" value={addStore} onChange={(e) => setAddStore(e.target.value)}>
                      <option value="">Choose a store</option>
                      {freeStores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                  <label>Permission
                    <select name="addRole" value={addRole} onChange={(e) => setAddRole(e.target.value as Pick)}>
                      <option value="staff">{ROLE_LABEL.staff}</option>
                      <option value="manager">{ROLE_LABEL.manager}</option>
                    </select>
                  </label>
                </div>
                <div className="actions"><button type="submit" className="btn" disabled={busy || !addStore}>Add to store</button></div>
              </form>
            )}
          </section>
        )}

        <section aria-labelledby="login-title">
          <h3 id="login-title">Login</h3>
          <div className="actions quick">
            <button type="button" className="btn" disabled={busy || !canChange} onClick={() => setResetting(true)}>Reset password</button>
            <button type="button" className="btn" disabled={busy || !canChange} onClick={() => void setActive(!p.active)}>{p.active ? 'Turn off' : 'Turn on'}</button>
            <button type="button" className="btn danger" disabled={busy || !canChange} onClick={() => void remove()}>Delete user</button>
          </div>
        </section>
      </div>
      {confirmDialog}
      {resetting && <PasswordDialog name={p.full_name} email={p.email} fn="manage-user" body={{ action: 'reset_password', user_id: p.user_id }} onClose={() => setResetting(false)} onDone={onChanged} />}
    </Modal>
  )
}
