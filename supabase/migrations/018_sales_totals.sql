-- What is saved for the sales reports, added up for each week of a year. The folder import uses it to check that what was saved is exactly
-- what the report files hold: the same number of rows and the same totals, to the cent. It only reads, as the caller, so Row Level Security
-- still applies. Nothing here changes any data.
create or replace function public.sales_year_totals(p_fy integer)
returns table (week integer, source text, row_count bigint, a numeric, b numeric)
language sql stable set search_path = public as $$
  select w.week, 'weekly'::text, count(*), coalesce(sum(w.ty_sales), 0), coalesce(sum(w.ly_sales), 0) from public.store_week w where w.fy = p_fy group by w.week
  union all
  select i.week, 'items'::text, count(*), coalesce(sum(i.net_sales), 0), coalesce(sum(i.qty), 0) from public.sales_item_week i where i.fy = p_fy group by i.week
  union all
  select d.week, 'days'::text, count(*), coalesce(sum(d.ty), 0), coalesce(sum(d.ly), 0) from public.store_day d where d.fy = p_fy group by d.week
$$;
revoke all on function public.sales_year_totals(integer) from public, anon;
grant execute on function public.sales_year_totals(integer) to authenticated, service_role;
