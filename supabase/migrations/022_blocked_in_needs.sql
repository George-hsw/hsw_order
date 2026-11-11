-- Items a store has blocked (store_blocked_items) are left out of what needs ordering, the low stock counts and the new items,
-- so the Order page and the bell agree. These are the earlier functions with that one condition added.

create or replace function public.order_needs(p_stores uuid[])
returns table (store_id uuid, vendor_no text, items integer, units bigint, cost numeric, held integer, customers integer)
language sql stable set search_path = public as $$
  with gw as (select fy * 100 + week as wk from public.sales_weeks order by fy desc, week desc limit 13),
  rws as (
    select s.store_id, s.item_code, s.wk, greatest(s.qty, 0)::float8 as q
      from public.sales_item_week s where s.store_id = any(p_stores) and s.wk in (select wk from gw)
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
     where o.store_id = any(p_stores) and o.status <> 'ordered'
     group by o.store_id, o.vendor_no, ol.item_code
  ),
  base as (
    select k.store_id, k.vendor_no, k.item_code, greatest(1, round(coalesce(nullif(k.moq, 0), 1)))::float8 as step, k.store_cost::float8 as cost,
           coalesce(p.cover_weeks, 4)::float8 as cover, coalesce(s.units, 0) as units, coalesce(w.w, 0::float8) as waiting,
           (coalesce(d.recent, 0) * 0.6 + coalesce(d.long, 0) * 0.4) * coalesce(t.trend, 1::float8) as rate,
           greatest(0, k.inventory)::float8 + greatest(0, k.qty_on_po)::float8 + greatest(0, k.transfer_in)::float8 + coalesce(io.q, 0::float8) as have
      from public.store_stock k
      join public.items it on it.code = k.item_code
      left join dem d on d.store_id = k.store_id and d.item_code = k.item_code
      left join st s on s.store_id = k.store_id and s.item_code = k.item_code
      left join trend t on t.store_id = k.store_id
      left join wait w on w.store_id = k.store_id and w.code = k.item_code
      left join inord io on io.store_id = k.store_id and io.vendor_no = k.vendor_no and io.item_code = k.item_code
      left join public.store_prefs p on p.store_id = k.store_id
     where k.store_id = any(p_stores) and k.vendor_no is not null
       and not it.blocked and not it.exclude_from_replen and not k.po_blocked
       and not exists (select 1 from public.store_blocked_items bi where bi.store_id = k.store_id and bi.item_code = k.item_code)
       and (d.item_code is not null or w.code is not null)
  ),
  want as (
    select b.*, case when b.rate < 0.5 then (case when b.have - b.waiting <= 0 and b.units >= 2 then 1 else 0 end) + b.waiting else b.rate * b.cover + b.waiting end as wanted
      from base b
  ),
  qty as (
    select w.*, case when w.wanted - w.have > 0 then ceil((w.wanted - w.have) / w.step) * w.step else 0 end as q from want w
  ),
  fin as (select q.*, (q.q > 0 and q.rate > 0 and q.q / q.rate > 26) as hold from qty q)
  select f.store_id, f.vendor_no,
         (count(*) filter (where f.q > 0 and not f.hold))::integer,
         coalesce(sum(f.q) filter (where f.q > 0 and not f.hold), 0)::bigint,
         coalesce(sum(f.q * f.cost) filter (where f.q > 0 and not f.hold), 0)::numeric,
         (count(*) filter (where f.hold))::integer,
         (count(*) filter (where f.q > 0 and not f.hold and f.waiting > 0))::integer
    from fin f
   group by f.store_id, f.vendor_no
  having count(*) filter (where f.q > 0) > 0
$$;
revoke all on function public.order_needs(uuid[]) from public, anon;
grant execute on function public.order_needs(uuid[]) to authenticated, service_role;

create or replace function public.low_stock_by_vendor(p_stores uuid[])
returns table (store_id uuid, vendor_no text, items integer)
language sql stable set search_path = public as $$
  with win as (select fy * 100 + week as wk from public.sales_weeks order by fy desc, week desc limit 13),
  recent as (
    select s.store_id, s.item_code, s.wk, greatest(s.qty, 0) as qty
      from public.sales_item_week s
     where s.store_id = any(p_stores) and s.wk in (select wk from win)
  ),
  nweeks as (select r.store_id, count(distinct r.wk) as n from recent r group by r.store_id),
  rate as (
    select r.store_id, r.item_code, sum(r.qty) / w.n as per_week
      from recent r join nweeks w on w.store_id = r.store_id
     where w.n >= 4
     group by r.store_id, r.item_code, w.n
  )
  select st.store_id, st.vendor_no, count(*)::integer
    from rate r
    join public.store_stock st on st.store_id = r.store_id and st.item_code = r.item_code
    join public.items i on i.code = st.item_code and not i.removed and not i.blocked and not i.exclude_from_replen
    left join public.store_prefs p on p.store_id = r.store_id
   where r.per_week > 0 and not st.po_blocked and st.vendor_no is not null
     and not exists (select 1 from public.store_blocked_items bi where bi.store_id = st.store_id and bi.item_code = st.item_code)
     and (greatest(st.inventory, 0) + greatest(st.qty_on_po, 0) + greatest(st.transfer_in, 0)) / r.per_week < coalesce(p.cover_weeks, 4)
   group by st.store_id, st.vendor_no
$$;

-- Items NAV marks as NEW, counted for each store and vendor.
create or replace function public.new_items_by_vendor(p_stores uuid[])
returns table (store_id uuid, vendor_no text, items integer)
language sql stable set search_path = public as $$
  select st.store_id, st.vendor_no, count(*)::integer
    from public.store_stock st join public.items i on i.code = st.item_code
   where st.store_id = any(p_stores) and not i.removed and upper(trim(i.status)) = 'NEW' and st.vendor_no is not null
     and not exists (select 1 from public.store_blocked_items bi where bi.store_id = st.store_id and bi.item_code = st.item_code)
   group by st.store_id, st.vendor_no
$$;

revoke execute on function public.low_stock_by_vendor(uuid[]), public.new_items_by_vendor(uuid[]) from public, anon;
grant execute on function public.low_stock_by_vendor(uuid[]), public.new_items_by_vendor(uuid[]) to authenticated, service_role;
