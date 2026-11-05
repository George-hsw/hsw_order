// Nightly: Dynamics NAV  ->  Supabase `items` and `store_stock`. Runs in GitHub Actions (.github/workflows/sync-dynamics.yml). Node 20+.
//
// Two published web services, both read-only:
//   DYN_ITEMS_URL   Retail Items   (one row per item)
//   DYN_STOCK_URL   Replen. Qty.   (one row per item and location; Location Code is the store)
// Sign-in, either:
//   DYN_USER + DYN_ACCESS_KEY                          NAV "Web Service Access Key" (HTTP Basic)
//   DYN_TENANT_ID + DYN_CLIENT_ID + DYN_CLIENT_SECRET  Business Central online (Entra app)
// Always: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional:
//   DYN_ITEMS_FIELD_MAP / DYN_STOCK_FIELD_MAP   JSON: our field -> the service's field name (see sync-lib.mjs and --discover)
//   DYN_ITEMS_FILTER / DYN_STOCK_FILTER         extra OData $filter
//   FORCE_REMOVE=1                              accept a mass removal of items
//
// What it protects: each store is published on its own. A store whose feed is empty, much smaller than yesterday, or has
// duplicate rows keeps its previous data, shows as Failed on the Stores tab, and the run ends in an error so GitHub emails the owner.
// The other stores are still updated.
//
// First run on a new setup:  node scripts/sync-dynamics.mjs --discover   prints the real field names for both services.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { ITEM_FIELDS, STOCK_FIELDS, groupStock, itemFingerprint, locationFilter, planChanges, removalLooksWrong, stockFingerprint, storeProblem, toItem, toStock } from './sync-lib.mjs'

const env = (k, req = true) => {
  const v = process.env[k]
  if (!v && req) throw new Error(`Missing env ${k}`)
  return v
}
const ITEMS = { ...ITEM_FIELDS, ...JSON.parse(process.env.DYN_ITEMS_FIELD_MAP || '{}') }
const STOCK = { ...STOCK_FIELDS, ...JSON.parse(process.env.DYN_STOCK_FIELD_MAP || '{}') }
const selectOf = (F) => Object.values(F).filter(Boolean).join(',')

async function authHeader() {
  if (process.env.DYN_USER && process.env.DYN_ACCESS_KEY) {
    return `Basic ${Buffer.from(`${process.env.DYN_USER}:${process.env.DYN_ACCESS_KEY}`).toString('base64')}`
  }
  const res = await fetch(`https://login.microsoftonline.com/${env('DYN_TENANT_ID')}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: env('DYN_CLIENT_ID'), client_secret: env('DYN_CLIENT_SECRET'),
      scope: env('DYN_SCOPE', false) || 'https://api.businesscentral.dynamics.com/.default',
    }),
  })
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`)
  return `Bearer ${(await res.json()).access_token}`
}

