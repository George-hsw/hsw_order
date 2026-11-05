-- The vendors a store orders from, with how many items each has: a few dozen rows. The Order tab shows this the moment it opens,
-- and loads a vendor's items only when that vendor is chosen, instead of downloading the whole store's list first.
-- Runs as the caller (security invoker), so Row Level Security still limits it to the caller's own stores.
create or replace function public.store_vendors(p_store uuid)
returns table (vendor_no text, items bigint)
language sql stable security invoker set search_path = public as $$
  select ss.vendor_no, count(*)
    from public.store_stock ss
    join public.items i on i.code = ss.item_code and not i.removed
   where ss.store_id = p_store and ss.vendor_no is not null and trim(ss.vendor_no) <> ''
   group by ss.vendor_no
   order by ss.vendor_no
$$;

revoke execute on function public.store_vendors(uuid) from public, anon;
grant execute on function public.store_vendors(uuid) to authenticated, service_role;
