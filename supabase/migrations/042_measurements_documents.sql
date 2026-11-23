-- A fourth document type: Measurements. A record of what was measured for a customer (name, address, measurements) with photos of the
-- products or the space. It carries no items or prices (total 0) and is saved in the same documents table, so it is numbered, listed,
-- emailed and deleted like a quote. Photos are kept in the document's payload, shrunk to JPEG before they are saved.

alter table public.documents drop constraint if exists documents_doc_type_check;
alter table public.documents add constraint documents_doc_type_check check (doc_type in ('Quote', 'Tax Invoice', 'Customer Order', 'Measurements'));

-- Deleted like a quote: only when no money is held (a measurements record never holds any).
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (
    not exists (select 1 from public.payments p where p.document_id = documents.id)
    and ((doc_type in ('Quote', 'Customer Order', 'Measurements') and public.can_see_doc(store_id, created_by)) or public.is_admin())
  );
