-- When a store's sign-in password was last set, so the admin can see at a glance who still has none.
-- Only the date is kept here. The password itself, hashed, lives in Supabase Auth, never in these tables.

alter table public.stores add column if not exists password_set_at timestamptz;
