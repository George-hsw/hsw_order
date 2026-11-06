-- Sales: the three weekly Power BI reports, loaded by the admin and read by stores.
--   store_week        one row per store per week (the Australian Weekly Sales "Database" sheet), this year beside last year.
--   store_day         sales for each weekday (the Daily Sales report).
--   sales_item_week   one row per item that sold, ranked or lost sales at a store that week (the Detailed Sales report).
--   sales_weeks       the Monday to Sunday dates of each week.
-- A store can read only its own rows (Row Level Security). The only things it learns about other stores are a rank ("6th of 24"),
-- chain-wide item units and an average, never another store's own figures. Only the admin writes.

create table if not exists public.sales_weeks (
  fy         int  not null,
  week       int  not null check (week between 1 and 53),
  week_start date,
  week_end   date,
  primary key (fy, week)
);

create table if not exists public.store_week (
  fy           int  not null,
  week         int  not null check (week between 1 and 53),
  store_name   text not null,
  co_fran      text not null default '',           -- Company, Franchised, Closed, eShop
  store_id     uuid references public.stores (id) on delete cascade, -- null for the eShop, closed stores and stores that are not in this app
  state        text not null default '',
  region       text not null default '',
  centre_type  text not null default '',
  retail_sqm   numeric not null default 0,
  ty_sales     numeric not null default 0,
  ly_sales     numeric not null default 0,
  ty_trans     int not null default 0,
  ly_trans     int not null default 0,
  member_sales numeric not null default 0,
  member_trans int not null default 0,
  stock        numeric not null default 0,
  sys_sales    numeric not null default 0,
  gp_ty        numeric not null default 0,
  gp_ly        numeric not null default 0,
  qty_sold     int not null default 0,
  basket       numeric not null default 0,
  l4l_adjust   numeric not null default 0,
  primary key (fy, week, store_name, co_fran)
);
create index if not exists store_week_store_idx on public.store_week (store_id, fy, week);

create table if not exists public.store_day (
  fy       int  not null,
  week     int  not null,
  store_id uuid not null references public.stores (id) on delete cascade,
  weekday  int  not null check (weekday between 1 and 7), -- 1 = Monday
  ty       numeric not null default 0,
  ly       numeric not null default 0,
  primary key (fy, week, store_id, weekday)
);

create table if not exists public.sales_item_week (
  fy              int  not null,
  week            int  not null,
  store_id        uuid not null references public.stores (id) on delete cascade,
  item_code       text not null,
  wk              int  generated always as (fy * 100 + week) stored,
  description     text not null default '',
  vendor_no       text,
  division        text,
  qty             numeric not null default 0,
  net_sales       numeric not null default 0,
  store_rank      int  not null default 0,
  group_qty       numeric not null default 0,
  group_net       numeric not null default 0,
  stores_stocking int  not null default 0,
  business_rank   int  not null default 0,
  potential_sales numeric not null default 0,
  potential_loss  numeric not null default 0,
  moq             numeric not null default 1,
  primary key (fy, week, store_id, item_code)
);
create index if not exists sales_item_week_store_idx on public.sales_item_week (store_id, wk);

-- What was loaded and when, for the admin's upload screen.
create table if not exists public.report_uploads (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('detailed', 'weekly', 'daily')),
  fy          int  not null,
  week        int  not null,
  row_count   int  not null default 0,
  uploaded_by text not null default '',
  uploaded_at timestamptz not null default now()
);

-- ---------- Row Level Security ----------
alter table public.sales_weeks      enable row level security;
alter table public.store_week       enable row level security;
alter table public.store_day        enable row level security;
alter table public.sales_item_week  enable row level security;
alter table public.report_uploads   enable row level security;

-- Week dates are not private: anyone in a store may read them.
drop policy if exists sales_weeks_select on public.sales_weeks;
create policy sales_weeks_select on public.sales_weeks for select using (public.in_any_store());
drop policy if exists sales_weeks_admin on public.sales_weeks;
create policy sales_weeks_admin on public.sales_weeks for all using (public.is_admin()) with check (public.is_admin());

-- A store's own rows only. Rows with no store (the eShop, closed stores) are the admin's alone.
drop policy if exists store_week_select on public.store_week;
create policy store_week_select on public.store_week for select using (public.is_admin() or (store_id is not null and public.can_use_store(store_id)));
drop policy if exists store_week_admin on public.store_week;
create policy store_week_admin on public.store_week for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists store_day_select on public.store_day;
create policy store_day_select on public.store_day for select using (public.can_use_store(store_id));
drop policy if exists store_day_admin on public.store_day;
create policy store_day_admin on public.store_day for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists sales_item_week_select on public.sales_item_week;
create policy sales_item_week_select on public.sales_item_week for select using (public.can_use_store(store_id));
drop policy if exists sales_item_week_admin on public.sales_item_week;
create policy sales_item_week_admin on public.sales_item_week for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists report_uploads_admin on public.report_uploads;
create policy report_uploads_admin on public.report_uploads for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Where a store stands ----------

