import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** null when the build has no Supabase settings (the app then shows a setup message). */
export const supabase = url && key ? createClient(url, key) : null

/** `npm run demo`: no login, sample data, nothing is saved. For looking at the UI locally. */
export const DEMO = import.meta.env.VITE_DEMO === '1'

// UI hint only. The real check is Row Level Security in the database.
export const ADMIN_EMAIL = 'george.mridun@hsw.com.au'
export const MAX_STORES = 25

/** admin: everything, in every store. manager: a store's documents, payments and reports. staff: makes documents and sees only their own (shown as "Store"). */
export type Role = 'admin' | 'manager' | 'staff'
export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', manager: 'Manager', staff: 'Store' }

/** One person, one login. Which stores they are in, and as what, is in store_members. */
export interface AppUser {
  user_id: string
  email: string
  full_name: string
  active: boolean
  password_set_at: string | null
  created_at: string
}

/** A person's place in one store. A person can have several. */
export interface Member {
  user_id: string
  store_id: string
  role: 'manager' | 'staff'
}

export interface StoreRow {
  id: string
  name: string
  code: string
  address: string
  suburb: string
  phone: string
  email: string | null
  owner_email: string | null
  legal_name: string
  abn: string
  bank_name: string
  bsb: string
  account: string
  active: boolean
  password_set_at: string | null
}

export interface PaymentRow {
  amount_cents: number
  kind: 'payment' | 'deposit'
  paid_on: string
}

export interface DocRow {
  id: string
  store_id: string
  doc_type: 'Quote' | 'Tax Invoice'
  doc_number: string
  customer_name: string
  total_cents: number
  due_date: string | null
  status: 'open' | 'part_paid' | 'paid' | 'void'
  created_by: string | null
  created_at: string
  payload: unknown
  stores: { name: string } | null
  payments: PaymentRow[]
}

import storesJson from '../data/stores.json'
export const demoStores = (): StoreRow[] =>
  storesJson.map((s, i) => ({
    id: 'demo-' + i, ...s, email: i < 3 ? s.code.toLowerCase() + '@hsw.com.au' : null,
    owner_email: i < 3 ? 'owner.' + s.code.toLowerCase() + '@example.com' : null,
    legal_name: i < 3 ? 'Demo Pty Ltd t/a Howards Storage World' : '', abn: i < 3 ? '12 345 678 901' : '',
    bank_name: '', bsb: '', account: '', active: true, password_set_at: i < 3 ? new Date().toISOString() : null,
  }))
const dayAgo = (n: number) => new Date(Date.now() - n * 864e5)
export const demoDocs = (): DocRow[] => [
  { id: 'd1', store_id: 'demo-0', doc_type: 'Tax Invoice', doc_number: 'INV-MPK-1001', customer_name: 'Jo Smith', total_cents: 247187,
    due_date: isoDate(dayAgo(-4)), status: 'part_paid', created_by: 'sam@hsw.com.au', created_at: dayAgo(3).toISOString(), payload: {}, stores: { name: 'Moore Park' },
    payments: [{ amount_cents: 50000, kind: 'deposit', paid_on: isoDate(dayAgo(3)) }] },
  { id: 'd2', store_id: 'demo-1', doc_type: 'Tax Invoice', doc_number: 'INV-NTB-2040', customer_name: 'A. Nguyen', total_cents: 89900,
    due_date: isoDate(dayAgo(2)), status: 'open', created_by: 'lee@hsw.com.au', created_at: dayAgo(9).toISOString(), payload: {}, stores: { name: 'Northbridge' }, payments: [] },
  { id: 'd3', store_id: 'demo-0', doc_type: 'Quote', doc_number: 'Q-MPK-1002', customer_name: 'Pat Lee', total_cents: 129500,
    due_date: null, status: 'open', created_by: 'priya@hsw.com.au', created_at: dayAgo(1).toISOString(), payload: {}, stores: { name: 'Moore Park' }, payments: [] },
]

export const demoUsers = (): AppUser[] => [
  { user_id: 'u1', email: 'priya@hsw.com.au', full_name: 'Priya Nair', active: true, password_set_at: dayAgo(20).toISOString(), created_at: dayAgo(20).toISOString() },
  { user_id: 'u2', email: 'sam@hsw.com.au', full_name: 'Sam Carter', active: true, password_set_at: dayAgo(12).toISOString(), created_at: dayAgo(12).toISOString() },
  { user_id: 'u3', email: 'lee@hsw.com.au', full_name: 'Lee Tran', active: false, password_set_at: dayAgo(30).toISOString(), created_at: dayAgo(30).toISOString() },
]
export const demoMembers = (): Member[] => [
  { user_id: 'u1', store_id: 'demo-0', role: 'manager' },
  { user_id: 'u1', store_id: 'demo-1', role: 'manager' }, // one person, two stores
  { user_id: 'u2', store_id: 'demo-0', role: 'staff' },
  { user_id: 'u3', store_id: 'demo-1', role: 'staff' },
]

/** yyyy-mm-dd in local time (what <input type=date> and Postgres `date` use). */
export const isoDate = (d: Date) => d.toLocaleDateString('en-CA')
