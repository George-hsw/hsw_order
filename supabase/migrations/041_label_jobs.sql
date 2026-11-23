-- Past label prints: every print is kept so the store can see it again, change it, print it again or delete it.
-- Anyone in the store (and the admin) can read and change their store's prints.

create table if not exists public.label_jobs (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  template    text not null check (template in ('shelf', 'hook', 'clearance', 'strip')),
  start_at    integer not null default 1 check (start_at between 1 and 200),
  barcode     boolean not null default false,
  teal        boolean not null default false,
  lines       jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 500),
  label_count integer not null default 0 check (label_count >= 0),
  printed_by  text not null default coalesce(public.jwt_email(), ''),
  printed_at  timestamptz not null default now()
);
create index if not exists label_jobs_store_idx on public.label_jobs (store_id, printed_at desc);
alter table public.label_jobs enable row level security;

drop policy if exists label_jobs_all on public.label_jobs;
create policy label_jobs_all on public.label_jobs for all
  using (store_id in (select public.my_store_ids()) or (select public.is_admin()))
  with check (store_id in (select public.my_store_ids()) or (select public.is_admin()));

grant select, insert, update, delete on public.label_jobs to authenticated;
grant all on public.label_jobs to service_role;
