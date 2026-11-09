-- Scan on a phone, add to the quote open on the computer. A phone in "send to my computer" mode writes the barcode
-- here; any other device signed in as the same person picks it up (live, or when it next opens), adds the item to the
-- quote on screen, and deletes the row. A row only ever belongs to the person who scanned it.

create table if not exists public.scans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code       text not null check (length(code) between 1 and 80),
  source     text not null default '',   -- which browser sent it, so the sender does not pick up its own scan
  created_at timestamptz not null default now()
);
create index if not exists scans_user_idx on public.scans (user_id, created_at);
alter table public.scans enable row level security;

drop policy if exists scans_own on public.scans;
create policy scans_own on public.scans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, delete on public.scans to authenticated;
grant all on public.scans to service_role;

-- Live delivery to the other device.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scans') then
    alter publication supabase_realtime add table public.scans;
  end if;
end $$;
