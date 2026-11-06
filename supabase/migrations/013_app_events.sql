-- Usage log for the admin's Analytics tab: who signed in, what they opened, what they did to orders, and what broke.
-- Every signed-in person can add events about themselves (their email and user id are filled in by the database, so they cannot be
-- faked, and a store can only be named if the person belongs to it). Only the admin can read them. Nothing here holds passwords,
-- quantities typed into orders, or file contents: just the kind of event, the store, the tab and a short error message.

create table if not exists public.app_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid not null default auth.uid(),
  email      text not null default public.jwt_email(),
  store_id   uuid references public.stores (id) on delete set null,
  session_id text not null default '',
  kind       text not null check (char_length(kind) between 1 and 40),
  detail     jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 2000),
  device     text not null default '' check (char_length(device) <= 80),
  device_id  text not null default '' check (char_length(device_id) <= 40)
);
create index if not exists app_events_at_idx on public.app_events (at desc);
create index if not exists app_events_email_idx on public.app_events (email, at desc);

alter table public.app_events enable row level security;

drop policy if exists app_events_insert on public.app_events;
create policy app_events_insert on public.app_events for insert to authenticated
  with check (user_id = auth.uid() and email = public.jwt_email() and (store_id is null or public.can_use_store(store_id)));

drop policy if exists app_events_select on public.app_events;
create policy app_events_select on public.app_events for select to authenticated using (public.is_admin());

drop policy if exists app_events_delete on public.app_events;
create policy app_events_delete on public.app_events for delete to authenticated using (public.is_admin());

grant select, insert, delete on public.app_events to authenticated;

-- Keeps six months of events. Admin only.
create or replace function public.app_events_prune(p_days int default 180)
returns bigint
language plpgsql security definer set search_path = public as $$
declare n bigint;
begin
  if not public.is_admin() then raise exception 'Admin only' using errcode = '42501'; end if;
  delete from public.app_events where at < now() - make_interval(days => greatest(p_days, 30));
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.app_events_prune(int) from public, anon;
grant execute on function public.app_events_prune(int) to authenticated, service_role;
