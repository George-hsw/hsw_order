-- Each store's ordering preferences. For now one: how many weeks of stock the store aims to hold, which drives the Low stock
-- warning and the suggested quantity on the Order tab. Anyone in the store (and the admin) can read and change it.

create table if not exists public.store_prefs (
  store_id    uuid primary key references public.stores(id) on delete cascade,
  cover_weeks integer not null default 4 check (cover_weeks between 1 and 26),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table public.store_prefs enable row level security;

drop policy if exists store_prefs_select on public.store_prefs;
create policy store_prefs_select on public.store_prefs for select using (public.can_use_store(store_id));
drop policy if exists store_prefs_insert on public.store_prefs;
create policy store_prefs_insert on public.store_prefs for insert with check (public.can_use_store(store_id));
drop policy if exists store_prefs_update on public.store_prefs;
create policy store_prefs_update on public.store_prefs for update using (public.can_use_store(store_id)) with check (public.can_use_store(store_id));

grant select, insert, update on public.store_prefs to authenticated;
grant all on public.store_prefs to service_role;
