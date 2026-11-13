-- Stock takes: a full count of a store, or a rolling count of one vendor or category. Staff scan an item, enter what they counted, and the line keeps
-- the system quantity it was compared with (stock as at the last sync) so the adjustment is the same whenever it is copied into NAV.
-- Everything that changes a count goes through the functions below, which check store access, detect two people counting the same item,
-- and stop edits once a count is saved. The browser can read these tables (Row Level Security) but never writes them directly.

create table if not exists public.stock_counts (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id),
  kind        text not null check (kind in ('full', 'rolling')),
  name        text not null default '' check (char_length(name) <= 80),
  scope_type  text not null default 'none' check (scope_type in ('none', 'vendor', 'category')),
  scope_value text,
  status      text not null default 'open' check (status in ('open', 'saved', 'posted')), -- open: counting. saved: finished, waiting for NAV. posted: both journals entered.
  nav_pos_ref text,                 -- the NAV item journal batch or document for the positive adjustments
  nav_neg_ref text,                 -- and for the negative adjustments
  created_by  text,
  created_at  timestamptz not null default now(),
  saved_at    timestamptz,
  posted_at   timestamptz
);
-- A store has one full count open at a time; any number of rolling counts.
create unique index if not exists stock_counts_one_full on public.stock_counts (store_id) where kind = 'full' and status = 'open';
create index if not exists stock_counts_store_idx on public.stock_counts (store_id, created_at desc);

create table if not exists public.stock_count_lines (
  id             uuid primary key default gen_random_uuid(),
  count_id       uuid not null references public.stock_counts(id) on delete cascade,
  store_id       uuid not null references public.stores(id), -- copied from the count, so access checks and Realtime stay simple
  item_code      text not null check (length(item_code) between 1 and 40), -- no foreign key: the line keeps what it needs if NAV drops the item
  counted        integer not null check (counted >= 0 and counted <= 99999),
  system_qty     numeric(12,2) not null default 0, -- the store's stock when this item was counted
  unit_cost      numeric(12,4) not null default 0,
  description    text not null default '',
  division       text,
  category       text,
  vendor_no      text,
  vendor_item_no text,
  uom            text,
  revision       integer not null default 1,
  updated_by     text,
  updated_at     timestamptz not null default now(),
  unique (count_id, item_code)       -- a repeat scan finds the same line, never a second one
);
create index if not exists stock_count_lines_store_idx on public.stock_count_lines (store_id);

alter table public.stock_counts      enable row level security;
alter table public.stock_count_lines enable row level security;
drop policy if exists stock_counts_select on public.stock_counts;
create policy stock_counts_select on public.stock_counts for select using (public.can_use_store(store_id));
drop policy if exists stock_count_lines_select on public.stock_count_lines;
create policy stock_count_lines_select on public.stock_count_lines for select using (public.can_use_store(store_id));

-- The Counts list: each count with its line totals. Runs as the caller, so Row Level Security still applies.
create or replace view public.stock_count_summaries with (security_invoker = true) as
select c.*, st.name as store_name,
       coalesce(t.lines, 0)::int as lines,
       coalesce(t.differ, 0)::int as differ,
       coalesce(t.gain, 0) as gain_value,
       coalesce(t.loss, 0) as loss_value
  from public.stock_counts c
  join public.stores st on st.id = c.store_id
  left join lateral (
    select count(*) as lines,
           count(*) filter (where l.counted <> l.system_qty) as differ,
           sum(greatest(l.counted - l.system_qty, 0) * round(l.unit_cost, 2)) as gain,
           sum(greatest(l.system_qty - l.counted, 0) * round(l.unit_cost, 2)) as loss
      from public.stock_count_lines l where l.count_id = c.id) t on true;

-- ---------- Start a count (a full count returns the one already open) ----------
create or replace function public.open_count(p_store uuid, p_kind text, p_name text, p_scope_type text, p_scope_value text)
returns public.stock_counts
language plpgsql security definer set search_path = public as $$
declare c public.stock_counts;
begin
  if not public.can_use_store(p_store) then raise exception 'No access to this store' using errcode = '42501'; end if;
  if p_kind not in ('full', 'rolling') then raise exception 'Unknown kind of count'; end if;
  if p_kind = 'full' then
    select * into c from public.stock_counts where store_id = p_store and kind = 'full' and status = 'open';
    if found then return c; end if;
  end if;
  insert into public.stock_counts (store_id, kind, name, scope_type, scope_value, created_by)
    values (p_store, p_kind, left(trim(coalesce(p_name, '')), 80), case when p_kind = 'full' then 'none' else coalesce(p_scope_type, 'none') end,
            case when p_kind = 'full' then null else nullif(trim(p_scope_value), '') end, public.jwt_email())
    on conflict (store_id) where kind = 'full' and status = 'open' do nothing
    returning * into c;
  if c.id is null then select * into c from public.stock_counts where store_id = p_store and kind = 'full' and status = 'open'; end if;
  return c;
