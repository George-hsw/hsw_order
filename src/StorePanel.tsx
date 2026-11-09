import { useEffect, useState } from 'react'
import { useConfirm } from './Confirm'
import PasswordDialog from './PasswordDialog'
import { useToast } from './Toast'
import { DEMO, MAX_STORES, ROLE_LABEL, supabase, type AppUser, type Member, type StoreRow } from './lib/supabase'

interface Props {
  store: StoreRow | null // null: a new store
  stores: StoreRow[]
  people: AppUser[]
  members: Member[]
  onClose: () => void
  onChanged: () => void
}

type Draft = Omit<StoreRow, 'id'> & { id?: string }
const blank = (): Draft => ({
  name: '', code: '', address: '', suburb: '', phone: '', email: '', owner_email: null,
  legal_name: '', abn: '', bank_name: '', bsb: '', account: '', active: true, password_set_at: null,
})

type Pick = 'manager' | 'staff'
const PERMISSION: Record<Pick, string> = {
  manager: 'Manager: whole store, and gets its payment emails',
  staff: 'Store: whole store (quotes, orders, payments, reports)',
}

/** One store, in a popup: who is in it and with what permission, and the store's details. Admin only. */
export default function StorePanel({ store, stores, people, members, onClose, onChanged }: Props) {
  const toast = useToast()
  const [ask, confirmDialog] = useConfirm()
  const [current, setCurrent] = useState<StoreRow | null>(store) // becomes the saved row once a new store is saved
  const [draft, setDraft] = useState<Draft>(store ? { ...store } : blank())
  const [busy, setBusy] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<Pick>('staff')
  const [creating, setCreating] = useState<{ email: string; name: string; role: Pick } | null>(null) // goes to the password dialog
  const [resetFor, setResetFor] = useState<AppUser | null>(null)

  const here = current ? members.filter((m) => m.store_id === current.id) : []
  const rows = here
    .map((m) => ({ m, p: people.find((p) => p.user_id === m.user_id) }))
    .filter((r): r is { m: Member; p: AppUser } => !!r.p)
    .sort((a, b) => (a.m.role === b.m.role ? a.p.full_name.localeCompare(b.p.full_name) : a.m.role === 'manager' ? -1 : 1))
  const storesOf = (userId: string) => members.filter((m) => m.user_id === userId).length
  const known = people.find((p) => p.email.toLowerCase() === newEmail.trim().toLowerCase())
  const alreadyHere = !!known && here.some((m) => m.user_id === known.user_id)
  const joinable = people.filter((p) => !here.some((m) => m.user_id === p.user_id))
  const activeCount = stores.filter((s) => s.active).length

  const child = !!creating || !!resetFor
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !child) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy, child])

  const call = async (body: Record<string, unknown>): Promise<{ ok: boolean; data?: Record<string, unknown> }> => {
    if (DEMO) { toast.info('Demo mode: changes are not saved.'); return { ok: false } }
    if (!supabase) return { ok: false }
    const { data, error } = await supabase.functions.invoke('manage-user', { body })
    if (error || data?.error) {
      let msg = data?.error as string | undefined
      if (!msg && error && 'context' in error) msg = (await (error as { context: Response }).context.json().catch(() => null))?.error
      toast.error(msg ?? 'Could not save. Try again.')
      return { ok: false }
    }
    return { ok: true, data }
  }

  const addPerson = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!current || alreadyHere) return
    const email = newEmail.trim().toLowerCase()
    if (known) { // already has a login: give them this store, no new password
      setBusy(true)
      const r = await call({ action: 'add', store_id: current.id, email, role: newRole })
      setBusy(false)
      if (!r.ok) return
      toast.success(`${known.full_name} added to ${current.name}.`)
      setNewEmail(''); setNewName(''); onChanged()
      return
    }
    setCreating({ email, name: newName.trim(), role: newRole }) // a new person: the password dialog creates them
  }

  const setRole = async (m: Member, role: Pick) => {
    const r = await call({ action: 'set_role', user_id: m.user_id, store_id: m.store_id, role })
    if (r.ok) { toast.success('Permission changed.'); onChanged() }
  }
  const setActive = async (p: AppUser, next: boolean) => {
    if (!next && !(await ask({
      title: `Turn off ${p.full_name}?`,
      body: <p>They won’t be able to sign in to any store. The quotes, invoices and orders they made stay, and you can turn them back on later.</p>,
      confirmLabel: 'Turn off',
    }))) return
    const r = await call({ action: 'update', user_id: p.user_id, active: next })
    if (r.ok) { toast.success(next ? `${p.full_name} can sign in again.` : `${p.full_name} can no longer sign in.`); onChanged() }
  }
  const removeFromStore = async (p: AppUser, m: Member) => {
    if (!(await ask({
      title: `Remove ${p.full_name} from ${current?.name}?`,
      body: <p>They keep their login and any other stores. They just lose access to this one.</p>,
      confirmLabel: 'Remove from store',
    }))) return
    const r = await call({ action: 'remove', user_id: m.user_id, store_id: m.store_id })
    if (r.ok) { toast.success(`${p.full_name} removed from ${current?.name}.`); onChanged() }
  }
  const deleteUser = async (p: AppUser) => {
    const n = storesOf(p.user_id)
    if (!(await ask({
      title: `Delete ${p.full_name}?`,
      body: <p>Their login is removed{n > 1 ? ` and they leave all ${n} stores` : ''}. The quotes, invoices and orders they made stay. This cannot be undone.</p>,
      confirmLabel: 'Delete user',
      danger: true,
    }))) return
    const r = await call({ action: 'delete', user_id: p.user_id })
    if (r.ok) { toast.success(`${p.full_name} deleted.`); onChanged() }
  }

  const f = (k: keyof Draft, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>{label}
      <input name={String(k)} autoComplete="off" {...props} value={String(draft[k] ?? '')} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
    </label>
  )

  const saveStore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (DEMO) { toast.info('Demo mode: changes are not saved.'); return }
    if (!supabase) return
    setBusy(true)
    const { id, password_set_at: _kept, ...fields } = {
      ...draft, code: draft.code.trim().toUpperCase(), email: draft.email?.trim().toLowerCase() || null,
    } // the password date is set by the server, never from this form
    const { data, error } = id
      ? await supabase.from('stores').update(fields).eq('id', id).select().single()
      : await supabase.from('stores').insert(fields).select().single()
    setBusy(false)
    if (error) {
      toast.error(
        error.code === '23505' ? 'That name, code or email is already used by another store.'
          : error.message.includes('Store limit') ? `Limit reached: only ${MAX_STORES} active stores are allowed.`
            : error.message,
      )
      return
    }
    toast.success(`${draft.name} saved.`)
    setCurrent(data as StoreRow); setDraft(data as StoreRow); onChanged()
  }

  const deleteStore = async () => {
    if (!current || !supabase) return
    if (!(await ask({
      title: `Delete ${current.name}?`,
      body: <p>The store and its list of people are removed. This cannot be undone. A store that has quotes, invoices or orders can’t be deleted: turn it off instead by unticking Active.</p>,
      confirmLabel: 'Delete store',
      danger: true,
    }))) return
    const { error } = await supabase.from('stores').delete().eq('id', current.id)
    if (error) {
      toast.error(error.code === '23503'
        ? `${current.name} has quotes, invoices or orders, so it cannot be deleted. Untick Active to turn it off.`
        : error.message)
      return
    }
    toast.success(`${current.name} deleted.`)
    onChanged(); onClose()
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="store-title">
      <div className="modalbox wide panel">
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose} disabled={busy}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <h2 id="store-title">{current ? current.name : 'New store'}</h2>

        {current && (
          <section aria-labelledby="people-title">
            <h3 id="people-title">People</h3>
            {rows.length === 0 ? (
              <p className="muted">No one yet. Add a manager first, so the store has someone to receive payment notices.</p>
            ) : (
              <ul className="people">
                {rows.map(({ m, p }) => (
                  <li key={p.user_id} className={p.active ? '' : 'inactive'}>
                    <div className="who-line">
                      <b>{p.full_name}</b> <small>{p.email}</small>
                      {!p.active && <span className="chip warn">Cannot sign in</span>}
                      {storesOf(p.user_id) > 1 && <span className="chip">{storesOf(p.user_id)} stores</span>}
                    </div>
                    <div className="person-actions">
                      <select name={`role-${p.user_id}`} aria-label={`Permission for ${p.full_name}`} value={m.role} onChange={(e) => setRole(m, e.target.value as Pick)}>
                        <option value="manager">{ROLE_LABEL.manager}</option>
                        <option value="staff">{ROLE_LABEL.staff}</option>
                      </select>
                      <button type="button" className="btn" onClick={() => setResetFor(p)}>Reset password</button>
                      <button type="button" className="btn" onClick={() => setActive(p, !p.active)}>{p.active ? 'Turn off' : 'Turn on'}</button>
                      <button type="button" className="btn" onClick={() => removeFromStore(p, m)}>Remove from store</button>
                      <button type="button" className="btn danger" onClick={() => deleteUser(p)}>Delete user</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={addPerson} className="addperson">
              <h4>Add a person</h4>
              <div className="grid">
                <label>Email (their login)
                  <input name="newEmail" type="email" autoComplete="off" list="people-emails" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
                  <datalist id="people-emails">{joinable.map((p) => <option key={p.user_id} value={p.email}>{p.full_name}</option>)}</datalist>
                </label>
                <label>Name
                  <input name="newName" autoComplete="off" required={!known} disabled={!!known} value={known ? known.full_name : newName} onChange={(e) => setNewName(e.target.value)} />
                </label>
                <label>Permission
                  <select name="newRole" value={newRole} onChange={(e) => setNewRole(e.target.value as Pick)}>
                    <option value="staff">{PERMISSION.staff}</option>
                    <option value="manager">{PERMISSION.manager}</option>
                  </select>
                </label>
              </div>
              {alreadyHere && <p className="bad">{known?.full_name} is already in this store.</p>}
              {known && !alreadyHere && <p className="muted">{known.full_name} already has a login. They get this store as well, with no new password.</p>}
              <div className="actions">
                <button type="submit" className="btn primary" disabled={busy || alreadyHere}>{known ? 'Add to this store' : 'Next: set a password'}</button>
              </div>
            </form>
          </section>
        )}

        <details className="storedetails" open={!current}>
          <summary>Store details</summary>
          <form onSubmit={saveStore}>
            <div className="grid">
              {f('name', 'Store name', { required: true })}
              {f('code', 'Store code, 2 to 6 letters or digits', { required: true, pattern: '[A-Za-z0-9]{2,6}', maxLength: 6 })}
              {f('email', 'Store email', { type: 'email' })}
              {f('phone', 'Phone', { type: 'tel' })}
              {f('address', 'Address line')}
              {f('suburb', 'Suburb STATE Postcode')}
              {f('legal_name', 'Legal entity name')}
              {f('abn', 'ABN')}
              {f('bank_name', 'Bank account name')}
              {f('bsb', 'BSB')}
              {f('account', 'Account number')}
              <label className="inline">
                <input name="active" type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active
              </label>
            </div>
            {!current && activeCount >= MAX_STORES && <p className="bad">Limit reached: only {MAX_STORES} active stores are allowed.</p>}
            <div className="actions">
              {current && <button type="button" className="btn danger" onClick={deleteStore}>Delete store</button>}
              <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save store'}</button>
            </div>
          </form>
        </details>
      </div>

      {confirmDialog}
      {creating && current && (
        <PasswordDialog name={creating.name} email={creating.email} fn="manage-user"
          body={{ action: 'add', store_id: current.id, email: creating.email, full_name: creating.name, role: creating.role }}
          onClose={() => setCreating(null)} onDone={() => { setNewEmail(''); setNewName(''); onChanged() }} />
      )}
      {resetFor && (
        <PasswordDialog name={resetFor.full_name} email={resetFor.email} fn="manage-user"
          body={{ action: 'reset_password', user_id: resetFor.user_id }}
          onClose={() => setResetFor(null)} onDone={onChanged} />
      )}
    </div>
  )
}
