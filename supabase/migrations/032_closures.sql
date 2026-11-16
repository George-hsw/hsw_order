-- Store closures: when a store closes, an operations person uploads what it holds, the app suggests which other stores should take which items
-- (from each store's sales and stock), he adjusts, and sends one request to each receiving store, who accepts, declines or lowers it, copies it
-- into NAV as a transfer, and marks it received.
--
--   closures / closure_lines / closure_stores / closure_alloc   the draft: the sheet, the stores taking part, and who gets how much (operations only)
--   transfer_requests / transfer_request_lines                   what was sent: one request per receiving store (that store, and operations, can read it)
--
-- Nobody writes these tables directly. Every change goes through a function below that checks who is calling, locks the row it changes,
-- and refuses anything that does not add up (an item given out above what the sheet says, a request answered twice, another store's request).

create table if not exists public.closures (
  id               uuid primary key default gen_random_uuid(),
  closing_store_id uuid not null references public.stores (id),
  name             text not null default '' check (char_length(name) <= 100),
  status           text not null default 'draft' check (status in ('draft', 'sent', 'cancelled')),
  source_file      text not null default '' check (char_length(source_file) <= 200),
  created_by       text not null default public.jwt_email(),
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);

create table if not exists public.closure_lines (
  closure_id  uuid not null references public.closures (id) on delete cascade,
  item_code   text not null check (length(item_code) between 1 and 40),
  qty         integer not null check (qty > 0 and qty <= 999999),
  description text not null default '' check (char_length(description) <= 200),
  system_qty  numeric,                       -- what the closing store's stock said when the sheet was uploaded (a warning only: the sheet is the truth)
  unit_cost   numeric not null default 0,    -- the closing store's cost then
  primary key (closure_id, item_code)
);

create table if not exists public.closure_stores (
  closure_id uuid not null references public.closures (id) on delete cascade,
  store_id   uuid not null references public.stores (id),
  primary key (closure_id, store_id)
);

create table if not exists public.closure_alloc (
  closure_id    uuid not null,
  store_id      uuid not null,
  item_code     text not null,
  qty           integer not null check (qty >= 0 and qty <= 999999),
  suggested_qty integer not null default 0 check (suggested_qty >= 0),
  primary key (closure_id, store_id, item_code),
  foreign key (closure_id, item_code) references public.closure_lines (closure_id, item_code) on delete cascade,
  foreign key (closure_id, store_id) references public.closure_stores (closure_id, store_id) on delete cascade
);

create table if not exists public.transfer_requests (
  id             uuid primary key default gen_random_uuid(),
  closure_id     uuid not null references public.closures (id) on delete cascade,
  from_store_id  uuid not null references public.stores (id),
  from_store_name text not null default '',     -- the closing store's name when it was sent: a receiving store cannot read the stores table
  to_store_id    uuid not null references public.stores (id),
  round          integer not null default 1,    -- a re-offer to the same store is a new request with the next round
  status         text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'received', 'cancelled')),
  decline_reason text not null default '' check (char_length(decline_reason) <= 500),
  sent_at        timestamptz not null default now(),
  sent_by        text not null default public.jwt_email(),
  responded_at   timestamptz,
  responded_by   text,
  copied_at      timestamptz,
  received_at    timestamptz,
  received_by    text,
  unique (closure_id, to_store_id, round)
);
create index if not exists transfer_requests_to_idx on public.transfer_requests (to_store_id, status);

create table if not exists public.transfer_request_lines (
  request_id    uuid not null references public.transfer_requests (id) on delete cascade,
  item_code     text not null,
  description   text not null default '',
  qty_requested integer not null check (qty_requested > 0),
  qty_accepted  integer check (qty_accepted >= 0 and qty_accepted <= qty_requested),   -- null until the store answers
  unit_cost     numeric not null default 0,
  primary key (request_id, item_code)
);

