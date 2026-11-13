-- Area manager: a person who can READ every active store's sales (this week against last year, the league, items, ranks) and nothing else.
-- No stock, orders, quotes, documents or payments, no store bank details, nothing to change. Only an admin turns it on (app_users.sees_all_sales);
-- people never write app_users themselves, so nobody can give themselves the role.
--
-- Admins are unchanged. Store managers and staff are unchanged: they still read only their own stores' sales.

alter table public.app_users add column if not exists sees_all_sales boolean not null default false;

create or replace function public.is_area_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users u where u.user_id = auth.uid() and u.sees_all_sales and u.active)
$$;

-- The stores whose sales the caller may read: their own stores, and for an area manager every active store.
create or replace function public.my_sales_store_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select s from public.my_store_ids() s
  union
  select st.id from public.stores st where public.is_area_manager() and st.active
$$;

-- The shared item list and week dates are open to anyone who works in a store; an area manager needs them to read item sales.
create or replace function public.in_any_store() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_area_manager() or exists (
    select 1 from public.store_members m
      join public.app_users u on u.user_id = m.user_id
      join public.stores st on st.id = m.store_id
     where m.user_id = auth.uid() and u.active and st.active)
$$;

-- ---------- Sales reads ----------
drop policy if exists sales_item_week_select on public.sales_item_week;
create policy sales_item_week_select on public.sales_item_week for select using ((select public.is_admin()) or store_id in (select public.my_sales_store_ids()));
drop policy if exists store_day_select on public.store_day;
create policy store_day_select on public.store_day for select using ((select public.is_admin()) or store_id in (select public.my_sales_store_ids()));
drop policy if exists store_week_select on public.store_week;
create policy store_week_select on public.store_week for select
  using ((select public.is_admin()) or (store_id is not null and store_id in (select public.my_sales_store_ids())));

-- Usage tracking: an area manager's views of a store's sales are logged against that store.
drop policy if exists app_events_insert on public.app_events;
create policy app_events_insert on public.app_events for insert to authenticated
  with check (user_id = auth.uid() and email = public.jwt_email()
              and (store_id is null or (select public.is_admin()) or store_id in (select public.my_sales_store_ids())));

-- ---------- Sales functions ----------
-- Ranks: the access check also accepts a store the caller may read sales for.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.store_ranks(uuid, integer, integer)'::regprocedure);
  n := replace(d, 'if not public.can_use_store(p_store) then', 'if not (public.can_use_store(p_store) or p_store in (select public.my_sales_store_ids())) then');
  if n = d then raise exception 'store_ranks: the access check to change was not found'; end if;
  execute n;
end $$;

-- A store's items for one week with today's stock beside them. It now runs as the owner so an area manager (who cannot read stock) still gets
-- the inventory and MOQ, and the access check moves into the query: only stores the caller may read sales for.
create or replace function public.store_item_sales(p_store uuid, p_fy int, p_week int)
returns table (item_code text, description text, vendor_no text, division text, qty numeric, net_sales numeric, store_rank int, group_qty numeric, group_net numeric,
               stores_stocking int, business_rank int, potential_sales numeric, potential_loss numeric, inventory numeric, moq numeric)
language sql stable security definer set search_path = public as $$
  select s.item_code, coalesce(nullif(s.description, ''), i.description, ''), coalesce(s.vendor_no, ss.vendor_no), s.division, s.qty, s.net_sales, s.store_rank, s.group_qty, s.group_net,
         s.stores_stocking, s.business_rank, s.potential_sales, s.potential_loss, coalesce(ss.inventory, 0), coalesce(nullif(ss.moq, 0), s.moq, 1)
    from public.sales_item_week s
    left join public.store_stock ss on ss.store_id = s.store_id and ss.item_code = s.item_code
    left join public.items i on i.code = s.item_code
   where s.store_id = p_store and s.fy = p_fy and s.week = p_week
     and ((select public.is_admin()) or p_store in (select public.my_sales_store_ids()))
   order by s.item_code
$$;

-- One item's stock at a store, for the sales screen's item view (an area manager cannot read the stock table itself).
create or replace function public.sales_item_stock(p_store uuid, p_code text)
returns table (inventory numeric, moq numeric, vendor_no text)
language sql stable security definer set search_path = public as $$
  select ss.inventory, ss.moq, ss.vendor_no
    from public.store_stock ss
   where ss.store_id = p_store and ss.item_code = p_code
     and ((select public.is_admin()) or p_store in (select public.my_sales_store_ids()))
$$;

revoke execute on function public.is_area_manager(), public.my_sales_store_ids(), public.store_item_sales(uuid, int, int), public.sales_item_stock(uuid, text) from public, anon;
grant execute on function public.is_area_manager(), public.my_sales_store_ids(), public.store_item_sales(uuid, int, int), public.sales_item_stock(uuid, text) to authenticated, service_role;

-- ---------- The store list an area manager may see ----------
-- Name, code and whether it trades: never an address, ABN or bank detail (those stay in the stores table, which an area manager cannot read).
create or replace view public.stores_basic as
  select st.id, st.name, st.code, st.active
    from public.stores st
   where (select public.is_admin()) or st.id in (select public.my_sales_store_ids());
grant select on public.stores_basic to authenticated;
