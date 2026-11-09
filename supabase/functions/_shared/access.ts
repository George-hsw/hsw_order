// Who is calling, and what may they touch? The same rules as the database (migration 012), for the functions
// that use the service role and so bypass Row Level Security.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { ADMIN_EMAIL } from './cors.ts'

export type StoreRole = 'manager' | 'staff'
/** What the caller may do in each store they belong to. admin: every store. */
export interface Access { admin: boolean; stores: Record<string, StoreRole> }

/** null = this person may not use the app (unknown, or turned off). */
export async function accessOf(admin: SupabaseClient, userId: string | undefined, email: string): Promise<Access | null> {
  if (email === ADMIN_EMAIL) return { admin: true, stores: {} }
  const stores: Record<string, StoreRole> = {}
  if (userId) {
    const { data: person } = await admin.from('app_users').select('active').eq('user_id', userId).maybeSingle()
    if (person) {
      if (!person.active) return null
      const { data: mine } = await admin.from('store_members').select('store_id,role,stores(active)').eq('user_id', userId)
      for (const m of mine ?? []) if ((m.stores as { active: boolean } | null)?.active) stores[m.store_id] = m.role as StoreRole
    }
  }
  // A shared store login (stores.email, the original way) acts as a manager of its store.
  const { data: shared } = await admin.from('stores').select('id,email').eq('active', true)
  for (const s of shared ?? []) if (String(s.email ?? '').toLowerCase() === email) stores[s.id] = 'manager'
  return Object.keys(stores).length ? { admin: false, stores } : null
}

type Doc = { store_id: string; created_by: string | null }

/** Admin: any document. Manager and Store: any document in their own store. */
export function canActOnDoc(a: Access | null, doc: Doc, _email: string): boolean {
  return !!a && (a.admin || !!a.stores[doc.store_id])
}

/** Anyone who works in the store, and the admin, can record a deposit or payment on its documents. */
export function canTakePayment(a: Access | null, doc: Doc): boolean {
  return !!a && (a.admin || !!a.stores[doc.store_id])
}

/** The people who run a store: its active managers. Payment notices and copies go to them, so there is no separate owner email to keep in step. */
export async function managerEmails(admin: SupabaseClient, storeId: string): Promise<string[]> {
  const { data } = await admin.from('store_members').select('app_users(email,active)').eq('store_id', storeId).eq('role', 'manager')
  return (data ?? [])
    .map((m) => m.app_users as unknown as { email: string; active: boolean } | null)
    .filter((p): p is { email: string; active: boolean } => !!p && p.active)
    .map((p) => p.email.toLowerCase())
}
