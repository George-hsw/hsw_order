-- Holds: operations says "this store must always have at least this many of this item". A held item below its minimum is added to the
-- store's suggested order. Stores read their own holds; only operations (and admins) set or remove them, through the two functions below.

create table if not exists public.store_holds (
  store_id  uuid not null references public.stores(id) on delete cascade,
  item_code text not null,
  min_qty   integer not null check (min_qty > 0 and min_qty <= 99999),
  set_by    text not null default '',
  set_at    timestamptz not null default now(),
  primary key (store_id, item_code)
);
alter table public.store_holds enable row level security;

drop policy if exists store_holds_select on public.store_holds;
create policy store_holds_select on public.store_holds for select
  using (store_id in (select public.my_store_ids()) or (select public.is_admin()) or public.ops_ok());

grant select on public.store_holds to authenticated;
grant all on public.store_holds to service_role;

-- Sets (or changes) the minimum of one item at each of the chosen stores.
create or replace function public.set_store_holds(p_stores uuid[], p_code text, p_qty integer)
returns void
language plpgsql security definer set search_path = public as $$
declare v_code text := trim(coalesce(p_code, ''));
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  if v_code = '' then raise exception 'Enter an item number'; end if;
  if p_stores is null or coalesce(array_length(p_stores, 1), 0) = 0 then raise exception 'Choose at least one store'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 99999 then raise exception 'The minimum must be a whole number, 1 or more'; end if;
  if not exists (select 1 from public.items i where i.code = v_code and not i.removed) then raise exception 'That item number is not in the item list: %', v_code; end if;
  insert into public.store_holds (store_id, item_code, min_qty, set_by)
    select s.id, v_code, p_qty, public.jwt_email() from public.stores s where s.id = any (p_stores)
  on conflict (store_id, item_code) do update set min_qty = excluded.min_qty, set_by = excluded.set_by, set_at = now();
end $$;

create or replace function public.remove_store_hold(p_store uuid, p_code text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  delete from public.store_holds where store_id = p_store and item_code = trim(coalesce(p_code, ''));
end $$;

revoke execute on function public.set_store_holds(uuid[], text, integer), public.remove_store_hold(uuid, text) from public, anon;
grant execute on function public.set_store_holds(uuid[], text, integer), public.remove_store_hold(uuid, text) to authenticated, service_role;
