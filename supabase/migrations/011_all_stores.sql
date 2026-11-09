-- A person can be given every store (head office, an area manager) instead of one. They still have a main store,
-- which new quotes start on. The role (manager or staff) still decides what they see: a manager sees every
-- document in every store, staff only the ones they created.

alter table public.app_users add column if not exists all_stores boolean not null default false;

-- May the caller use this store? Admin: any. A person: their own store, or any active store if they have all stores.
create or replace function public.can_use_store(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or s = public.my_store_id() or exists (
    select 1 from public.app_users u join public.stores st on st.id = s
     where u.user_id = auth.uid() and u.active and u.all_stores and st.active)
$$;

-- An all-stores person is not locked out when their main store is switched off.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case when public.is_admin() then 'admin' end,
    (select u.role from public.app_users u
      where u.active and u.user_id = auth.uid()
        and (u.all_stores or exists (select 1 from public.stores s where s.id = u.store_id and s.active)) limit 1),
    (select 'store' from public.stores where active and lower(email) = public.jwt_email() limit 1)
  )
$$;

create or replace function public.can_see_doc(doc_store uuid, doc_creator text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (
    public.can_use_store(doc_store)
    and (public.my_role() in ('manager', 'store') or lower(coalesce(doc_creator, '')) = public.jwt_email())
  )
$$;

drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores for select using (public.can_use_store(id));

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

drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users for select
  using (public.is_admin() or user_id = auth.uid()
         or (public.can_use_store(store_id) and public.my_role() = 'manager'));

grant execute on function public.can_use_store(uuid) to authenticated;
