-- The notification bell. Notifications are worked out from live data each time, so nothing is stored about them except what a
-- person has chosen to hide, and until when. Two read-only helpers count the things that need many rows to find.

-- What a person has hidden. Only they can see or change their own rows.
create table if not exists public.notice_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  key     text not null check (char_length(key) between 1 and 160),
  until   timestamptz not null,
  primary key (user_id, key)
);
alter table public.notice_dismissals enable row level security;
drop policy if exists notice_dismissals_own on public.notice_dismissals;
create policy notice_dismissals_own on public.notice_dismissals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.notice_dismissals to authenticated;
grant all on public.notice_dismissals to service_role;

-- Items running low, counted for each store and vendor. The same rule as the Order tab: units sold a week at this store over the
-- latest 13 weeks of item sales (needs 4 weeks loaded), against stock + on order + in transfer, below the store's cover target
-- (store_prefs, 4 weeks if it has not chosen one). Items blocked, excluded from replenishment or PO-blocked are left out: they cannot be ordered.
-- Runs as the caller, so Row Level Security still limits it to the caller's own stores.
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
   group by st.store_id, st.vendor_no
$$;

revoke execute on function public.low_stock_by_vendor(uuid[]), public.new_items_by_vendor(uuid[]) from public, anon;
grant execute on function public.low_stock_by_vendor(uuid[]), public.new_items_by_vendor(uuid[]) to authenticated, service_role;