async function get(url, auth) {
  const res = await fetch(url, { headers: { authorization: auth, accept: 'application/json', 'odata.maxpagesize': '5000' } })
  if (res.status === 401 || res.status === 403) throw new Error(`Dynamics refused the sign-in (${res.status}). Check the user and access key, or the Entra app permissions.`)
  if (res.status === 400) throw new Error(`Dynamics rejected the request (400): ${(await res.text()).slice(0, 300)}\nA field name is probably wrong. Run: node scripts/sync-dynamics.mjs --discover`)
  if (!res.ok) throw new Error(`Dynamics request failed: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

async function fetchAll(baseUrl, F, filter, auth) {
  const url = new URL(baseUrl)
  url.searchParams.set('$select', selectOf(F))
  if (filter) url.searchParams.set('$filter', filter)
  const rows = []
  let next = url.toString()
  while (next) {
    const body = await get(next, auth)
    rows.push(...body.value)
    next = body['@odata.nextLink'] ?? body['odata.nextLink']
    console.log(`  fetched ${rows.length}…`)
  }
  return rows
}

/** Prints the real field names so the field maps can be set without guessing. */
async function discover() {
  const auth = await authHeader()
  for (const [name, urlKey, F] of [['Retail Items', 'DYN_ITEMS_URL', ITEMS], ['Replen. Qty.', 'DYN_STOCK_URL', STOCK]]) {
    const url = new URL(env(urlKey))
    url.searchParams.set('$top', '3')
    const rows = (await get(url.toString(), auth)).value ?? []
    console.log(`\n=== ${name} (${urlKey}) ===`)
    if (!rows.length) { console.log('Connected, but the service returned no rows.'); continue }
    console.log('Fields on the service:')
    for (const k of Object.keys(rows[0])) console.log(`  ${k.padEnd(36)} ${JSON.stringify(rows[0][k])}`)
    console.log('\nWhat the app expects, and whether that field exists:')
    for (const [ours, theirs] of Object.entries(F)) console.log(`  ${ours.padEnd(20)} <- ${String(theirs ?? '(not mapped)').padEnd(30)} ${!theirs ? '' : theirs in rows[0] ? 'found' : 'NOT FOUND, set it in the field map'}`)
  }
}

async function loadExisting(sb, table, key, where) {
  const existing = new Map()
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(`${key},fingerprint${table === 'items' ? ',removed' : ''}`).order(key).range(from, from + 999)
    if (where) q = q.eq(where[0], where[1])
    const { data, error } = await q
    if (error) throw error
    for (const r of data) existing.set(r[key], { fingerprint: r.fingerprint, removed: r.removed })
    if (data.length < 1000) break
  }
  return existing
}

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

/** Reads the item list from NAV. */
async function fetchItems(auth) {
  console.log('Items (Retail Items)')
  const raw = await fetchAll(env('DYN_ITEMS_URL'), ITEMS, process.env.DYN_ITEMS_FILTER, auth)
  const items = raw.map((r) => toItem(r, ITEMS)).filter((i) => i.code)
  if (items.length < 100) throw new Error(`Only ${items.length} items returned, refusing to sync`)
  return items
}

/** Reads every store's stock from NAV and groups it by store. Only our stores' locations are requested. */
async function fetchStock(sb, auth, itemsByCode) {
  console.log('Stock (Replen. Qty.)')
  const { data: stores, error } = await sb.from('stores').select('id,name,code').eq('active', true)
  if (error) throw error
  const filter = process.env.DYN_STOCK_FILTER ?? locationFilter(STOCK.location, stores.map((s) => s.code))
  const raw = await fetchAll(env('DYN_STOCK_URL'), STOCK, filter, auth)
  const { byStore, skipped } = groupStock(raw.map((r) => toStock(r, STOCK, itemsByCode)), stores, new Set(itemsByCode.keys()))
  console.log(`  ${raw.length} rows. Left out: ${skipped.unknownLocation} for other locations, ${skipped.variant} variant rows, ${skipped.unknownItem} items not in the item list`)
  return { stores, byStore }
}

/** Writes the item list. Only items that are ranged in at least one store are kept: the rest of NAV's catalogue is not orderable here. */
async function writeItems(sb, items) {
  const existing = await loadExisting(sb, 'items', 'code')
  const plan = planChanges(items, existing, 'code', itemFingerprint)
  const activeCount = [...existing.values()].filter((e) => !e.removed).length
  if (removalLooksWrong(plan.toRemove.length, activeCount) && !process.env.FORCE_REMOVE) {
    throw new Error(`${plan.toRemove.length} of ${activeCount} items would be marked removed, which looks like a partial response. Set FORCE_REMOVE=1 if this is real.`)
  }
  const at = new Date().toISOString()
  for (const batch of chunks(plan.toUpsert, 1000)) {
    const rows = batch.map(({ _moq, _store_cost, ...r }) => ({ ...r, synced_at: at, removed: false }))
    const { error } = await sb.from('items').upsert(rows, { onConflict: 'code' })
    if (error) throw error
  }
  for (const codes of chunks(plan.toRemove, 500)) {
    const { error } = await sb.from('items').update({ removed: true, synced_at: at }).in('code', codes)
    if (error) throw error
  }
  console.log(`  ${items.length} ranged items: ${plan.toUpsert.length} written, ${plan.unchanged} unchanged, ${plan.toRemove.length} removed`)
}

/** Publishes each store on its own. Returns how many stores failed and kept their previous data. */
async function writeStock(sb, stores, byStore) {
  let failed = 0
  for (const store of stores) {
    const { data: run } = await sb.from('sync_runs').insert({ store_id: store.id }).select('id').single()
    const finish = (patch) => sb.from('sync_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('id', run?.id)
    try {
      const entry = byStore.get(store.id) ?? { rows: new Map(), duplicates: [] }
      const existing = await loadExisting(sb, 'store_stock', 'item_code', ['store_id', store.id])
      const problem = storeProblem(entry.rows.size, existing.size, entry.duplicates)
      if (problem) throw new Error(problem)

      const plan = planChanges([...entry.rows.values()], existing, 'item_code', stockFingerprint)
      const at = new Date().toISOString()
      for (const batch of chunks(plan.toUpsert, 1000)) {
        const rows = batch.map(({ location, variant, ...r }) => ({ ...r, store_id: store.id, synced_at: at }))
        const { error: e } = await sb.from('store_stock').upsert(rows, { onConflict: 'store_id,item_code' })
        if (e) throw e
      }
      for (const codes of chunks(plan.toRemove, 500)) {
        const { error: e } = await sb.from('store_stock').delete().eq('store_id', store.id).in('item_code', codes)
        if (e) throw e
      }
      const msg = `${entry.rows.size} items: ${plan.toUpsert.length} written, ${plan.unchanged} unchanged, ${plan.toRemove.length} gone`
      await finish({ ok: true, rows: entry.rows.size, message: msg })
      console.log(`  ${store.name} (${store.code}): ${msg}`)
    } catch (e) {
      failed++
      const message = String(e.message ?? e).slice(0, 500)
      await finish({ ok: false, message })
      console.error(`  ${store.name} (${store.code}): FAILED. ${message}`)
    }
  }
  return failed
}

/**
 * Reads everything from NAV and works out what each store would get, using the store list in src/data/stores.json.
 * Needs only the DYN_* settings (no Supabase) and writes nothing anywhere.
 */
async function dryRun() {
  const auth = await authHeader()
  const stores = JSON.parse(readFileSync(new URL('../src/data/stores.json', import.meta.url), 'utf8')).map((s) => ({ id: s.code, code: s.code, name: s.name }))
  console.log('Items (Retail Items)')
  const rawItems = await fetchAll(env('DYN_ITEMS_URL'), ITEMS, process.env.DYN_ITEMS_FILTER, auth)
  const items = rawItems.map((r) => toItem(r, ITEMS)).filter((i) => i.code)
  const byCode = new Map(items.map((i) => [i.code, i]))
  const noVendor = items.filter((i) => !i.vendor_no).length
  console.log(`  ${items.length} items, ${noVendor} with no vendor, ${items.filter((i) => i.barcode).length} with a barcode, ${items.filter((i) => i._moq > 1).length} with a MOQ above 1`)

  console.log('Stock (Replen. Qty.)')
  const filter = process.env.DYN_STOCK_FILTER ?? locationFilter(STOCK.location, stores.map((s) => s.code))
  const raw = await fetchAll(env('DYN_STOCK_URL'), STOCK, filter, auth)
  const { byStore, skipped } = groupStock(raw.map((r) => toStock(r, STOCK, byCode)), stores, new Set(byCode.keys()))
  console.log(`  ${raw.length} rows. Left out: ${skipped.unknownLocation} other locations, ${skipped.variant} variant rows, ${skipped.unknownItem} items not in the item list`)
  for (const s of stores) {
    const e = byStore.get(s.id)
    if (!e) { console.log(`  ${s.name.padEnd(18)} ${s.code}  NO ROWS`); continue }
    const rows = [...e.rows.values()]
    const vendors = new Set(rows.map((r) => r.vendor_no).filter(Boolean))
    const problem = storeProblem(rows.length, 0, e.duplicates)
    console.log(`  ${s.name.padEnd(18)} ${s.code}  ${String(rows.length).padStart(5)} items, ${vendors.size} vendors, ${rows.filter((r) => r.inventory > 0).length} in stock, ${rows.filter((r) => !r.vendor_no).length} without a vendor${problem ? '  PROBLEM: ' + problem : ''}`)
  }
}

async function main() {
  if (process.argv.includes('--discover')) return discover()
  if (process.argv.includes('--dry-run')) return dryRun()
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const auth = await authHeader()

  const { data: run } = await sb.from('sync_runs').insert({ store_id: null }).select('id').single() // the item list itself
  const finishItems = (patch) => sb.from('sync_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('id', run?.id)
  let stores, byStore
  try {
    const all = await fetchItems(auth)
    ;({ stores, byStore } = await fetchStock(sb, auth, new Map(all.map((i) => [i.code, i]))))
    const ranged = new Set([...byStore.values()].flatMap((e) => [...e.rows.keys()]))
    const items = all.filter((i) => ranged.has(i.code))
    if (items.length < 100) throw new Error(`Only ${items.length} ranged items found, refusing to sync`)
    await writeItems(sb, items)
    await finishItems({ ok: true, rows: items.length, message: 'Item list synced' })
  } catch (e) {
    await finishItems({ ok: false, message: String(e.message ?? e).slice(0, 500) })
    if (String(e.message).includes('Dynamics rejected')) await discover().catch(() => {})
    throw e // no item list, no stock: every store keeps yesterday's data
  }

  const failed = await writeStock(sb, stores, byStore)
  if (failed) throw new Error(`${failed} store(s) kept their previous data. See the Stores tab.`)
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
