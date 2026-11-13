-- Faster access checks. The read rules called can_use_store(store_id) and is_admin() for every row, and those functions cannot be folded
-- into a query, so a store's 13 weeks of item sales (tens of thousands of rows) meant tens of thousands of membership look-ups. On the live
-- site Needs ordering took about 8 seconds and was cut off by the database's time limit.
--
-- my_store_ids() lists the stores the caller may use, by exactly the same rules as role_in()/can_use_store(). A rule written as
-- `store_id in (select public.my_store_ids())` works that list out once per query, and `(select public.is_admin())` once per query,
-- so the check per row is a lookup in a small list. WHO can see WHAT does not change; the check at the end proves it for every person.

create or replace function public.my_store_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select st.id from public.stores st where public.is_admin()
  union
  select m.store_id from public.store_members m
    join public.app_users u on u.user_id = m.user_id
    join public.stores st on st.id = m.store_id
   where m.user_id = auth.uid() and u.active and st.active
$$;
revoke execute on function public.my_store_ids() from public, anon;
grant execute on function public.my_store_ids() to authenticated, service_role;

-- ---------- Stock, items, sync ----------
drop policy if exists items_select on public.items;
create policy items_select on public.items for select using ((select public.in_any_store()) and not removed);
drop policy if exists store_stock_select on public.store_stock;
create policy store_stock_select on public.store_stock for select using ((select public.is_admin()) or store_id in (select public.my_store_ids()));
drop policy if exists sync_runs_select on public.sync_runs;
create policy sync_runs_select on public.sync_runs for select
  using ((select public.is_admin()) or (store_id is not null and store_id in (select public.my_store_ids())));

-- ---------- Orders ----------
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select using ((select public.is_admin()) or store_id in (select public.my_store_ids()));
drop policy if exists order_lines_select on public.order_lines;
create policy order_lines_select on public.order_lines for select using ((select public.is_admin()) or store_id in (select public.my_store_ids()));
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events for select using ((select public.is_admin()) or store_id in (select public.my_store_ids()));

-- ---------- Sales ----------
drop policy if exists sales_weeks_select on public.sales_weeks;
create policy sales_weeks_select on public.sales_weeks for select using ((select public.in_any_store()));
drop policy if exists sales_weeks_admin on public.sales_weeks;
create policy sales_weeks_admin on public.sales_weeks for all using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists store_week_select on public.store_week;
create policy store_week_select on public.store_week for select
  using ((select public.is_admin()) or (store_id is not null and store_id in (select public.my_store_ids())));
drop policy if exists store_week_admin on public.store_week;
create policy store_week_admin on public.store_week for all using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists store_day_select on public.store_day;
create policy store_day_select on public.store_day for select using ((select public.is_admin()) or store_id in (select public.my_store_ids()));
drop policy if exists store_day_admin on public.store_day;
create policy store_day_admin on public.store_day for all using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists sales_item_week_select on public.sales_item_week;
create policy sales_item_week_select on public.sales_item_week for select using ((select public.is_admin()) or store_id in (select public.my_store_ids()));
drop policy if exists sales_item_week_admin on public.sales_item_week;
create policy sales_item_week_admin on public.sales_item_week for all using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- Store settings, blocked items, stock counts (reads only; who may change them is unchanged) ----------
drop policy if exists store_prefs_select on public.store_prefs;
create policy store_prefs_select on public.store_prefs for select using ((select public.is_admin()) or store_id in (select public.my_store_ids()));
drop policy if exists store_blocked_select on public.store_blocked_items;
create policy store_blocked_select on public.store_blocked_items for select using ((select public.is_admin()) or store_id in (select public.my_store_ids()));
drop policy if exists stock_counts_select on public.stock_counts;
create policy stock_counts_select on public.stock_counts for select using ((select public.is_admin()) or store_id in (select public.my_store_ids()));
drop policy if exists stock_count_lines_select on public.stock_count_lines;
create policy stock_count_lines_select on public.stock_count_lines for select using ((select public.is_admin()) or store_id in (select public.my_store_ids()));

-- ---------- Proof that access is unchanged ----------
-- For every person, and for the admin, the stores my_store_ids() gives must be exactly the stores can_use_store() allows.
-- Any difference stops the migration, and nothing above is kept.
do $$
declare
  u record;
  extra uuid[];
  missing uuid[];
begin
  for u in
    select user_id, email from public.app_users
    union all
    select '00000000-0000-0000-0000-000000000000'::uuid, 'george.mridun@hsw.com.au' -- the admin
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'email', u.email, 'role', 'authenticated')::text, true);
    select array_agg(id) into extra from (select id from public.my_store_ids() as id except select id from public.stores where public.can_use_store(id)) x;
    select array_agg(id) into missing from (select id from public.stores where public.can_use_store(id) except select id from public.my_store_ids() as id) x;
    if extra is not null or missing is not null then
      raise exception 'my_store_ids() differs from can_use_store() for %: extra %, missing %', u.email, extra, missing;
    end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;
