-- Quotes can be deleted by whoever can see them: the admin, a manager of the store, or the staff member who made it.
-- Tax invoices are tax records, so they are not deleted from the app (the admin can still remove one that has no
-- payments, as before).

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (
    (doc_type = 'Quote' and public.can_see_doc(store_id, created_by))
    or (public.is_admin() and not exists (select 1 from public.payments p where p.document_id = id))
  );
