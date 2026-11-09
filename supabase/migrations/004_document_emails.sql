-- A log of every quote / invoice emailed from the app (who sent what, to whom, and whether it worked).
-- Written only by the `send-document` edge function; also what the hourly send limit counts.

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

alter table public.document_emails enable row level security;

drop policy if exists document_emails_select on public.document_emails;
create policy document_emails_select on public.document_emails for select
  using (public.is_admin() or store_id = public.my_store_id());
-- No insert/update/delete policies: clients cannot write; the edge function uses the service role.
