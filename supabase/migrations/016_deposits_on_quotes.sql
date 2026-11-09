-- A customer can pay a deposit (advance) against a quote. When that quote becomes a tax invoice, the money moves
-- across to the invoice, so the invoice opens already part paid (or paid in full).

alter table public.documents add column if not exists from_quote uuid references public.documents(id) on delete set null;

-- Before the invoice is stored: check the quote's deposits fit within it, and open it with the right status.
create or replace function public.invoice_from_quote_check() returns trigger language plpgsql security definer set search_path = public as $$
declare paid integer;
begin
  if new.from_quote is null then return new; end if;
  if new.doc_type <> 'Tax Invoice'
     or not exists (select 1 from public.documents q
                    where q.id = new.from_quote and q.doc_type = 'Quote' and q.store_id = new.store_id
                      and public.can_see_doc(q.store_id, q.created_by)) then
    new.from_quote := null; -- not a quote this person can convert: treat as an ordinary invoice
    return new;
  end if;
  select coalesce(sum(amount_cents), 0) into paid from public.payments where document_id = new.from_quote;
  if paid > new.total_cents then
    raise exception 'The deposit already taken on the quote is more than this invoice total';
  end if;
  new.status := case when paid = 0 then 'open' when paid >= new.total_cents then 'paid' else 'part_paid' end;
  return new;
end $$;
drop trigger if exists documents_from_quote_check on public.documents;
create trigger documents_from_quote_check before insert on public.documents
  for each row execute function public.invoice_from_quote_check();

-- After the invoice exists: carry the quote's deposits across to it.
create or replace function public.invoice_from_quote_move() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.from_quote is not null then
    update public.payments set document_id = new.id where document_id = new.from_quote;
  end if;
  return new;
end $$;
drop trigger if exists documents_from_quote_move on public.documents;
create trigger documents_from_quote_move after insert on public.documents
  for each row execute function public.invoice_from_quote_move();

-- A quote that holds a deposit is a record of money taken, so it can no longer be deleted (the deposit would go with it).
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (
    not exists (select 1 from public.payments p where p.document_id = id)
    and ((doc_type = 'Quote' and public.can_see_doc(store_id, created_by)) or public.is_admin())
  );
