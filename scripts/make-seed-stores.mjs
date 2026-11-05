// Writes supabase/migrations/005_seed_stores.sql from src/data/stores.json.
// Run again only if the store list changes: node scripts/make-seed-stores.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const stores = JSON.parse(readFileSync(new URL('../src/data/stores.json', import.meta.url), 'utf8'))
const q = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const rows = stores.map((s) => `  (${q(s.name)}, ${q(s.code)}, ${q(s.address ?? '')}, ${q(s.suburb ?? '')}, ${q(s.phone ?? '')}, ${q(s.email)})`).join(',\n')

const sql = `-- The stores (NAV Location Codes). Safe to run twice: a store that already exists is left alone.
-- To change a store later, use the Stores tab.
insert into public.stores (name, code, address, suburb, phone, email) values
${rows}
on conflict do nothing;
`
writeFileSync(new URL('../supabase/migrations/005_seed_stores.sql', import.meta.url), sql)
console.log(`Wrote ${stores.length} stores`)