-- ---------- Who can read ----------
alter table public.closures               enable row level security;
alter table public.closure_lines          enable row level security;
alter table public.closure_stores         enable row level security;
alter table public.closure_alloc          enable row level security;
alter table public.transfer_requests      enable row level security;
alter table public.transfer_request_lines enable row level security;

-- The draft is for operations and admins only.
create policy closures_select       on public.closures       for select using ((select public.ops_ok()));
create policy closure_lines_select  on public.closure_lines  for select using ((select public.ops_ok()));
create policy closure_stores_select on public.closure_stores for select using ((select public.ops_ok()));
create policy closure_alloc_select  on public.closure_alloc  for select using ((select public.ops_ok()));
-- A request: operations and admins, and the members of the store it was sent to. The closing store's staff read nothing, and no store sees another's share.
create policy transfer_requests_select on public.transfer_requests for select
  using ((select public.ops_ok()) or to_store_id in (select public.my_store_ids()));
create policy transfer_request_lines_select on public.transfer_request_lines for select
  using (request_id in (select r.id from public.transfer_requests r));

grant select on public.closures, public.closure_lines, public.closure_stores, public.closure_alloc, public.transfer_requests, public.transfer_request_lines to authenticated;
grant all on public.closures, public.closure_lines, public.closure_stores, public.closure_alloc, public.transfer_requests, public.transfer_request_lines to service_role;

