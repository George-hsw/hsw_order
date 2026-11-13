// Admins only (the main admin, and anyone they made an admin). People who sign in, and which stores they belong to. One person has one login and can be in several
// stores, with a permission in each: manager, or staff (shown as "Store").
//   add             { store_id, email, full_name?, role, password? }  a new person, or an existing one added to this store
//   set_role        { user_id, store_id, role }
//   remove          { user_id, store_id }                             take them out of this store only
//   update          { user_id, full_name?, active? }                  turn their login on or off, rename
//   delete          { user_id }                                       remove the login and every membership
//   reset_password  { user_id, password? }
//   set_admin       see below; the main admin only
//   set_area        see below; any admin
// With no password in an `add` of a new person, or in reset_password, a strong random one is generated and returned
// ONCE, to hand over. Supabase Auth hashes and stores it; this function never keeps or logs it.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { ADMIN_EMAIL, cors, json } from '../_shared/cors.ts'
import { accessOf } from '../_shared/access.ts'
import { checkPassword, generatePassword } from '../_shared/password.ts'

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/
const ROLES = new Set(['manager', 'staff'])
const BAN_FOREVER = '876000h' // about 100 years; 'none' lifts it

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })

    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '')
    const { data: u } = await admin.auth.getUser(token)
    const callerEmail = u.user?.email?.toLowerCase()
    if (!callerEmail) return json({ error: 'Not signed in' }, 401)
    const me = await accessOf(admin, u.user?.id, callerEmail)
    if (!me?.admin) return json({ error: 'Only an admin can manage users' }, 403)
    const owner = callerEmail === ADMIN_EMAIL // the main admin: the only one who adds or removes admins

    const b = await req.json()

    // Another admin's login (turning it off, deleting it, a new password) is the main admin's to change.
    const guardAdmin = async (userId: unknown) => {
      if (owner) return null
      const { data } = await admin.from('app_users').select('is_admin').eq('user_id', userId).maybeSingle()
      return data?.is_admin ? json({ error: 'Only the main admin can change another admin.' }, 403) : null
    }

    const chosenPassword = (): { password: string; generated: boolean } | { error: string } => {
      if (typeof b.password === 'string' && b.password !== '') {
        const problem = checkPassword(b.password)
        return problem ? { error: problem } : { password: b.password, generated: false }
      }
      return { password: generatePassword(), generated: true }
    }
    const activeStore = async (id: unknown) => {
      const { data } = await admin.from('stores').select('id,active').eq('id', id).maybeSingle()
      return data?.active ? data : null
    }

    // A new login for a person (b.full_name, b.password), with their app_users row. role: made an admin, or a manager, straight away.
    const newLogin = async (email: string, role: { admin?: boolean; area?: boolean }): Promise<{ userId: string; pw: { password: string; generated: boolean } } | { error: string }> => {
      const fullName = String(b.full_name ?? '').trim().slice(0, 80)
      if (!fullName) return { error: 'Enter the person’s name.' }
      // A shared store login and a person must never share an address, or the two would be confused.
      const { data: stores } = await admin.from('stores').select('email')
      if ((stores ?? []).some((s) => String(s.email ?? '').toLowerCase() === email))
        return { error: 'That address is a store’s own email. Use a personal email for a person.' }

      const pw = chosenPassword()
      if ('error' in pw) return { error: pw.error }

      let userId: string | undefined
      const created = await admin.auth.admin.createUser({ email, password: pw.password, email_confirm: true })
      if (created.error) {
        if (!/already|registered|exists/i.test(created.error.message)) throw created.error
        // An auth user already exists for this address (for example an earlier sign-in): reuse it.
        const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
        userId = link?.user?.id
        if (linkError || !userId) throw linkError ?? new Error('Could not find the existing user')
        const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password: pw.password, email_confirm: true, ban_duration: 'none' })
        if (updateError) throw updateError
      } else userId = created.data.user.id

      const { error } = await admin.from('app_users').insert({
        user_id: userId, email, full_name: fullName, active: true, is_admin: !!role.admin, sees_all_sales: !!role.area, password_set_at: new Date().toISOString(),
      })
      if (error) throw error
      return { userId: userId!, pw }
    }

    //   set_admin { email, full_name?, password?, admin: true }  make someone an admin (a new login is made if they have none)
    //   set_admin { user_id, admin: false }                       an admin goes back to their stores only
    //   set_area  { email, full_name?, password?, enabled: true }  make someone a manager: reads every store's sales, nothing else
    //   set_area  { user_id, enabled: false }                       back to their own stores only. Any admin may do this.
    if (b.action === 'set_area') {
      if (b.enabled === false) {
        const { data, error } = await admin.from('app_users').update({ sees_all_sales: false }).eq('user_id', b.user_id).select('user_id')
        if (error) throw error
        if (!data?.length) return json({ error: 'User not found' }, 404)
        return json({ ok: true })
      }
      const email = String(b.email ?? '').trim().toLowerCase()
      if (!EMAIL.test(email)) return json({ error: 'Enter a valid email address.' }, 400)
      if (email === ADMIN_EMAIL) return json({ error: 'That is the main admin, who already sees everything.' }, 400)
      const { data: existing } = await admin.from('app_users').select('user_id,full_name,active,is_admin').eq('email', email).maybeSingle()
      if (existing) {
        if (!existing.active) return json({ error: 'That person’s login is turned off. Turn it on first.' }, 400)
        if (existing.is_admin) return json({ error: 'That person is an admin, who already sees everything.' }, 400)
        const { error } = await admin.from('app_users').update({ sees_all_sales: true }).eq('user_id', existing.user_id)
        if (error) throw error
        return json({ ok: true, existing: true, name: existing.full_name })
      }
      const made = await newLogin(email, { area: true })
      if ('error' in made) return json({ error: made.error }, 400)
      return json({ ok: true, generated: made.pw.generated, password: made.pw.generated ? made.pw.password : undefined })
    }

    if (b.action === 'set_admin') {
      if (!owner) return json({ error: 'Only the main admin can add or remove admins.' }, 403)
      if (b.admin === false) {
        const { data, error } = await admin.from('app_users').update({ is_admin: false }).eq('user_id', b.user_id).select('user_id')
        if (error) throw error
        if (!data?.length) return json({ error: 'User not found' }, 404)
        return json({ ok: true })
      }
      const email = String(b.email ?? '').trim().toLowerCase()
      if (!EMAIL.test(email)) return json({ error: 'Enter a valid email address.' }, 400)
      if (email === ADMIN_EMAIL) return json({ error: 'That is already the main admin.' }, 400)
      const { data: existing } = await admin.from('app_users').select('user_id,full_name,active').eq('email', email).maybeSingle()
      if (existing) {
        if (!existing.active) return json({ error: 'That person’s login is turned off. Turn it on in their store first.' }, 400)
        const { error } = await admin.from('app_users').update({ is_admin: true }).eq('user_id', existing.user_id)
        if (error) throw error
        return json({ ok: true, existing: true, name: existing.full_name })
      }
      const made = await newLogin(email, { admin: true })
      if ('error' in made) return json({ error: made.error }, 400)
      return json({ ok: true, generated: made.pw.generated, password: made.pw.generated ? made.pw.password : undefined })
    }

    if (b.action === 'add') {
      const email = String(b.email ?? '').trim().toLowerCase()
      if (!EMAIL.test(email)) return json({ error: 'Enter a valid email address.' }, 400)
      if (!ROLES.has(b.role)) return json({ error: 'Choose a permission: manager or store.' }, 400)
      if (email === ADMIN_EMAIL) return json({ error: 'That is the admin address.' }, 400)
      const store = await activeStore(b.store_id)
      if (!store) return json({ error: 'Choose an active store.' }, 400)

      const { data: existing } = await admin.from('app_users').select('user_id,full_name').eq('email', email.toLowerCase()).maybeSingle()
      if (existing) {
        // Already has a login: just give them this store. No new password.
        const { error } = await admin.from('store_members').upsert({ user_id: existing.user_id, store_id: store.id, role: b.role })
        if (error) throw error
        return json({ ok: true, existing: true, name: existing.full_name })
      }

      const made = await newLogin(email, {})
      if ('error' in made) return json({ error: made.error }, 400)
      const { userId, pw } = made
      const { error: memberError } = await admin.from('store_members').insert({ user_id: userId, store_id: store.id, role: b.role })
      if (memberError) throw memberError
      return json({ ok: true, generated: pw.generated, password: pw.generated ? pw.password : undefined })
    }

    if (b.action === 'set_role') {
      if (!ROLES.has(b.role)) return json({ error: 'Choose a permission: manager or store.' }, 400)
      const { data, error } = await admin.from('store_members').update({ role: b.role })
        .eq('user_id', b.user_id).eq('store_id', b.store_id).select('user_id')
      if (error) throw error
      if (!data?.length) return json({ error: 'That person is not in this store.' }, 404)
      return json({ ok: true })
    }

    if (b.action === 'remove') {
      const { error } = await admin.from('store_members').delete().eq('user_id', b.user_id).eq('store_id', b.store_id)
      if (error) throw error
      return json({ ok: true })
    }

    if (b.action === 'update') {
      const blocked = await guardAdmin(b.user_id)
      if (blocked) return blocked
      const { data: person } = await admin.from('app_users').select('user_id').eq('user_id', b.user_id).maybeSingle()
      if (!person) return json({ error: 'User not found' }, 404)
      const patch: Record<string, unknown> = {}
      if (typeof b.full_name === 'string') {
        if (!b.full_name.trim()) return json({ error: 'Enter the person’s name.' }, 400)
        patch.full_name = b.full_name.trim().slice(0, 80)
      }
      if (typeof b.active === 'boolean') {
        patch.active = b.active
        // Also block sign-in itself, so a deactivated person cannot even start a new session.
        const { error } = await admin.auth.admin.updateUserById(b.user_id, { ban_duration: b.active ? 'none' : BAN_FOREVER })
        if (error) throw error
      }
      if (Object.keys(patch).length) {
        const { error } = await admin.from('app_users').update(patch).eq('user_id', b.user_id)
        if (error) throw error
      }
      return json({ ok: true })
    }

    if (b.action === 'delete') {
      const blocked = await guardAdmin(b.user_id)
      if (blocked) return blocked
      const { data: person } = await admin.from('app_users').select('user_id,email').eq('user_id', b.user_id).maybeSingle()
      if (!person) return json({ error: 'User not found' }, 404)
      // Documents keep the creator's email as text, so everything they made stays. Their login and memberships go.
      const { error } = await admin.auth.admin.deleteUser(person.user_id)
      if (error) throw error
      await admin.from('app_users').delete().eq('user_id', person.user_id) // already gone by cascade; harmless if so
      return json({ ok: true })
    }

    if (b.action === 'reset_password') {
      const blocked = await guardAdmin(b.user_id)
      if (blocked) return blocked
      const { data: person } = await admin.from('app_users').select('user_id,full_name').eq('user_id', b.user_id).maybeSingle()
      if (!person) return json({ error: 'User not found' }, 404)
      const pw = chosenPassword()
      if ('error' in pw) return json({ error: pw.error }, 400)
      const { error } = await admin.auth.admin.updateUserById(person.user_id, { password: pw.password })
      if (error) throw error
      await admin.from('app_users').update({ password_set_at: new Date().toISOString() }).eq('user_id', person.user_id)
      return json({ ok: true, generated: pw.generated, password: pw.generated ? pw.password : undefined })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    console.error('manage-user failed', e instanceof Error ? e.message : e)
    return json({ error: 'Could not complete that. Try again.' }, 500)
  }
})
