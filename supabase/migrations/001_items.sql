-- Item price list synced from Dynamics 365 Business Central / LS Central.
-- Only retail fields are stored. Store Cost, Margin %, Vendor and Sales figures from the
-- LS export are deliberately NOT synced: the price list is published with the website.

create table if not exists public.items (
  code           text primary key,               -- LS "No."
  description    text        not null default '',
  price          numeric(12,2),                  -- GST inclusive
  status         text        not null default '',-- LS "Status Code": ACTIVE, NON-APL, EX-APL, TOS, NEW
  division       text,
  category       text,
  barcode        text,
  synced_at      timestamptz not null default now(),
  removed        boolean     not null default false -- set when an item vanishes from Dynamics
);

create index if not exists items_status_idx on public.items (status);

create table if not exists public.sync_log (
  id            bigint generated always as identity primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  ok            boolean,
  fetched       integer,
  upserted      integer,
  removed       integer,
  message       text
);

-- Lock both tables: only the service-role key (GitHub Actions secrets) can touch them.
-- The app itself reads the published snapshot (items.json), never Supabase directly.
alter table public.items    enable row level security;
alter table public.sync_log enable row level security;
-- (No policies = no access for anon/authenticated roles; service_role bypasses RLS.)