-- A store's screen updates the moment its request changes.
alter table public.transfer_requests replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.transfer_requests; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------- What each store could take: the per-item twin of order_needs ----------
-- The same rules as Needs ordering (migrations 020 and 022): demand from the last 13 weeks (60% of the latest 5, 40% of all 13, a one-week spike
-- capped, the store's own trend), cover from the store's target weeks, customers waiting, and what it already has (stock, on order, on its way,
-- in an open order). On top of that, what other closures have already asked it to take counts as stock, so two closures never fill the same
-- shortfall. Only for the codes and stores asked about, so a big sheet stays well inside the time limit.
create or replace function public.closure_need(p_stores uuid[], p_items text[], p_exclude_closure uuid default null)
returns table (store_id uuid, item_code text, rate float8, have float8, wanted float8, shortfall numeric, cost numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  return query
  with gw as (select s.fy * 100 + s.week as wk from public.sales_weeks s order by s.fy desc, s.week desc limit 13),
  rws as (
    select s.store_id, s.item_code, s.wk, greatest(s.qty, 0)::float8 as q
      from public.sales_item_week s
     where s.store_id = any(p_stores) and s.item_code = any(p_items) and s.wk in (select wk from gw)
  ),
  sw as (
    select d.store_id, d.wk, row_number() over (partition by d.store_id order by d.wk) as n, count(*) over (partition by d.store_id) as cnt
      from (select distinct r.store_id, r.wk from rws r) d
  ),
  its as (select distinct r.store_id, r.item_code from rws r),
  grid as (
    select i.store_id, i.item_code, w.n, w.cnt, coalesce(r.q, 0::float8) as q
      from its i join sw w on w.store_id = i.store_id
      left join rws r on r.store_id = i.store_id and r.item_code = i.item_code and r.wk = w.wk
  ),
  st as (select g.store_id, g.item_code, avg(g.q) as m, sum(g.q) as units from grid g group by g.store_id, g.item_code),
  cap as (
    select g.store_id, g.item_code, g.n, g.cnt, least(g.q, greatest(2.5 * s.m, 3::float8)) as c
      from grid g join st s on s.store_id = g.store_id and s.item_code = g.item_code
  ),
  dem as (
    select c.store_id, c.item_code, avg(c.c) filter (where c.n > c.cnt - 5) as recent, avg(c.c) as long
      from cap c group by c.store_id, c.item_code
  ),
  tot as (select r.store_id, r.wk, sum(r.q) as u from rws r group by r.store_id, r.wk),
  trend as (
    select t.store_id, least(1.3::float8, greatest(0.4::float8, avg(t.u) filter (where w.n > w.cnt - 4) / nullif(avg(t.u), 0))) as trend
      from tot t join sw w on w.store_id = t.store_id and w.wk = t.wk group by t.store_id
  ),
  wait as (
    select d.store_id,
           case when jsonb_typeof(l.value -> 'code') = 'string' then nullif(trim(l.value ->> 'code'), '') end as code,
           sum(case when trim(coalesce(l.value ->> 'qty', '')) ~ '^[0-9]+(\.[0-9]+)?$' and trim(l.value ->> 'qty')::numeric > 0
                    then round(trim(l.value ->> 'qty')::numeric) else 1 end)::float8 as w
      from public.documents d
      cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload -> 'lines') = 'array' then d.payload -> 'lines' else '[]'::jsonb end) as l(value)
     where d.doc_type = 'Customer Order' and d.fulfilment = 'to_order' and d.store_id = any(p_stores)
     group by 1, 2
  ),
  inord as (
    select o.store_id, o.vendor_no, ol.item_code, sum(ol.qty)::float8 as q
      from public.orders o join public.order_lines ol on ol.order_id = o.id
     where o.store_id = any(p_stores) and o.status <> 'ordered' and ol.item_code = any(p_items)
     group by o.store_id, o.vendor_no, ol.item_code
  ),
  pend as (
    select r.to_store_id as store_id, l.item_code,
           sum(case when r.status = 'accepted' then coalesce(l.qty_accepted, l.qty_requested) else l.qty_requested end)::float8 as q
      from public.transfer_requests r join public.transfer_request_lines l on l.request_id = r.id
     where r.status in ('sent', 'accepted') and r.to_store_id = any(p_stores) and l.item_code = any(p_items)
       and (p_exclude_closure is null or r.closure_id <> p_exclude_closure)
     group by r.to_store_id, l.item_code
  ),
  base as (
    select k.store_id, k.item_code,
           k.store_cost::float8 as cost, coalesce(pf.cover_weeks, 4)::float8 as cover, coalesce(s.units, 0) as units, coalesce(w.w, 0::float8) as waiting,
           (coalesce(d.recent, 0) * 0.6 + coalesce(d.long, 0) * 0.4) * coalesce(t.trend, 1::float8) as rate,
           greatest(0, k.inventory)::float8 + greatest(0, k.qty_on_po)::float8 + greatest(0, k.transfer_in)::float8
             + coalesce(io.q, 0::float8) + coalesce(pe.q, 0::float8) as have
      from public.store_stock k
      join public.stores sto on sto.id = k.store_id and sto.active
      join public.items it on it.code = k.item_code and not it.removed
      left join dem d on d.store_id = k.store_id and d.item_code = k.item_code
      left join st s on s.store_id = k.store_id and s.item_code = k.item_code
      left join trend t on t.store_id = k.store_id
      left join wait w on w.store_id = k.store_id and w.code = k.item_code
      left join inord io on io.store_id = k.store_id and io.vendor_no = k.vendor_no and io.item_code = k.item_code
      left join pend pe on pe.store_id = k.store_id and pe.item_code = k.item_code
      left join public.store_prefs pf on pf.store_id = k.store_id
     where k.store_id = any(p_stores) and k.item_code = any(p_items)
       and not it.blocked and not it.exclude_from_replen and not k.po_blocked
       and not exists (select 1 from public.store_blocked_items bi where bi.store_id = k.store_id and bi.item_code = k.item_code)
  ),
  want as (
    select b.*, case when b.rate < 0.5 then (case when b.have - b.waiting <= 0 and b.units >= 2 then 1 else 0 end) + b.waiting else b.rate * b.cover + b.waiting end as wanted
      from base b
  )
  select w.store_id, w.item_code, w.rate, w.have, w.wanted, greatest(0, ceil(w.wanted - w.have))::numeric, w.cost::numeric
    from want w;
end $$;

