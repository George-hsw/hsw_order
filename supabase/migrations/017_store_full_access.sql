-- Store-level people now have full access inside their own store: they can open and edit any of its quotes and
-- invoices, take deposits and payments, delete quotes, and see the store's reports. What still sets a Manager apart:
-- managers are the store's owners for email (they get its payment notices and a copy of what it sends).
-- Only the admin adds or removes people and stores.

create or replace function public.can_see_doc(doc_store uuid, doc_creator text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.role_in(doc_store) in ('admin', 'manager', 'staff')
$$;

-- Everyone in a store can see the other people in it, so the creator's name shows in lists and reports.
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users for select
  using (public.is_admin() or user_id = auth.uid()
         or exists (select 1 from public.store_members m
                     where m.user_id = app_users.user_id and public.role_in(m.store_id) in ('manager', 'staff')));
