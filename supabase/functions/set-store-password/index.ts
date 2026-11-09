// Admin only. Sets (or resets) the sign-in password for a store's login email.
// With no password in the request, a strong random one is generated and returned ONCE so it can be handed to the store.
// Supabase Auth hashes and stores it; this function never keeps or logs it.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { ADMIN_EMAIL, cors, json } from '../_shared/cors.ts'
import { checkPassword, generatePassword } from '../_shared/password.ts'

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
    if (callerEmail !== ADMIN_EMAIL) return json({ error: 'Only the admin can set store passwords' }, 403)

    const b = await req.json()
    const { data: store } = await admin.from('stores').select('id,name,email').eq('id', b.store_id).single()
    if (!store) return json({ error: 'Store not found' }, 404)
    const email = String(store.email ?? '').trim().toLowerCase()
    if (!email) return json({ error: 'This store has no login email yet. Add one first.' }, 400)

    let password: string
    let generated = false
    if (typeof b.password === 'string' && b.password !== '') {
      const problem = checkPassword(b.password)
      if (problem) return json({ error: problem }, 400)
      password = b.password
    } else {
      password = generatePassword()
      generated = true
    }

    // Create the auth user, or update it if it already exists.
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) {
      if (!/already|registered|exists/i.test(created.error.message)) throw created.error
      // Find the existing user's id without sending anything (generateLink returns the user).
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
      const id = link?.user?.id
      if (linkError || !id) throw linkError ?? new Error('Could not find the existing user')
      const { error: updateError } = await admin.auth.admin.updateUserById(id, { password, email_confirm: true })
      if (updateError) throw updateError
    }
    await admin.from('stores').update({ password_set_at: new Date().toISOString() }).eq('id', store.id)

    return json({ ok: true, store: store.name, generated, password: generated ? password : undefined })
  } catch (e) {
    console.error('set-store-password failed', e instanceof Error ? e.message : e)
    return json({ error: 'Could not set the password' }, 500)
  }
})
