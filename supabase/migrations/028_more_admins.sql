-- More than one admin. george.mridun@hsw.com.au stays the main admin, always. Anyone else can be made an admin by turning on
-- app_users.is_admin: they then see and do everything the main admin does. Only the main admin can add or remove admins (the
-- manage-user function checks that); people never write app_users themselves (no client write rules), so nobody can make themselves one.

alter table public.app_users add column if not exists is_admin boolean not null default false;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.jwt_email() = 'george.mridun@hsw.com.au'
      or exists (select 1 from public.app_users u where u.user_id = auth.uid() and u.is_admin and u.active)
$$;

-- The main admin only: who may add or remove admins.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.jwt_email() = 'george.mridun@hsw.com.au'
$$;

revoke execute on function public.is_admin(), public.is_owner() from public, anon;
grant execute on function public.is_admin(), public.is_owner() to authenticated, service_role;
