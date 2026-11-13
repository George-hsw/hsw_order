-- Rolling stock counts can be by division (BATHROOM, KITCHEN, ...) as well as by vendor. Counts already started by category keep working.

alter table public.stock_counts drop constraint if exists stock_counts_scope_type_check;
alter table public.stock_counts add constraint stock_counts_scope_type_check check (scope_type in ('none', 'vendor', 'category', 'division'));

-- The divisions a store stocks, with item counts: the choices for a rolling count by division.
create or replace function public.store_divisions(p_store uuid)
returns table (division text, items bigint)
language sql stable security invoker set search_path = public as $$
  select i.division, count(*)
    from public.store_stock ss
    join public.items i on i.code = ss.item_code and not i.removed
   where ss.store_id = p_store and i.division is not null and trim(i.division) <> ''
   group by i.division
   order by i.division
$$;

revoke execute on function public.store_divisions(uuid) from public, anon;
grant execute on function public.store_divisions(uuid) to authenticated, service_role;
