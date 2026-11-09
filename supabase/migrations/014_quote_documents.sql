-- Quotes, tax invoices and payments (the old HSW Quote app), added to the ordering database.
-- Additive and safe to run twice: it changes no ordering table. It reuses the people and store model already here:
--   admin    the one address in is_admin()
--   manager  in a store (store_members): everything inside that store
--   staff    shown as "Store": the same access inside the store
-- Row Level Security is the real access control; the screens only mirror it.

-- ---------- Store details a quote or invoice prints ----------
alter table public.stores add column if not exists owner_email text;              -- franchise owner: gets payment notifications
alter table public.stores add column if not exists legal_name  text not null default '';
alter table public.stores add column if not exists abn         text not null default '';
alter table public.stores add column if not exists bank_name   text not null default '';
alter table public.stores add column if not exists bsb         text not null default '';
alter table public.stores add column if not exists account     text not null default '';

-- May the caller see a quote or invoice in this store? Anyone in the store, and the admin.
create or replace function public.can_see_doc(doc_store uuid, doc_creator text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.role_in(doc_store) in ('admin', 'manager', 'staff')
$$;

-- ---------- Saved quotes and invoices ----------
create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references public.stores(id),
  doc_type       text not null check (doc_type in ('Quote', 'Tax Invoice')),
  doc_number     text not null,
  customer_name  text not null,
  customer_email text,
  total_cents    integer not null check (total_cents >= 0),
  due_date       date,                       -- invoices: when the balance is due
  payload        jsonb not null,             -- the full form, so it can be reopened
  status         text not null default 'open' check (status in ('open', 'part_paid', 'paid', 'void')),
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  from_quote     uuid references public.documents(id) on delete set null, -- the quote an invoice was made from
  unique (store_id, doc_number)
);
create index if not exists documents_store_idx on public.documents (store_id, created_at desc);

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  store_id     uuid not null references public.stores(id),
  kind         text not null check (kind in ('payment', 'deposit')),
  amount_cents integer not null check (amount_cents > 0),
  paid_on      date not null default current_date,
  reference    text,
  recorded_by  text,
  created_at   timestamptz not null default now(),
  emailed_at   timestamptz,
  email_error  text
);
create index if not exists payments_doc_idx on public.payments (document_id);

-- A log of every quote or invoice emailed from the app. Written only by the send-document function; it also feeds the hourly send limit.
create table if not exists public.document_emails (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  store_id    uuid not null references public.stores(id),
  kind        text not null check (kind in ('customer', 'store')),
  sent_to     text not null,
  sent_by     text not null,
  sent_at     timestamptz not null default now(),
  error       text
);
create index if not exists document_emails_doc_idx  on public.document_emails (document_id, sent_at desc);
create index if not exists document_emails_user_idx on public.document_emails (sent_by, sent_at desc);

-- One live draft per person: the quote being built and not yet saved, shared by every device they are signed in on.
create table if not exists public.quote_drafts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  payload    jsonb not null,
  source     text not null default '',   -- which browser wrote it, so a device ignores its own echo
  updated_at timestamptz not null default now()
);

-- ---------- Triggers ----------
-- Once money has been recorded, the invoice contents are frozen.
create or replace function public.freeze_paid_documents() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.payments where document_id = old.id)
     and (new.payload is distinct from old.payload or new.total_cents <> old.total_cents
          or new.doc_number <> old.doc_number or new.doc_type <> old.doc_type) then
    raise exception 'This invoice has payments recorded and can no longer be edited';
  end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists documents_freeze on public.documents;
create trigger documents_freeze before update on public.documents
  for each row execute function public.freeze_paid_documents();

-- A deposit on a quote moves to the tax invoice made from it, so the invoice opens already part paid (or paid).
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

-- ---------- Row Level Security ----------
alter table public.documents       enable row level security;
alter table public.payments        enable row level security;
alter table public.document_emails enable row level security;
alter table public.quote_drafts    enable row level security;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select using (public.can_see_doc(store_id, created_by));
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert
  with check (public.is_admin() or (public.can_use_store(store_id) and lower(coalesce(created_by, '')) = public.jwt_email()));
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update
  using (public.can_see_doc(store_id, created_by)) with check (public.can_use_store(store_id));
-- A quote can be deleted by whoever can see it, unless it holds a deposit. A tax invoice only by the admin, and only with no payments.
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (
    not exists (select 1 from public.payments p where p.document_id = documents.id) -- documents.id, not a bare id: that would mean the payment's own id
    and ((doc_type = 'Quote' and public.can_see_doc(store_id, created_by)) or public.is_admin())
  );

-- Payments and the email log are read-only for clients: only the record-payment and send-document functions (service role) write them.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (public.can_use_store(store_id) and exists (select 1 from public.documents d where d.id = payments.document_id));
drop policy if exists document_emails_select on public.document_emails;
create policy document_emails_select on public.document_emails for select
  using (public.can_use_store(store_id) and exists (select 1 from public.documents d where d.id = document_emails.document_id));

-- Only the owner can see or change their own draft.
drop policy if exists quote_drafts_own on public.quote_drafts;
create policy quote_drafts_own on public.quote_drafts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Permissions ----------
grant select, insert, update, delete on public.documents to authenticated; -- the policies above decide which rows
grant select on public.payments, public.document_emails to authenticated;
grant select, insert, update, delete on public.quote_drafts to authenticated;
grant all on public.documents, public.payments, public.document_emails, public.quote_drafts to service_role;
revoke execute on function public.can_see_doc(uuid, text) from public, anon;
grant execute on function public.can_see_doc(uuid, text) to authenticated, service_role;

-- Live delivery of the draft to the person's other devices.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quote_drafts') then
    alter publication supabase_realtime add table public.quote_drafts;
  end if;
end $$;
