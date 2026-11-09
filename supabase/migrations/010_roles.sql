-- Roles. Three kinds of person can sign in:
--   admin    the one address in is_admin(): everything, every store.
--   manager  one store: sees every document and payment there (all staff), plus the reports.
--   staff    one store: sees and edits only the quotes and invoices they created themselves.
-- A shared store login (stores.email, how it worked before) keeps working and sees the whole store, like a manager.
-- Individual people (managers, staff) live in app_users. They are created only by the admin, through the
-- manage-user edge function; the browser can read this table but never write it.

create table if not exists public.app_users (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  full_name       text not null default '',
  role            text not null check (role in ('manager', 'staff')),
  store_id        uuid not null references public.stores(id),
  active          boolean not null default true,
  password_set_at timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists app_users_email_lower on public.app_users (lower(email));
create index if not exists app_users_store_idx on public.app_users (store_id);
alter table public.app_users enable row level security;

create or replace function public.jwt_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- The caller's store: an active person at an active store, else a shared store login.
create or replace function public.my_store_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select u.store_id from public.app_users u join public.stores s on s.id = u.store_id
      where u.active and s.active and u.user_id = auth.uid() limit 1),
    (select id from public.stores where active and lower(email) = public.jwt_email() limit 1)
  )
$$;

-- 'admin', 'manager', 'staff', 'store' (a shared store login), or null.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case when public.is_admin() then 'admin' end,
    (select u.role from public.app_users u join public.stores s on s.id = u.store_id
      where u.active and s.active and u.user_id = auth.uid() limit 1),
    (select 'store' from public.stores where active and lower(email) = public.jwt_email() limit 1)
  )
$$;

-- May the caller see this document? Admin: yes. Others: only in their own store, and staff only their own.
create or replace function public.can_see_doc(doc_store uuid, doc_creator text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (
    doc_store = public.my_store_id()
    and (public.my_role() in ('manager', 'store') or lower(coalesce(doc_creator, '')) = public.jwt_email())
  )
$$;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select
  using (public.can_see_doc(store_id, created_by));
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert
  with check (public.is_admin() or (store_id = public.my_store_id() and lower(coalesce(created_by, '')) = public.jwt_email()));
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update
  using (public.can_see_doc(store_id, created_by))
  with check (public.is_admin() or store_id = public.my_store_id());

-- Who created a document never changes, whoever edits it later (a manager fixing a staff member's quote).
create or replace function public.keep_document_creator() returns trigger language plpgsql as $$
begin
  new.created_by = old.created_by;
  return new;
end $$;
drop trigger if exists documents_keep_creator on public.documents;
create trigger documents_keep_creator before update on public.documents
  for each row execute function public.keep_document_creator();

-- Payments and sent emails follow the document they belong to (documents are filtered by the rule above).
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (public.is_admin() or (store_id = public.my_store_id()
         and exists (select 1 from public.documents d where d.id = payments.document_id)));
drop policy if exists document_emails_select on public.document_emails;
create policy document_emails_select on public.document_emails for select
  using (public.is_admin() or (store_id = public.my_store_id()
         and exists (select 1 from public.documents d where d.id = document_emails.document_id)));

-- People: the admin sees everyone, a manager sees the people at their own store, anyone sees themselves.
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users for select
  using (public.is_admin() or user_id = auth.uid()
         or (store_id = public.my_store_id() and public.my_role() = 'manager'));

grant select on public.app_users to authenticated;
grant all on public.app_users to service_role;
grant execute on function public.jwt_email(), public.my_role(), public.can_see_doc(uuid, text) to authenticated;
