-- What the nightly NAV sync fills: the item list (Retail Items) and each store's stock (Replen. Qty.).
-- Both are current-state tables with no date field, so the sync stamps synced_at itself.
-- Only the sync (service role) writes these tables; signed-in people can read their own stores' data.

create table if not exists public.items (
  code                text primary key,                -- NAV "No." Always text: leading zeros are kept
  description         text        not null default '',
  vendor_no           text,
  vendor_item_no      text,
  barcode             text,
  division            text,
  category            text,
  status              text        not null default '', -- ACTIVE, NEW, ...
  price               numeric(12,2),                   -- RRP
  sales_uom           text,
  base_uom            text,
  blocked             boolean     not null default false,
  exclude_from_replen boolean     not null default false,
  fingerprint         text,                            -- the sync compares this to write only what changed
  synced_at           timestamptz not null default now(),
  removed             boolean     not null default false -- set when an item vanishes from NAV
);
create index if not exists items_barcode_idx on public.items (barcode) where barcode is not null;
create index if not exists items_vendor_idx  on public.items (vendor_no);

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

drop policy if exists items_select on public.items;
create policy items_select on public.items for select using (public.in_any_store() and not removed);
drop policy if exists store_stock_select on public.store_stock;
create policy store_stock_select on public.store_stock for select using (public.can_use_store(store_id));
drop policy if exists sync_runs_select on public.sync_runs;
create policy sync_runs_select on public.sync_runs for select
  using (public.is_admin() or (store_id is not null and public.can_use_store(store_id)));
-- No write policies: only the sync job (service role) writes these tables.