end $$;

-- ---------- Set an item's counted quantity (null removes the line) ----------
-- p_base is the revision the caller last saw (0 = no line yet). If someone else has changed the line since, nothing is written
-- and the current line comes back. The system quantity and cost are read from the store's stock here, never taken from the caller, and
-- are kept from the first save so the adjustment stays the same whenever it is copied into NAV.
create or replace function public.save_count_line(
  p_count uuid, p_item text, p_counted integer, p_base integer,
  p_description text, p_division text, p_category text, p_vendor text, p_vendor_item text, p_uom text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.stock_counts; l public.stock_count_lines; who text := public.jwt_email(); sys numeric := 0; cost numeric := 0;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found or not public.can_use_store(c.store_id) then raise exception 'No access to this count' using errcode = '42501'; end if;
  if c.status <> 'open' then raise exception 'This count has already been saved'; end if;
  if p_counted is not null and (p_counted < 0 or p_counted > 99999) then raise exception 'Count must be a whole number from 0 to 99,999'; end if;

  select * into l from public.stock_count_lines where count_id = p_count and item_code = p_item for update;
  if coalesce(l.revision, 0) <> coalesce(p_base, 0) then
    return jsonb_build_object('status', 'conflict', 'current', case when l.id is null then null else to_jsonb(l) end);
  end if;

  if p_counted is null then
    if l.id is not null then delete from public.stock_count_lines where id = l.id; end if;
    return jsonb_build_object('status', 'ok');
  end if;

  if l.id is null then
    select ss.inventory, ss.store_cost into sys, cost from public.store_stock ss where ss.store_id = c.store_id and ss.item_code = p_item;
    insert into public.stock_count_lines (count_id, store_id, item_code, counted, system_qty, unit_cost, description, division, category, vendor_no, vendor_item_no, uom, updated_by)
      values (c.id, c.store_id, p_item, p_counted, coalesce(sys, 0), coalesce(cost, 0), coalesce(p_description, ''),
              nullif(trim(p_division), ''), nullif(trim(p_category), ''), nullif(trim(p_vendor), ''), nullif(trim(p_vendor_item), ''), nullif(trim(p_uom), ''), who);
  else
    update public.stock_count_lines
       set counted = p_counted, revision = revision + 1, updated_by = who, updated_at = now()
     where id = l.id;
  end if;
  return jsonb_build_object('status', 'ok');
end $$;

-- ---------- Full count: items with stock on the system that nobody scanned ----------
create or replace function public.count_uncounted(p_count uuid, p_limit integer default 300)
returns table (item_code text, description text, division text, category text, inventory numeric, store_cost numeric, total bigint)
language plpgsql stable security invoker set search_path = public as $$
begin
  return query
  select ss.item_code, i.description, i.division, i.category, ss.inventory, ss.store_cost, count(*) over ()
    from public.stock_counts c
    join public.store_stock ss on ss.store_id = c.store_id and ss.inventory > 0
    join public.items i on i.code = ss.item_code and not i.removed
   where c.id = p_count
     and not exists (select 1 from public.stock_count_lines l where l.count_id = c.id and l.item_code = ss.item_code)
   order by ss.inventory * ss.store_cost desc, ss.item_code
   limit greatest(p_limit, 1);
end $$;

-- ---------- Treat every unscanned item as zero (managers only; a full count only) ----------
create or replace function public.count_zero_uncounted(p_count uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare c public.stock_counts; n integer;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found or not public.can_use_store(c.store_id) then raise exception 'No access to this count' using errcode = '42501'; end if;
  if public.role_in(c.store_id) not in ('admin', 'manager') then raise exception 'Only a manager can treat uncounted items as zero' using errcode = '42501'; end if;
  if c.kind <> 'full' or c.status <> 'open' then raise exception 'Only an open full count can do this'; end if;
  insert into public.stock_count_lines (count_id, store_id, item_code, counted, system_qty, unit_cost, description, division, category, vendor_no, vendor_item_no, uom, updated_by)
    select c.id, c.store_id, ss.item_code, 0, ss.inventory, ss.store_cost, i.description, i.division, i.category, coalesce(ss.vendor_no, i.vendor_no), i.vendor_item_no, coalesce(i.base_uom, i.sales_uom), public.jwt_email()
      from public.store_stock ss
      join public.items i on i.code = ss.item_code and not i.removed
     where ss.store_id = c.store_id and ss.inventory > 0
       and not exists (select 1 from public.stock_count_lines l where l.count_id = c.id and l.item_code = ss.item_code);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Finish a count, then record each NAV journal as it is entered ----------
create or replace function public.set_count_status(p_count uuid, p_status text) returns public.stock_counts
language plpgsql security definer set search_path = public as $$
declare c public.stock_counts;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found or not public.can_use_store(c.store_id) then raise exception 'No access to this count' using errcode = '42501'; end if;
  if c.status = 'posted' then raise exception 'This count has already been posted in NAV'; end if;
  if p_status = 'saved' then
    if not exists (select 1 from public.stock_count_lines where count_id = c.id) then raise exception 'Count at least one item first'; end if;
    update public.stock_counts set status = 'saved', saved_at = coalesce(saved_at, now()) where id = c.id returning * into c;
  elsif p_status = 'open' then -- back to counting, only before anything has been entered in NAV
    if c.nav_pos_ref is not null or c.nav_neg_ref is not null then raise exception 'An adjustment has already been entered in NAV'; end if;
    update public.stock_counts set status = 'open', saved_at = null where id = c.id returning * into c;
  else
    raise exception 'Unknown status';
  end if;
  return c;
end $$;

create or replace function public.post_count_side(p_count uuid, p_side text, p_ref text) returns public.stock_counts
language plpgsql security definer set search_path = public as $$
declare c public.stock_counts; has_pos boolean; has_neg boolean;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found or not public.can_use_store(c.store_id) then raise exception 'No access to this count' using errcode = '42501'; end if;
  if c.status = 'open' then raise exception 'Save the count first'; end if;
  if c.status = 'posted' then raise exception 'This count is already posted in NAV'; end if;
  if (p_side = 'positive' and c.nav_pos_ref is not null) or (p_side = 'negative' and c.nav_neg_ref is not null) then raise exception 'That adjustment is already entered in NAV'; end if;
  if length(trim(coalesce(p_ref, ''))) = 0 then raise exception 'Enter the NAV journal reference'; end if;
  if p_side = 'positive' then update public.stock_counts set nav_pos_ref = trim(p_ref) where id = c.id returning * into c;
  elsif p_side = 'negative' then update public.stock_counts set nav_neg_ref = trim(p_ref) where id = c.id returning * into c;
  else raise exception 'Unknown side'; end if;
  select exists (select 1 from public.stock_count_lines where count_id = c.id and counted > system_qty),
         exists (select 1 from public.stock_count_lines where count_id = c.id and counted < system_qty) into has_pos, has_neg;
  if (not has_pos or c.nav_pos_ref is not null) and (not has_neg or c.nav_neg_ref is not null) then
    update public.stock_counts set status = 'posted', posted_at = now() where id = c.id returning * into c;
  end if;
  return c;
end $$;

-- A count that has not been posted in NAV can be deleted (its lines go with it).
create or replace function public.delete_count(p_count uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.stock_counts;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if not found or not public.can_use_store(c.store_id) then raise exception 'No access to this count' using errcode = '42501'; end if;
  if c.status = 'posted' then raise exception 'A count posted in NAV is kept as a record'; end if;
  delete from public.stock_counts where id = c.id;
end $$;

-- ---------- The categories a store stocks, with item counts: the choices for a rolling count by category ----------
create or replace function public.store_categories(p_store uuid)
returns table (category text, division text, items bigint)
language sql stable security invoker set search_path = public as $$
  select i.category, min(i.division), count(*)
    from public.store_stock ss
    join public.items i on i.code = ss.item_code and not i.removed
   where ss.store_id = p_store and i.category is not null and trim(i.category) <> ''
   group by i.category
   order by i.category
$$;

-- Live updates, so two people counting the same shelf see each other's lines.
alter table public.stock_count_lines replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.stock_count_lines; exception when duplicate_object then null; end;
  end if;
end $$;

grant select on public.stock_counts, public.stock_count_lines, public.stock_count_summaries to authenticated;
grant all on public.stock_counts, public.stock_count_lines to service_role;
revoke execute on function public.open_count(uuid, text, text, text, text), public.save_count_line(uuid, text, integer, integer, text, text, text, text, text, text),
  public.count_uncounted(uuid, integer), public.count_zero_uncounted(uuid), public.set_count_status(uuid, text), public.post_count_side(uuid, text, text),
  public.delete_count(uuid), public.store_categories(uuid) from public, anon;
grant execute on function public.open_count(uuid, text, text, text, text), public.save_count_line(uuid, text, integer, integer, text, text, text, text, text, text),
  public.count_uncounted(uuid, integer), public.count_zero_uncounted(uuid), public.set_count_status(uuid, text), public.post_count_side(uuid, text, text),
  public.delete_count(uuid), public.store_categories(uuid) to authenticated, service_role;