-- ---------- Operations: the draft ----------
create or replace function public.create_closure(p_store uuid, p_name text, p_file text)
returns public.closures
language plpgsql security definer set search_path = public as $$
declare c public.closures;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  if not exists (select 1 from public.stores where id = p_store) then raise exception 'Choose the closing store'; end if;
  insert into public.closures (closing_store_id, name, source_file) values (p_store, left(trim(coalesce(p_name, '')), 100), left(trim(coalesce(p_file, '')), 200)) returning * into c;
  return c;
end $$;

-- The sheet's lines, in chunks. The codes must exist in the item list; the closing store's stock and cost are noted beside each.
create or replace function public.add_closure_lines(p_closure uuid, p_lines jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare c public.closures; n integer; missing text; total integer;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  select * into c from public.closures where id = p_closure for update;
  if not found then raise exception 'That closure does not exist'; end if;
  if c.status <> 'draft' then raise exception 'This closure has been sent, so its list can no longer change'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'The lines must be a list'; end if;
  select string_agg(x.code, ', ') into missing from (
    select j.code from jsonb_to_recordset(p_lines) as j(code text, qty numeric, description text)
     where not exists (select 1 from public.items i where i.code = j.code and not i.removed) limit 5) x;
  if missing is not null then raise exception 'These item numbers are not in the item list: %', missing; end if;
  insert into public.closure_lines (closure_id, item_code, qty, description, system_qty, unit_cost)
    select p_closure, j.code, j.qty::integer, left(coalesce(nullif(j.description, ''), i.description, ''), 200), ss.inventory, coalesce(ss.store_cost, 0)
      from jsonb_to_recordset(p_lines) as j(code text, qty numeric, description text)
      join public.items i on i.code = j.code
      left join public.store_stock ss on ss.store_id = c.closing_store_id and ss.item_code = j.code;
  get diagnostics n = row_count;
  select count(*) into total from public.closure_lines where closure_id = p_closure;
  if total > 20000 then raise exception 'A closure can have at most 20,000 lines'; end if;
  return n;
end $$;

create or replace function public.set_closure_stores(p_closure uuid, p_stores uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare c public.closures;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  select * into c from public.closures where id = p_closure for update;
  if not found then raise exception 'That closure does not exist'; end if;
  if c.status <> 'draft' then raise exception 'This closure has been sent, so its stores can no longer change'; end if;
  if c.closing_store_id = any(p_stores) then raise exception 'The closing store cannot take its own stock'; end if;
  if exists (select 1 from unnest(p_stores) s where not exists (select 1 from public.stores st where st.id = s and st.active)) then
    raise exception 'Only open stores can take stock';
  end if;
  delete from public.closure_stores where closure_id = p_closure and not (store_id = any(p_stores));
  insert into public.closure_stores (closure_id, store_id) select p_closure, s from unnest(p_stores) s on conflict do nothing;
end $$;

-- Who gets how much. Quantity 0 takes the row away. No item may be given out above what the sheet says.
create or replace function public.save_closure_alloc(p_closure uuid, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.closures; bad text;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  select * into c from public.closures where id = p_closure for update;
  if not found then raise exception 'That closure does not exist'; end if;
  if c.status <> 'draft' then raise exception 'This closure has been sent, so its quantities can no longer change'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'The rows must be a list'; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric, suggested_qty numeric)
              where j.qty is null or j.qty < 0 or j.qty <> trunc(j.qty) or coalesce(j.suggested_qty, 0) < 0) then
    raise exception 'Quantities must be whole numbers, zero or more';
  end if;
  delete from public.closure_alloc a using jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric, suggested_qty numeric)
   where a.closure_id = p_closure and a.store_id = j.store_id and a.item_code = j.item_code and j.qty = 0;
  insert into public.closure_alloc (closure_id, store_id, item_code, qty, suggested_qty)
    select p_closure, j.store_id, j.item_code, j.qty::integer, coalesce(j.suggested_qty, 0)::integer
      from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric, suggested_qty numeric) where j.qty > 0
    on conflict (closure_id, store_id, item_code) do update set qty = excluded.qty, suggested_qty = excluded.suggested_qty;
  select string_agg(x.item_code, ', ') into bad from (
    select a.item_code from public.closure_alloc a join public.closure_lines l on l.closure_id = a.closure_id and l.item_code = a.item_code
     where a.closure_id = p_closure group by a.item_code, l.qty having sum(a.qty) > l.qty limit 5) x;
  if bad is not null then raise exception 'These items are given out above what the sheet holds: %', bad; end if;
