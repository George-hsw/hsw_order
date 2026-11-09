-- Merge step 1: the shared tables and helpers the ordering side needs, added on top of the Quote schema (001 to 017).
-- Everything here is additive and safe to run twice. Quote's own tables, policies and functions are not changed,
-- except in_any_store(), which is new, and stores gets a delete policy for the admin (Quote had none).

-- ---------- Items: the Quote list plus what ordering needs ----------
-- One table for both apps. The NAV sync fills every column; Quote only reads code, description, price, status, division,
-- category and barcode, so nothing it uses changes.
alter table public.items add column if not exists vendor_no           text;
alter table public.items add column if not exists vendor_item_no      text;
alter table public.items add column if not exists sales_uom           text;
alter table public.items add column if not exists base_uom            text;
alter table public.items add column if not exists blocked             boolean not null default false;
alter table public.items add column if not exists exclude_from_replen boolean not null default false;
alter table public.items add column if not exists fingerprint         text; -- the sync compares this to write only what changed
create index if not exists items_barcode_idx on public.items (barcode) where barcode is not null;
create index if not exists items_vendor_idx  on public.items (vendor_no);

-- Store codes are the NAV location code. The South Wharf code in Replen. Qty. is 13006C (13006 is a closed location).
update public.stores set code = '13006C' where name = 'South Wharf' and code = '13006';

-- ---------- Who may see the shared lists ----------
-- Does the caller belong to any store at all (or is the admin)? A shared store login (stores.email) counts, as it does in role_in().
create or replace function public.in_any_store() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.store_members m
                   join public.app_users u on u.user_id = m.user_id
                   join public.stores st on st.id = m.store_id
                  where m.user_id = auth.uid() and u.active and st.active)
      or exists (select 1 from public.stores where active and lower(email) = public.jwt_email())
$$;

-- ---------- What the nightly NAV sync fills for ordering ----------
-- One row per store and item, as at the last sync.
create table if not exists public.store_stock (
  store_id    uuid not null references public.stores(id) on delete cascade,
  item_code   text not null references public.items(code) on delete cascade,
  inventory   numeric(12,2) not null default 0,   -- Replen. Qty. Inventory (4)
  qty_on_po   numeric(12,2) not null default 0,   -- Quantity on Purchase Order (5)
  moq         numeric(12,2) not null default 1,
  store_cost  numeric(12,4) not null default 0,
  sales_qty   numeric(12,2) not null default 0,   -- units sold last week, shown for information only
  vendor_no   text,                               -- Replen. Qty. Vendor No. (33): who this store orders it from
  po_blocked  boolean not null default false,     -- PO Blocked (41)
  fingerprint text,
  synced_at   timestamptz not null default now(),
  primary key (store_id, item_code)
);
create index if not exists store_stock_vendor_idx on public.store_stock (store_id, vendor_no);

-- One row per store per sync run, so Stores can show when each store last synced and why one failed.
create table if not exists public.sync_runs (
  id          bigint generated always as identity primary key,
  store_id    uuid references public.stores(id) on delete cascade, -- null = the item list itself
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  rows        integer not null default 0,
  message     text
);
create index if not exists sync_runs_store_idx on public.sync_runs (store_id, finished_at desc);

alter table public.items       enable row level security;
alter table public.store_stock enable row level security;
alter table public.sync_runs   enable row level security;

-- items had no policy (service role only) for Quote; signed-in people in a store may now read it for ordering.
drop policy if exists items_select on public.items;
create policy items_select on public.items for select using (public.in_any_store() and not removed);
drop policy if exists store_stock_select on public.store_stock;
create policy store_stock_select on public.store_stock for select using (public.can_use_store(store_id));
drop policy if exists sync_runs_select on public.sync_runs;
create policy sync_runs_select on public.sync_runs for select
  using (public.is_admin() or (store_id is not null and public.can_use_store(store_id)));
-- No write policies: only the sync job (service role) writes these tables.

-- The admin can delete a store (Quote's policies only allowed insert and update).
drop policy if exists stores_admin_delete on public.stores;
create policy stores_admin_delete on public.stores for delete using (public.is_admin());
