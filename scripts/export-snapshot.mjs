// Scheduler 2: Supabase `items` -> public/items.json, the local copy of the price list the app loads.
// Run by .github/workflows/publish-prices.yml, which commits the file when the prices have changed.
// The file is only rewritten when the items actually differ, so a quiet night makes no commit.
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')

const sb = createClient(url, key, { auth: { persistSession: false } })
const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb
    .from('items')
    .select('code,description,price,status,barcode')
    .eq('removed', false)
    .order('code')
    .range(from, from + 999)
  if (error) throw error
  rows.push(...data)
  if (data.length < 1000) break
}
// Never replace a good local copy with an empty or truncated one.
if (rows.length < 100) throw new Error(`Only ${rows.length} items in Supabase, refusing to overwrite the price list`)

const items = rows.map((r) => [r.code, r.description, r.price === null ? null : Number(r.price), r.status, r.barcode ?? ''])
const FILE = 'public/items.json'
if (existsSync(FILE)) {
  try {
    const old = JSON.parse(readFileSync(FILE, 'utf8'))
    if (JSON.stringify(old.items) === JSON.stringify(items)) {
      console.log(`no price changes (${items.length} items), ${FILE} left as it is`)
      process.exit(0)
    }
  } catch { /* unreadable: write a fresh one */ }
}
mkdirSync('public', { recursive: true })
writeFileSync(FILE, JSON.stringify({ generatedAt: new Date().toISOString(), source: 'supabase', items }))
console.log(`wrote ${FILE} with ${items.length} items`)