end $$;

-- ---------- Operations: sending ----------
-- One request for each store with something to take, all in one step. Sending twice is refused.
create or replace function public.send_closure(p_closure uuid)
returns setof uuid
language plpgsql security definer set search_path = public as $$
declare c public.closures; s record; rid uuid; who text := public.jwt_email(); bad text;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  select * into c from public.closures where id = p_closure for update;
  if not found then raise exception 'That closure does not exist'; end if;
  if c.status <> 'draft' then raise exception 'This closure has already been sent'; end if;
  select string_agg(x.item_code, ', ') into bad from (
    select a.item_code from public.closure_alloc a join public.closure_lines l on l.closure_id = a.closure_id and l.item_code = a.item_code
     where a.closure_id = p_closure group by a.item_code, l.qty having sum(a.qty) > l.qty limit 5) x;
  if bad is not null then raise exception 'These items are given out above what the sheet holds: %', bad; end if;
  if not exists (select 1 from public.closure_alloc where closure_id = p_closure and qty > 0) then raise exception 'Nothing has been given to any store yet'; end if;
  for s in select a.store_id, count(*) as lines, sum(a.qty) as units from public.closure_alloc a where a.closure_id = p_closure and a.qty > 0 group by a.store_id loop
    insert into public.transfer_requests (closure_id, from_store_id, from_store_name, to_store_id, sent_by) values (p_closure, c.closing_store_id, (select name from public.stores where id = c.closing_store_id), s.store_id, who) returning id into rid;
    insert into public.transfer_request_lines (request_id, item_code, description, qty_requested, unit_cost)
      select rid, a.item_code, l.description, a.qty, l.unit_cost
        from public.closure_alloc a join public.closure_lines l on l.closure_id = a.closure_id and l.item_code = a.item_code
       where a.closure_id = p_closure and a.store_id = s.store_id and a.qty > 0;
    insert into public.audit_events (store_id, actor, action, detail)
      values (s.store_id, who, 'transfer_sent', jsonb_build_object('request', rid, 'closure', p_closure, 'from', c.closing_store_id, 'lines', s.lines, 'units', s.units));
    return next rid;
  end loop;
  update public.closures set status = 'sent', sent_at = now() where id = p_closure;
end $$;

