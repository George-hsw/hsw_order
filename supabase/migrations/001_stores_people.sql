-- Stores, people, and who may see what. Same model as the HSW Quote app:
--   admin     the one address in is_admin(): every store, and the only one who adds people and stores.
--   manager   in one or more stores: full access to the store's orders and reports.
--   staff     (shown as "Store") the same access inside the store. The two differ only in the label.
-- One person has one login and can be in several stores, with a permission in each (store_members).
-- Row Level Security is the real access control; the app UI only mirrors it.

create extension if not exists pgcrypto;

create table if not exists public.stores (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  code            text not null unique check (code ~ '^[A-Za-z0-9]{2,6}$'), -- the NAV Location Code, e.g. 14122
  address         text not null default '',
  suburb          text not null default '',
  phone           text not null default '',
  email           text,                      -- the store's contact address (not a login)
  active          boolean not null default true,
  password_set_at timestamptz,
  created_at      timestamptz not null default now()
);

-- Hard cap: 25 active stores.
create or replace function public.enforce_store_cap() returns trigger language plpgsql as $$
begin
  if new.active and (select count(*) from public.stores where active and id <> new.id) >= 25 then
    raise exception 'Store limit reached: a maximum of 25 active stores is allowed';
  end if;
  return new;
end $$;
drop trigger if exists stores_cap on public.stores;
create trigger stores_cap before insert or update of active on public.stores
  for each row execute function public.enforce_store_cap();

create table if not exists public.app_users (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  full_name       text not null default '',
  active          boolean not null default true,
  password_set_at timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists app_users_email_lower on public.app_users (lower(email));

create table if not exists public.store_members (
  user_id    uuid not null references public.app_users(user_id) on delete cascade,
  store_id   uuid not null references public.stores(id) on delete cascade,
  role       text not null check (role in ('manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);
create index if not exists store_members_store_idx on public.store_members (store_id);

-- ---------- Who is calling ----------
create or replace function public.jwt_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.jwt_email() = 'george.mridun@hsw.com.au'
$$;

-- The caller's role in one store: 'admin', 'manager', 'staff', or null for no access.
create or replace function public.role_in(s uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case when public.is_admin() then 'admin' end,
    (select m.role from public.store_members m
       join public.app_users u on u.user_id = m.user_id
       join public.stores st on st.id = m.store_id
      where m.user_id = auth.uid() and m.store_id = s and u.active and st.active)
  )
$$;

create or replace function public.can_use_store(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.role_in(s) is not null
$$;

-- Does the caller belong to any store at all (or is the admin)? Gates the shared item list.
create or replace function public.in_any_store() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.store_members m
      join public.app_users u on u.user_id = m.user_id
      join public.stores st on st.id = m.store_id
     where m.user_id = auth.uid() and u.active and st.active)
$$;

-- ---------- Row Level Security ----------
alter table public.stores        enable row level security;
alter table public.app_users     enable row level security;
alter table public.store_members enable row level security;

drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores for select using (public.can_use_store(id));
drop policy if exists stores_admin_write on public.stores;
create policy stores_admin_write on public.stores for all using (public.is_admin()) with check (public.is_admin());

-- People: the admin sees everyone; everyone else sees themselves and the people in their own stores.
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users for select
  using (public.is_admin() or user_id = auth.uid()
         or exists (select 1 from public.store_members m
                     where m.user_id = app_users.user_id and public.can_use_store(m.store_id)));

drop policy if exists store_members_select on public.store_members;
create policy store_members_select on public.store_members for select
  using (public.is_admin() or user_id = auth.uid() or public.can_use_store(store_id));
-- People and memberships are written only by the manage-user edge function (service role). No client write policies.