-- The caller's store's place in the league for each measure: its rank and how many are in it. Never anyone else's figures.
-- The league is every store trading that week (not closed, not the eShop), whether or not it has a login here.
create or replace function public.store_ranks(p_store uuid, p_fy int, p_week int)
returns table (metric text, rank int, of int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_use_store(p_store) then raise exception 'No access to that store' using errcode = '42501'; end if;
  return query
  with league as (
    select w.store_id, w.store_name, w.ty_sales, w.ly_sales, w.ty_trans, w.member_sales, w.retail_sqm, w.basket, w.gp_ty
      from public.store_week w
     where w.fy = p_fy and w.week = p_week and w.co_fran not in ('Closed', 'eShop') and w.ty_sales > 0
  ), m as (
    select l.store_id, 'sales'::text as metric, l.ty_sales as v from league l
    union all select l.store_id, 'growth', l.ty_sales / l.ly_sales - 1 from league l where l.ly_sales > 0
    union all select l.store_id, 'sqm', l.ty_sales / l.retail_sqm from league l where l.retail_sqm > 0
    union all select l.store_id, 'avg_sale', l.ty_sales / l.ty_trans from league l where l.ty_trans > 0
    union all select l.store_id, 'basket', l.basket from league l where l.basket > 0
    union all select l.store_id, 'member_share', l.member_sales / l.ty_sales from league l
    union all select l.store_id, 'gp', l.gp_ty from league l where l.gp_ty > 0
  ), ranked as (
    select m.store_id, m.metric, (rank() over (partition by m.metric order by m.v desc))::int as rk, (count(*) over (partition by m.metric))::int as n from m
  )
  select r.metric, r.rk, r.n from ranked r where r.store_id = p_store;
end $$;

-- Chain totals and averages for a week, only while at least three stores are in it, so no single store can be read out of them.
create or replace function public.chain_week(p_fy int, p_week int)
returns table (stores int, ty_sales numeric, ly_sales numeric, avg_store_sales numeric, avg_gp numeric, avg_basket numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.in_any_store() then raise exception 'No access' using errcode = '42501'; end if;
  return query
  select count(*)::int, sum(w.ty_sales), sum(w.ly_sales), avg(w.ty_sales), avg(nullif(w.gp_ty, 0)), avg(nullif(w.basket, 0))
    from public.store_week w
   where w.fy = p_fy and w.week = p_week and w.co_fran not in ('Closed', 'eShop') and w.ty_sales > 0
  having count(*) >= 3;
end $$;

-- A store's items for one week, with today's stock beside them. Runs as the caller, so Row Level Security limits it to their stores.
create or replace function public.store_item_sales(p_store uuid, p_fy int, p_week int)
returns table (item_code text, description text, vendor_no text, division text, qty numeric, net_sales numeric, store_rank int, group_qty numeric, group_net numeric,
               stores_stocking int, business_rank int, potential_sales numeric, potential_loss numeric, inventory numeric, moq numeric)
language sql stable security invoker set search_path = public as $$
  select s.item_code, coalesce(nullif(s.description, ''), i.description, ''), coalesce(s.vendor_no, ss.vendor_no), s.division, s.qty, s.net_sales, s.store_rank, s.group_qty, s.group_net,
         s.stores_stocking, s.business_rank, s.potential_sales, s.potential_loss, coalesce(ss.inventory, 0), coalesce(nullif(ss.moq, 0), s.moq, 1)
    from public.sales_item_week s
    left join public.store_stock ss on ss.store_id = s.store_id and ss.item_code = s.item_code
    left join public.items i on i.code = s.item_code
   where s.store_id = p_store and s.fy = p_fy and s.week = p_week
   order by s.item_code
$;

-- Keeps the last 26 weeks of item rows (they are the big table). Admin only.
create or replace function public.sales_prune(p_keep_weeks int default 26)
returns bigint
language plpgsql security definer set search_path = public as $$
declare cutoff int; n bigint;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  select min(k) into cutoff from (select fy * 100 + week as k from public.sales_weeks order by fy desc, week desc limit greatest(p_keep_weeks, 1)) t;
  delete from public.sales_item_week where wk < coalesce(cutoff, 0);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.store_ranks(uuid, int, int)  from public, anon;
revoke execute on function public.chain_week(int, int)         from public, anon;
revoke execute on function public.store_item_sales(uuid, int, int) from public, anon;
revoke execute on function public.sales_prune(int)             from public, anon;
grant execute on function public.store_ranks(uuid, int, int)  to authenticated, service_role;
grant execute on function public.chain_week(int, int)         to authenticated, service_role;
grant execute on function public.store_item_sales(uuid, int, int) to authenticated, service_role;
grant execute on function public.sales_prune(int)             to authenticated, service_role;

grant select on public.sales_weeks, public.store_week, public.store_day, public.sales_item_week to authenticated;
grant insert, update, delete on public.sales_weeks, public.store_week, public.store_day, public.sales_item_week, public.report_uploads to authenticated;
grant select on public.report_uploads to authenticated;
