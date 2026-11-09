-- People belong to stores, not the other way round. One person (one login) can be in several stores, with their own
-- permission in each:
--   manager  sees every quote, invoice and payment in that store, records payments, sees reports.
--   staff    (shown as "Store") makes quotes and invoices and sees only the ones they created.
-- The admin is still the one address in is_admin(). People and their memberships are written only by the admin,
-- through the manage-user edge function; the browser can read them but never write.

create table if not exists public.store_members (
  user_id    uuid not null references public.app_users(user_id) on delete cascade,
  store_id   uuid not null references public.stores(id) on delete cascade,
  role       text not null check (role in ('manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);
create index if not exists store_members_store_idx on public.store_members (store_id);
alter table public.store_members enable row level security;

-- Carry over everyone created so far: their one store (or every active store, if they were given all of them).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_users' and column_name = 'store_id') then
    insert into public.store_members (user_id, store_id, role)
      select u.user_id, u.store_id, u.role from public.app_users u
      on conflict do nothing;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_users' and column_name = 'all_stores') then
      insert into public.store_members (user_id, store_id, role)
        select u.user_id, s.id, u.role from public.app_users u cross join public.stores s
         where u.all_stores and s.active
      on conflict do nothing;
    end if;
  end if;
end $$;

-- The caller's role in one store: 'admin', 'manager', 'staff', or null for no access. A shared store login (the
-- original way, stores.email) is treated as a manager of its store so it keeps working.
create or replace function public.role_in(s uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case when public.is_admin() then 'admin' end,
    (select m.role from public.store_members m
       join public.app_users u on u.user_id = m.user_id
       join public.stores st on st.id = m.store_id
      where m.user_id = auth.uid() and m.store_id = s and u.active and st.active),
    (select 'manager' from public.stores where id = s and active and lower(email) = public.jwt_email())
  )
$$;

create or replace function public.can_use_store(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.role_in(s) is not null
$$;

create or replace function public.can_see_doc(doc_store uuid, doc_creator text) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.role_in(doc_store)
    when 'admin' then true
    when 'manager' then true
    when 'staff' then lower(coalesce(doc_creator, '')) = public.jwt_email()
    else false
  end
$$;

-- Older helpers, kept so nothing that still names them breaks. They no longer mean "the one store".
create or replace function public.my_store_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.store_id from public.store_members m join public.app_users u on u.user_id = m.user_id
       join public.stores st on st.id = m.store_id
      where m.user_id = auth.uid() and u.active and st.active order by m.created_at limit 1),
    (select id from public.stores where active and lower(email) = public.jwt_email() limit 1)
  )
$$;
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then 'admin' else public.role_in(public.my_store_id()) end
$$;

drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores for select using (public.can_use_store(id));

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select using (public.can_see_doc(store_id, created_by));
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert
  with check (public.is_admin() or (public.can_use_store(store_id) and lower(coalesce(created_by, '')) = public.jwt_email()));
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update
  using (public.can_see_doc(store_id, created_by))
  with check (public.can_use_store(store_id));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (public.can_use_store(store_id) and exists (select 1 from public.documents d where d.id = payments.document_id));
drop policy if exists document_emails_select on public.document_emails;
create policy document_emails_select on public.document_emails for select
  using (public.can_use_store(store_id) and exists (select 1 from public.documents d where d.id = document_emails.document_id));

-- People and memberships: the admin sees all, anyone sees themselves, a manager sees the people in their stores.
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users for select
  using (public.is_admin() or user_id = auth.uid()
         or exists (select 1 from public.store_members m
                     where m.user_id = app_users.user_id and public.role_in(m.store_id) = 'manager'));
drop policy if exists store_members_select on public.store_members;
create policy store_members_select on public.store_members for select
  using (public.is_admin() or user_id = auth.uid() or public.role_in(store_id) = 'manager');

-- app_users no longer carries a store or a role; those live in store_members.
alter table public.app_users drop column if exists role;
alter table public.app_users drop column if exists store_id;
alter table public.app_users drop column if exists all_stores;

grant select on public.store_members to authenticated;
grant all on public.store_members to service_role;
grant execute on function public.role_in(uuid), public.can_use_store(uuid), public.can_see_doc(uuid, text) to authenticated;
