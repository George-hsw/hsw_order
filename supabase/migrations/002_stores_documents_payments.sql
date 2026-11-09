-- Stores (max 25 active), saved quotes/invoices, and recorded payments.
-- Login = emailed 6-digit code (Supabase Auth). Who may log in:
--   * the single admin  (george.mridun@hsw.com.au)
--   * the login email of an ACTIVE store in public.stores
-- Row Level Security below is the real access control; the app UI only mirrors it.

create extension if not exists pgcrypto;

create table if not exists public.stores (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  code        text not null unique check (code ~ '^[A-Z]{2,4}$'),
  address     text not null default '',
  suburb      text not null default '',
  phone       text not null default '',
  email       text unique,            -- the store's login email
  owner_email text,                   -- franchise owner: receives payment notifications
  legal_name  text not null default '',
  abn         text not null default '',
  bank_name   text not null default '',
  bsb         text not null default '',
  account     text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists stores_email_lower on public.stores (lower(email));

-- Hard cap: 25 active stores.
create or replace function public.enforce_store_cap() returns trigger language plpgsql as $$
begin
  if new.active and (select count(*) from public.stores where active and id <> new.id) >= 25 then
    raise exception 'Store limit reached: a maximum of 25 active stores is allowed';
  end if;
  return new;
end $$;
drop trigger if exists stores_cap on public.stores;
create trigger stores_cap before insert or update of active on public.stores
  for each row execute function public.enforce_store_cap();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'george.mridun@hsw.com.au'
$$;

create or replace function public.my_store_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.stores
  where active and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

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

-- ---------- Row Level Security ----------
alter table public.stores    enable row level security;
alter table public.documents enable row level security;
alter table public.payments  enable row level security;

drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores for select
  using (public.is_admin() or id = public.my_store_id());
drop policy if exists stores_admin_write on public.stores;
create policy stores_admin_write on public.stores for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select
  using (public.is_admin() or store_id = public.my_store_id());
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert
  with check (public.is_admin() or store_id = public.my_store_id());
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update
  using (public.is_admin() or store_id = public.my_store_id())
  with check (public.is_admin() or store_id = public.my_store_id());
drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents for delete
  using (public.is_admin() and not exists (select 1 from public.payments p where p.document_id = id));

-- Payments are read-only for clients; they are written only by the `record-payment`
-- edge function (service role), which also sends the owner notification email.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (public.is_admin() or store_id = public.my_store_id());