-- A request that is still waiting for its store can be taken back.
create or replace function public.cancel_request(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare r public.transfer_requests;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  select * into r from public.transfer_requests where id = p_request for update;
  if not found then raise exception 'That request does not exist'; end if;
  if r.status <> 'sent' then raise exception 'That request has been answered, so it can no longer be taken back'; end if;
  update public.transfer_requests set status = 'cancelled' where id = p_request;
  insert into public.audit_events (store_id, actor, action, detail) values (r.to_store_id, public.jwt_email(), 'transfer_cancelled', jsonb_build_object('request', p_request));
end $$;

-- A draft that is not wanted any more.
create or replace function public.delete_closure(p_closure uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.closures;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  select * into c from public.closures where id = p_closure for update;
  if not found then return; end if;
  if c.status <> 'draft' then raise exception 'Only a closure that has not been sent can be deleted'; end if;
  delete from public.closures where id = p_closure;
end $$;

-- Stock a store declined or lowered goes to other stores as new requests (the next round). No item may go out above what is left.
create or replace function public.reoffer_lines(p_closure uuid, p_rows jsonb)
returns setof uuid
language plpgsql security definer set search_path = public as $$
declare c public.closures; s record; rid uuid; who text := public.jwt_email(); bad text; rnd integer;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  select * into c from public.closures where id = p_closure for update;
  if not found then raise exception 'That closure does not exist'; end if;
  if c.status <> 'sent' then raise exception 'Only a closure that has been sent can be offered again'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'The rows must be a list'; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric)
              where j.qty is null or j.qty <= 0 or j.qty <> trunc(j.qty)) then raise exception 'Quantities must be whole numbers above zero'; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric)
              where not exists (select 1 from public.stores st where st.id = j.store_id and st.active) or j.store_id = c.closing_store_id) then
    raise exception 'Only open stores other than the closing store can take stock';
  end if;
  -- what is left of each item: the sheet's quantity less what live requests hold (sent: as asked; accepted or received: as accepted)
  select string_agg(x.item_code, ', ') into bad from (
    select j.item_code
      from (select r2.item_code, sum(r2.qty) as qty from jsonb_to_recordset(p_rows) as r2(store_id uuid, item_code text, qty numeric) group by r2.item_code) j
      join public.closure_lines l on l.closure_id = p_closure and l.item_code = j.item_code
     where j.qty > l.qty - coalesce((
       select sum(case when r.status = 'sent' then t.qty_requested else coalesce(t.qty_accepted, 0) end)
         from public.transfer_requests r join public.transfer_request_lines t on t.request_id = r.id
        where r.closure_id = p_closure and r.status in ('sent', 'accepted', 'received') and t.item_code = j.item_code), 0)
     limit 5) x;
  if bad is not null then raise exception 'These items have less left than you are offering: %', bad; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric) where not exists (select 1 from public.closure_lines l where l.closure_id = p_closure and l.item_code = j.item_code)) then
    raise exception 'An item is not on this closure';
  end if;
  for s in select j.store_id, count(*) as lines, sum(j.qty) as units from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric) group by j.store_id loop
    select coalesce(max(round), 0) + 1 into rnd from public.transfer_requests where closure_id = p_closure and to_store_id = s.store_id;
    insert into public.transfer_requests (closure_id, from_store_id, from_store_name, to_store_id, round, sent_by) values (p_closure, c.closing_store_id, (select name from public.stores where id = c.closing_store_id), s.store_id, rnd, who) returning id into rid;
    insert into public.transfer_request_lines (request_id, item_code, description, qty_requested, unit_cost)
      select rid, j.item_code, l.description, j.qty::integer, l.unit_cost
        from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric)
        join public.closure_lines l on l.closure_id = p_closure and l.item_code = j.item_code
       where j.store_id = s.store_id;
    insert into public.audit_events (store_id, actor, action, detail)
      values (s.store_id, who, 'transfer_sent', jsonb_build_object('request', rid, 'closure', p_closure, 'from', c.closing_store_id, 'lines', s.lines, 'units', s.units, 'round', rnd));
    return next rid;
  end loop;
end $$;

