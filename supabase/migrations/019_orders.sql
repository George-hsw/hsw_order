-- Orders: one current order per store, with one line per item. Everything that changes an order goes through the
-- three functions below (open_order, save_line, set_order_status), which check store access, detect two people editing the
-- same line, and write the audit trail. The browser can read these tables (Row Level Security) but never write them directly.

create table if not exists public.orders (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.stores(id),
  status     text not null default 'open' check (status in ('open', 'copied', 'ordered')),
  nav_ref    text,                       -- the NAV order number(s), required once ordered
  created_by text,                       -- email as text, so the order stays if the login is deleted
  created_at timestamptz not null default now(),
  copied_at  timestamptz,
  ordered_at timestamptz,
  check (status <> 'ordered' or length(trim(coalesce(nav_ref, ''))) > 0)
);
-- A store has at most one current order (open or copied, not yet ordered in NAV).
create unique index if not exists orders_one_current on public.orders (store_id) where status <> 'ordered';
create index if not exists orders_store_idx on public.orders (store_id, created_at desc);

create table if not exists public.order_lines (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  store_id    uuid not null references public.stores(id), -- copied from the order, so access checks and Realtime stay simple
  item_code   text not null check (length(item_code) between 1 and 40), -- no foreign key: the line keeps what it needs if NAV drops the item
  qty         integer not null check (qty > 0 and qty <= 99999),
  unit_cost   numeric(12,4) not null default 0, -- store cost when the line was saved
  vendor_no   text,
  division    text,
  description text not null default '',
  revision    integer not null default 1,       -- goes up on every change: how two editors are told apart
  updated_by  text,
  updated_at  timestamptz not null default now(),
  unique (order_id, item_code)                  -- a repeat scan finds the same line, never a second one
);
create index if not exists order_lines_store_idx on public.order_lines (store_id);

-- Who changed what, and when.
create table if not exists public.audit_events (
  id       bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  actor    text,
  action   text not null,
  detail   jsonb,
  at       timestamptz not null default now()
);
create index if not exists audit_events_order_idx on public.audit_events (order_id, at);

alter table public.orders       enable row level security;
alter table public.order_lines  enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select using (public.can_use_store(store_id));
drop policy if exists order_lines_select on public.order_lines;
create policy order_lines_select on public.order_lines for select using (public.can_use_store(store_id));
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select using (public.can_use_store(store_id));

-- ---------- Open the store's current order, starting one if there is none ----------
create or replace function public.open_order(p_store uuid) returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.can_use_store(p_store) then raise exception 'No access to this store' using errcode = '42501'; end if;
  select * into o from public.orders where store_id = p_store and status <> 'ordered';
  if found then return o; end if;
  insert into public.orders (store_id, created_by) values (p_store, public.jwt_email())
    on conflict (store_id) where status <> 'ordered' do nothing
    returning * into o;
  if o.id is null then -- someone else started it a moment ago
    select * into o from public.orders where store_id = p_store and status <> 'ordered';
  else
    insert into public.audit_events (store_id, order_id, actor, action) values (p_store, o.id, public.jwt_email(), 'order_started');
  end if;
  return o;
end $$;

-- ---------- Done on the phone: set an item's line to an absolute quantity (0 removes it) ----------
-- p_base is the revision the caller last saw (0 = no line yet). If someone else has changed the line since, nothing is
-- written and the current line comes back, so one person never overwrites another unseen.
create or replace function public.save_line(
  p_order uuid, p_item text, p_qty integer, p_base integer,
  p_unit_cost numeric, p_vendor text, p_division text, p_description text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; l public.order_lines; who text := public.jwt_email();
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not public.can_use_store(o.store_id) then raise exception 'No access to this order' using errcode = '42501'; end if;
  if o.status = 'ordered' then raise exception 'This order has already been ordered in NAV'; end if;
  if p_qty is null or p_qty < 0 or p_qty > 99999 then raise exception 'Quantity must be a whole number from 0 to 99,999'; end if;

  select * into l from public.order_lines where order_id = p_order and item_code = p_item for update;
  if coalesce(l.revision, 0) <> coalesce(p_base, 0) then
    return jsonb_build_object('status', 'conflict', 'current', case when l.id is null then null else to_jsonb(l) end);
  end if;

  if p_qty = 0 then
    if l.id is not null then
      delete from public.order_lines where id = l.id;
      insert into public.audit_events (store_id, order_id, actor, action, detail)
        values (o.store_id, o.id, who, 'line_removed', jsonb_build_object('item', p_item, 'was', l.qty));
    end if;
    return jsonb_build_object('status', 'ok');
  end if;

  if l.id is null then
    insert into public.order_lines (order_id, store_id, item_code, qty, unit_cost, vendor_no, division, description, updated_by)
      values (o.id, o.store_id, p_item, p_qty, coalesce(p_unit_cost, 0), nullif(trim(p_vendor), ''), nullif(trim(p_division), ''),
              coalesce(p_description, ''), who);
  else
    update public.order_lines
       set qty = p_qty, unit_cost = coalesce(p_unit_cost, unit_cost), vendor_no = nullif(trim(p_vendor), ''),
           division = nullif(trim(p_division), ''), description = coalesce(p_description, description),
           revision = revision + 1, updated_by = who, updated_at = now()
     where id = l.id;
  end if;
  insert into public.audit_events (store_id, order_id, actor, action, detail)
    values (o.store_id, o.id, who, 'line_saved', jsonb_build_object('item', p_item, 'qty', p_qty, 'was', l.qty));
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------- Copied, then Ordered in NAV (with its NAV order number) ----------
create or replace function public.set_order_status(p_order uuid, p_status text, p_nav_ref text default null)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not public.can_use_store(o.store_id) then raise exception 'No access to this order' using errcode = '42501'; end if;
  if o.status = 'ordered' then raise exception 'This order has already been ordered in NAV'; end if;
  if not exists (select 1 from public.order_lines where order_id = o.id) then raise exception 'Add at least one item first'; end if;

  if p_status = 'copied' then
    update public.orders set status = 'copied', copied_at = now() where id = o.id returning * into o;
  elsif p_status = 'ordered' then
    if length(trim(coalesce(p_nav_ref, ''))) = 0 then raise exception 'Enter the NAV order number'; end if;
    update public.orders set status = 'ordered', nav_ref = trim(p_nav_ref), ordered_at = now(), copied_at = coalesce(copied_at, now())
     where id = o.id returning * into o;
  else
    raise exception 'Unknown status';
  end if;
  insert into public.audit_events (store_id, order_id, actor, action, detail)
    values (o.store_id, o.id, public.jwt_email(), 'order_' || p_status, jsonb_build_object('nav_ref', o.nav_ref));
  return o;
end $$;

-- The Orders list: each order with its store name and line totals. Runs as the caller, so Row Level Security still applies.
create or replace view public.order_summaries with (security_invoker = true) as
select o.*, st.name as store_name,
       coalesce(t.lines, 0)::int as lines, coalesce(t.units, 0)::int as units, coalesce(t.cost, 0) as cost
  from public.orders o
  join public.stores st on st.id = o.store_id
  left join lateral (
    select count(*) as lines, sum(qty) as units, sum(qty * round(unit_cost, 2)) as cost
      from public.order_lines where order_id = o.id) t on true;

-- Live updates: the desktop sees a line the moment the phone presses Done. Deletes carry the whole old row so they can be filtered.
alter table public.order_lines replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.order_lines; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.orders;      exception when duplicate_object then null; end;
  end if;
end $$;
