-- Customer orders: a customer asks for something the store does not have, pays a deposit, and the store orders it in.
-- A customer order is a document like a quote (same builder, same PDF, deposits through record-payment) with one extra
-- field, fulfilment, that tracks it: to_order (the store still has to order it) -> ordered -> arrived -> collected.
-- The Order tab warns about every customer order still to_order whose items are in the vendor range on screen.
-- It can be turned into a tax invoice like a quote, and its deposits move across.

alter table public.documents drop constraint if exists documents_doc_type_check;
alter table public.documents add constraint documents_doc_type_check check (doc_type in ('Quote', 'Tax Invoice', 'Customer Order'));

alter table public.documents add column if not exists fulfilment text
  check (fulfilment is null or fulfilment in ('to_order', 'ordered', 'arrived', 'collected'));
update public.documents set fulfilment = 'to_order' where doc_type = 'Customer Order' and fulfilment is null;
create index if not exists documents_fulfilment_idx on public.documents (store_id, fulfilment) where fulfilment is not null;

-- An invoice can be made from a quote or from a customer order; the deposits move across either way.
create or replace function public.invoice_from_quote_check() returns trigger language plpgsql security definer set search_path = public as $$
declare paid integer;
begin
  if new.from_quote is null then return new; end if;
  if new.doc_type <> 'Tax Invoice'
     or not exists (select 1 from public.documents q
                    where q.id = new.from_quote and q.doc_type in ('Quote', 'Customer Order') and q.store_id = new.store_id
                      and public.can_see_doc(q.store_id, q.created_by)) then
    new.from_quote := null; -- not a document this person can convert: treat as an ordinary invoice
    return new;
  end if;
  select coalesce(sum(amount_cents), 0) into paid from public.payments where document_id = new.from_quote;
  if paid > new.total_cents then
    raise exception 'The deposit already taken is more than this invoice total';
  end if;
  new.status := case when paid = 0 then 'open' when paid >= new.total_cents then 'paid' else 'part_paid' end;
  return new;
end $$;

-- A customer order with no deposit can be deleted like a quote. One that holds money cannot.
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (
    not exists (select 1 from public.payments p where p.document_id = documents.id) -- documents.id, not a bare id
    and ((doc_type in ('Quote', 'Customer Order') and public.can_see_doc(store_id, created_by)) or public.is_admin())
  );

-- The freeze message now covers quotes and customer orders as well as invoices.
create or replace function public.freeze_paid_documents() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.payments where document_id = old.id)
     and (new.payload is distinct from old.payload or new.total_cents <> old.total_cents
          or new.doc_number <> old.doc_number or new.doc_type <> old.doc_type) then
    raise exception 'This document has payments recorded and can no longer be edited';
  end if;
  new.updated_at = now();
  return new;
end $$;
