-- Fixes from the security audit (run-1). Three database-level guards:
--  1. Document status, store and type can be changed only through the app's own functions (or by the admin), not by a direct API call.
--  2. A payment can never take a document's payments above its total, even when two requests arrive together.
--  3. The hourly email limit is counted and reserved in one step, so parallel requests cannot all pass it.

-- ---------- 1. Document status, store and type ----------
-- record-payment sets status with the service role (no signed-in user), and the admin may do anything. Everyone else can edit a document's
-- content but not its status (which follows its payments), its store, or its type (changing type in the app makes a new document, so nothing
-- needs to change it in place, and deleting an issued tax invoice is an admin-only action that changing its type would sidestep).
create or replace function public.guard_document_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    -- A new document starts open. An invoice made from a quote has already had its status worked out from the deposit by an earlier trigger.
    if new.from_quote is null then new.status := 'open'; end if;
    return new;
  end if;
  if new.status is distinct from old.status then raise exception 'A document''s status follows its payments and cannot be changed here'; end if;
  if new.store_id is distinct from old.store_id then raise exception 'A document cannot be moved to another store'; end if;
  if new.doc_type is distinct from old.doc_type then raise exception 'A document''s type cannot be changed. Make a new document instead'; end if;
  return new;
end $$;
-- Named so it runs after the quote-to-invoice trigger (triggers fire in name order).
drop trigger if exists documents_guard_columns on public.documents;
create trigger documents_guard_columns before insert or update on public.documents
  for each row execute function public.guard_document_columns();

-- ---------- 2. Payments never exceed the document total ----------
create or replace function public.cap_payments() returns trigger
language plpgsql security definer set search_path = public as $$
declare total integer; paid integer;
begin
  select d.total_cents into total from public.documents d where d.id = new.document_id for update; -- one payment at a time per document
  select coalesce(sum(amount_cents), 0) into paid from public.payments where document_id = new.document_id;
  if paid + new.amount_cents > total then
    raise exception 'That is more than the balance due';
  end if;
  return new;
end $$;
drop trigger if exists payments_cap on public.payments;
create trigger payments_cap before insert on public.payments
  for each row execute function public.cap_payments();

-- ---------- 3. Reserve an email slot before sending ----------
-- Counts the sender's emails in the last hour and, if under the limit, logs this one straight away (sent_to is filled in after the send).
-- The advisory lock makes the count and the insert one step per sender. Returns the new log row's id, or null when over the limit.
create or replace function public.reserve_document_email(p_document uuid, p_store uuid, p_kind text, p_sent_by text, p_sent_to text, p_limit integer)
returns uuid
language plpgsql security definer set search_path = public as $$
declare n integer; new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('document_emails:' || lower(p_sent_by)));
  select count(*) into n from public.document_emails where sent_by = lower(p_sent_by) and sent_at >= now() - interval '1 hour';
  if n >= p_limit then return null; end if;
  insert into public.document_emails (document_id, store_id, kind, sent_to, sent_by)
    values (p_document, p_store, p_kind, p_sent_to, lower(p_sent_by)) returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.reserve_document_email(uuid, uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.reserve_document_email(uuid, uuid, text, text, text, integer) to service_role;