-- ---------- The receiving store ----------
-- Accept (each line may be lowered) or decline (a reason is needed). A request is answered once. Only that store's people, or an admin.
create or replace function public.respond_request(p_request uuid, p_accept boolean, p_lines jsonb default null, p_reason text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare r public.transfer_requests; who text := public.jwt_email(); any_taken boolean; reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  select * into r from public.transfer_requests where id = p_request for update;
  if not found then raise exception 'That request does not exist'; end if;
  if not (public.is_admin() or public.can_use_store(r.to_store_id)) then raise exception 'No access to that request' using errcode = '42501'; end if;
  if r.status <> 'sent' then raise exception 'That request has already been answered'; end if;
  if p_accept then
    if p_lines is not null and jsonb_typeof(p_lines) <> 'array' then raise exception 'The lines must be a list'; end if;
    if p_lines is not null and exists (
         select 1 from jsonb_to_recordset(p_lines) as j(item_code text, qty_accepted numeric)
          where j.qty_accepted is null or j.qty_accepted < 0 or j.qty_accepted <> trunc(j.qty_accepted)
             or not exists (select 1 from public.transfer_request_lines t where t.request_id = p_request and t.item_code = j.item_code and j.qty_accepted <= t.qty_requested)) then
      raise exception 'Each quantity must be a whole number, no more than was asked for';
    end if;
    update public.transfer_request_lines t set qty_accepted = coalesce((select j.qty_accepted::integer from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as j(item_code text, qty_accepted numeric) where j.item_code = t.item_code), t.qty_requested)
     where t.request_id = p_request;
    select exists (select 1 from public.transfer_request_lines where request_id = p_request and qty_accepted > 0) into any_taken;
    if not any_taken then
      if reason = '' then raise exception 'Say why none of it is wanted'; end if;
      update public.transfer_requests set status = 'declined', decline_reason = reason, responded_at = now(), responded_by = who where id = p_request;
    else
      update public.transfer_requests set status = 'accepted', responded_at = now(), responded_by = who where id = p_request;
    end if;
  else
    if reason = '' then raise exception 'Say why it is declined'; end if;
    update public.transfer_request_lines set qty_accepted = 0 where request_id = p_request;
    update public.transfer_requests set status = 'declined', decline_reason = reason, responded_at = now(), responded_by = who where id = p_request;
  end if;
  insert into public.audit_events (store_id, actor, action, detail)
    values (r.to_store_id, who, 'transfer_' || (select status from public.transfer_requests where id = p_request), jsonb_build_object('request', p_request));
end $$;

create or replace function public.mark_request_copied(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare r public.transfer_requests;
begin
  select * into r from public.transfer_requests where id = p_request for update;
  if not found then raise exception 'That request does not exist'; end if;
  if not (public.is_admin() or public.can_use_store(r.to_store_id)) then raise exception 'No access to that request' using errcode = '42501'; end if;
  if r.status <> 'accepted' then raise exception 'Only an accepted request can be copied for NAV'; end if;
  update public.transfer_requests set copied_at = coalesce(copied_at, now()) where id = p_request;
end $$;

create or replace function public.mark_request_received(p_request uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare r public.transfer_requests; who text := public.jwt_email();
begin
  select * into r from public.transfer_requests where id = p_request for update;
  if not found then raise exception 'That request does not exist'; end if;
  if not (public.is_admin() or public.can_use_store(r.to_store_id)) then raise exception 'No access to that request' using errcode = '42501'; end if;
  if r.status <> 'accepted' then raise exception 'Only an accepted request can be marked received'; end if;
  update public.transfer_requests set status = 'received', received_at = now(), received_by = who where id = p_request;
  insert into public.audit_events (store_id, actor, action, detail) values (r.to_store_id, who, 'transfer_received', jsonb_build_object('request', p_request));
end $$;

revoke execute on function
  public.closure_need(uuid[], text[], uuid), public.create_closure(uuid, text, text), public.add_closure_lines(uuid, jsonb), public.set_closure_stores(uuid, uuid[]),
  public.save_closure_alloc(uuid, jsonb), public.send_closure(uuid), public.cancel_request(uuid), public.delete_closure(uuid), public.reoffer_lines(uuid, jsonb),
  public.respond_request(uuid, boolean, jsonb, text), public.mark_request_copied(uuid), public.mark_request_received(uuid)
  from public, anon;
grant execute on function
  public.closure_need(uuid[], text[], uuid), public.create_closure(uuid, text, text), public.add_closure_lines(uuid, jsonb), public.set_closure_stores(uuid, uuid[]),
  public.save_closure_alloc(uuid, jsonb), public.send_closure(uuid), public.cancel_request(uuid), public.delete_closure(uuid), public.reoffer_lines(uuid, jsonb),
  public.respond_request(uuid, boolean, jsonb, text), public.mark_request_copied(uuid), public.mark_request_received(uuid)
  to authenticated, service_role;
