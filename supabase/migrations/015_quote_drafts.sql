-- One live draft per person: the quote being built and not yet saved. Every device the person is signed in on reads
-- and writes it, and Realtime pushes each change to the others, so a scan on the phone shows on the computer straight
-- away, and a line deleted on one disappears on the other. A saved quote becomes a row in `documents`; the draft is
-- then removed. Only the owner can see or change their row.

create table if not exists public.quote_drafts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  payload    jsonb not null,
  source     text not null default '',   -- which browser wrote it, so a device ignores its own echo
  updated_at timestamptz not null default now()
);
alter table public.quote_drafts enable row level security;

drop policy if exists quote_drafts_own on public.quote_drafts;
create policy quote_drafts_own on public.quote_drafts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.quote_drafts to authenticated;
grant all on public.quote_drafts to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quote_drafts') then
    alter publication supabase_realtime add table public.quote_drafts;
  end if;
end $$;

-- Replaced by the shared draft (migration 014's scan inbox is no longer used).
drop table if exists public.scans;
