-- Items a store has chosen not to order any more (not sellable here, or in clearance). It is the store's own preference, kept per store:
-- the same item can still be ordered at another store. A blocked item is left out of the suggested order, the Needs ordering list, the bell
-- and the Low stock counts. Anyone in the store can read the list; only the store's manager (and the admin) can change it.

create table if not exists public.store_blocked_items (
  store_id   uuid not null references public.stores(id) on delete cascade,
  item_code  text not null references public.items(code) on delete cascade,
  reason     text not null default '' check (char_length(reason) <= 200),
  blocked_by text default public.jwt_email(), -- taken from the login, never from what the browser sends
  blocked_at timestamptz not null default now(),
  primary key (store_id, item_code)
);

alter table public.store_blocked_items enable row level security;

drop policy if exists store_blocked_select on public.store_blocked_items;
create policy store_blocked_select on public.store_blocked_items for select using (public.can_use_store(store_id));
drop policy if exists store_blocked_insert on public.store_blocked_items;
create policy store_blocked_insert on public.store_blocked_items for insert with check (public.role_in(store_id) in ('admin', 'manager'));
drop policy if exists store_blocked_delete on public.store_blocked_items;
create policy store_blocked_delete on public.store_blocked_items for delete using (public.role_in(store_id) in ('admin', 'manager'));

grant select, insert, delete on public.store_blocked_items to authenticated;
grant all on public.store_blocked_items to service_role;
