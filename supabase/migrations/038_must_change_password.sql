-- A login made or reset by an admin has a temporary password. Until the person has chosen their own, the database gives that login
-- NO access to anything (no stores, no admin, area or operations rights), so skipping the change screen gets them nothing.
--
-- The flag is set only by the server (set_temp_password, service role). It is cleared only by password_changed(), which checks that
-- the password in Supabase Auth really is different from the temporary one, so the person cannot clear it without changing it.

alter table public.app_users add column if not exists must_change_password boolean not null default false;
alter table public.app_users add column if not exists temp_password_hash text; -- the bcrypt hash of the temporary password, to tell it has changed

-- Server only: marks a login as holding a temporary password, remembering which one (its hash, which is never sent to anyone).
create or replace function public.set_temp_password(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare h text;
begin
  select encrypted_password into h from auth.users where id = p_user;
  if h is null then raise exception 'No such login'; end if;
  update public.app_users set must_change_password = true, temp_password_hash = h, password_set_at = now() where user_id = p_user;
  if not found then raise exception 'No such person'; end if;
end $$;
revoke execute on function public.set_temp_password(uuid) from public, anon, authenticated;
grant execute on function public.set_temp_password(uuid) to service_role;

-- The person, right after saving a new password. True only if the password is no longer the temporary one.
create or replace function public.password_changed()
returns boolean
language plpgsql security definer set search_path = public as $$
declare done boolean;
begin
  update public.app_users u set must_change_password = false, temp_password_hash = null, password_set_at = now()
   where u.user_id = auth.uid() and u.must_change_password and u.temp_password_hash is not null
     and (select a.encrypted_password from auth.users a where a.id = auth.uid()) is distinct from u.temp_password_hash;
  done := found;
  return done;
end $$;
revoke execute on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated, service_role;

-- ---------- The gate: every way the database grants access now also requires "no temporary password" ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.jwt_email() = 'george.mridun@hsw.com.au'
      or exists (select 1 from public.app_users u where u.user_id = auth.uid() and u.is_admin and u.active and not u.must_change_password)
$$;

create or replace function public.is_area_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users u where u.user_id = auth.uid() and u.sees_all_sales and u.active and not u.must_change_password)
$$;

create or replace function public.is_operations() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users u where u.user_id = auth.uid() and u.is_operations and u.active and not u.must_change_password)
$$;

create or replace function public.role_in(s uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case when public.is_admin() then 'admin' end,
    (select m.role from public.store_members m
       join public.app_users u on u.user_id = m.user_id
       join public.stores st on st.id = m.store_id
      where m.user_id = auth.uid() and m.store_id = s and u.active and not u.must_change_password and st.active)
  )
$$;

create or replace function public.my_store_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select st.id from public.stores st where public.is_admin()
  union
  select m.store_id from public.store_members m
    join public.app_users u on u.user_id = m.user_id
    join public.stores st on st.id = m.store_id
   where m.user_id = auth.uid() and u.active and not u.must_change_password and st.active
$$;

create or replace function public.in_any_store() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_area_manager() or public.is_operations() or exists (
    select 1 from public.store_members m
      join public.app_users u on u.user_id = m.user_id
      join public.stores st on st.id = m.store_id
     where m.user_id = auth.uid() and u.active and not u.must_change_password and st.active)
$$;

-- The replacements above keep their earlier grants (create or replace does not change them).
