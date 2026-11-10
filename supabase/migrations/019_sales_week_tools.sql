-- Counting, clearing and adding up a week of item rows, done by the database in one step for an admin. A week of item sales can be 80,000+ rows, and
-- reading or deleting that many rows one at a time through Row Level Security can run past the database's time limit, which came back as an error with
-- no message. These check that the caller is an admin once, then work on the table directly. They only touch the week asked for. Admin only.

-- Replaces the version in 018, which ran as the caller and so checked the row rules on every row.
create or replace function public.sales_year_totals(p_fy integer)
returns table (week integer, source text, row_count bigint, a numeric, b numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  return query
    select w.week, 'weekly'::text, count(*), coalesce(sum(w.ty_sales), 0), coalesce(sum(w.ly_sales), 0) from public.store_week w where w.fy = p_fy group by w.week
    union all
    select i.week, 'items'::text, count(*), coalesce(sum(i.net_sales), 0), coalesce(sum(i.qty), 0) from public.sales_item_week i where i.fy = p_fy group by i.week
    union all
    select d.week, 'days'::text, count(*), coalesce(sum(d.ty), 0), coalesce(sum(d.ly), 0) from public.store_day d where d.fy = p_fy group by d.week;
end $$;

-- How many item rows are saved for one week.
create or replace function public.sales_week_count(p_fy integer, p_week integer)
returns bigint
language plpgsql stable security definer set search_path = public as $$
declare n bigint;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  select count(*) into n from public.sales_item_week where fy = p_fy and week = p_week;
  return n;
end $$;

-- Removes one week's item rows (before a corrected file is loaded) and says how many went.
create or replace function public.sales_week_clear(p_fy integer, p_week integer)
returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  delete from public.sales_item_week where fy = p_fy and week = p_week;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.sales_year_totals(integer) from public, anon;
revoke all on function public.sales_week_count(integer, integer) from public, anon;
revoke all on function public.sales_week_clear(integer, integer) from public, anon;
grant execute on function public.sales_year_totals(integer) to authenticated, service_role;
grant execute on function public.sales_week_count(integer, integer) to authenticated, service_role;
grant execute on function public.sales_week_clear(integer, integer) to authenticated, service_role;
