// One login per store, at the store's own email address, with the Store permission (role 'staff').
// Each gets a temporary password and must choose their own the first time they sign in.
//
//   node scripts/create-store-users.mjs            dry run: lists what would be created, changes nothing
//   node scripts/create-store-users.mjs --apply    creates them and writes the temporary passwords to store-logins.csv.local
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the same two as the nightly sync).
// A store whose email already has a login is only added to that store; its password is not touched.
// The CSV holds passwords in plain text so they can be handed out: it is git-ignored. Delete it once they are sent.
import { createClient } from '@supabase/supabase-js'
import { randomInt } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789' // no 0 O 1 l I, same as the admin screen
const password = () => Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')).join('-')
const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/
const OUT = 'store-logins.csv.local'

const apply = process.argv.includes('--apply')
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
if (apply && existsSync(OUT)) throw new Error(`${OUT} already exists. Move or delete it first so no password list is overwritten.`)
const sb = createClient(url, key, { auth: { persistSession: false } })

const { data: stores, error } = await sb.from('stores').select('id,name,email,active').eq('active', true).order('name')
if (error) throw error

// One login per address; a shared address becomes a login in each of its stores.
const byEmail = new Map()
const skipped = []
for (const s of stores) {
  const email = String(s.email ?? '').trim().toLowerCase()
  if (!email) { skipped.push(`${s.name}: no email`); continue }
  if (!EMAIL.test(email)) { skipped.push(`${s.name}: "${s.email}" is not a valid email`); continue }
  byEmail.set(email, [...(byEmail.get(email) ?? []), s])
}

const rows = []
for (const [email, list] of byEmail) {
  const { data: existing } = await sb.from('app_users').select('user_id').eq('email', email).maybeSingle()
  const name = list.length === 1 ? `${list[0].name} store` : `${list.map((s) => s.name).join(' + ')} stores`
  if (!apply) { rows.push([email, list.map((s) => s.name).join(' + '), existing ? 'already has a login: store added only' : 'new login']); continue }

  let userId = existing?.user_id
  let pw = ''
  if (!userId) {
    pw = password()
    const made = await sb.auth.admin.createUser({ email, password: pw, email_confirm: true })
    if (made.error) { skipped.push(`${email}: ${made.error.message}`); continue }
    userId = made.data.user.id
    const { error: e1 } = await sb.from('app_users').insert({ user_id: userId, email, full_name: name, active: true, is_admin: false, sees_all_sales: false, password_set_at: new Date().toISOString() })
    if (!e1) { const { error: e3 } = await sb.rpc('set_temp_password', { p_user: userId }); if (e3) { skipped.push(`${email}: could not lock it to a password change: ${e3.message}`); continue } }
    if (e1) { skipped.push(`${email}: ${e1.message}`); continue }
  }
  for (const s of list) {
    const { error: e2 } = await sb.from('store_members').upsert({ user_id: userId, store_id: s.id, role: 'staff' })
    if (e2) skipped.push(`${email} / ${s.name}: ${e2.message}`)
  }
  rows.push([email, list.map((s) => s.name).join(' + '), pw || '(existing login, unchanged)'])
}

if (apply) {
  writeFileSync(OUT, ['email,store,temporary password', ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n') + '\n')
  console.log(`Created or updated ${rows.length} store logins. Temporary passwords are in ${OUT} (git-ignored). Delete it once they are handed out.`)
} else {
  console.log(`Dry run. Would set up ${rows.length} store logins:`)
  for (const r of rows) console.log(`  ${r[0].padEnd(40)} ${r[1]}  [${r[2]}]`)
  console.log('Run again with --apply to create them.')
}
if (skipped.length) console.log(`\nNeeds attention:\n  ${skipped.join('\n  ')}`)
