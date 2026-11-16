-- Operations: a person (an operations manager) who can run store closures, moving a closing store's stock to other stores. It is an extra
-- permission, switched on by an admin (app_users.is_operations), and it works on top of whatever else the person is: a store user, a
-- manager, or no store at all. People never write app_users themselves (no client write rules), so nobody can give it to themselves.
--
-- It lets them read only what a closure needs: the store names (every store, including a closed one), the shared item list and week dates,
-- and, through a narrow function, one store's stock. Nothing else: no orders, documents, payments or store details.

alter table public.app_users add column if not exists is_operations boolean not null default false;

create or replace function public.is_operations() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users u where u.user_id = auth.uid() and u.is_operations and u.active)
$$;

-- An admin or an operations person.
create or replace function public.ops_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_operations()
$$;

-- The shared item list and week dates are open to anyone who works in a store; operations needs them even with no store of their own.
create or replace function public.in_any_store() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_area_manager() or public.is_operations() or exists (
    select 1 from public.store_members m
      join public.app_users u on u.user_id = m.user_id
      join public.stores st on st.id = m.store_id
     where m.user_id = auth.uid() and u.active and st.active)
$$;

-- The store list: name and code only, never an address or bank detail. Operations sees every store, including one that has closed,
-- because the closing store is the one they pick.
create or replace view public.stores_basic as
  select st.id, st.name, st.code, st.active
    from public.stores st
   where (select public.ops_ok()) or st.id in (select public.my_sales_store_ids());
grant select on public.stores_basic to authenticated;

-- One store's stock for the codes asked about (all codes when none are given), for checking an uploaded sheet and valuing it at cost.
create or replace function public.ops_store_stock(p_store uuid, p_codes text[] default null)
returns table (item_code text, inventory numeric, store_cost numeric, moq numeric, vendor_no text)
language sql stable security definer set search_path = public as $$
  select ss.item_code, ss.inventory, ss.store_cost, ss.moq, ss.vendor_no
    from public.store_stock ss
   where ss.store_id = p_store and (p_codes is null or ss.item_code = any(p_codes)) and (select public.ops_ok())
$$;

revoke execute on function public.is_operations(), public.ops_ok(), public.ops_store_stock(uuid, text[]) from public, anon;
grant execute on function public.is_operations(), public.ops_ok(), public.ops_store_stock(uuid, text[]) to authenticated, service_role;
