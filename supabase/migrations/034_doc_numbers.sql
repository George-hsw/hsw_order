-- Document numbers are made by the system: one running number per store, so no two people can pick the same one.
-- The counter starts above the highest number a store has already used (or 1000).

create table if not exists public.document_counters (
  store_id    uuid primary key references public.stores(id) on delete cascade,
  last_number integer not null default 1000
);
alter table public.document_counters enable row level security;
grant all on public.document_counters to service_role;

insert into public.document_counters (store_id, last_number)
select s.id, greatest(1000, coalesce(max(((regexp_match(d.doc_number, '-(\d+)$'))[1])::integer), 0))
  from public.stores s
  left join public.documents d on d.store_id = s.id
 group by s.id
on conflict (store_id) do nothing;

-- Hands out the next number for a store. The row lock makes it safe when two people save at the same moment.
create or replace function public.next_doc_number(p_store uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not (public.is_admin() or public.can_use_store(p_store)) then raise exception 'No access to that store' using errcode = '42501'; end if;
  insert into public.document_counters (store_id, last_number) values (p_store, 1001)
  on conflict (store_id) do update set last_number = public.document_counters.last_number + 1
  returning last_number into n;
  return n;
end $$;

revoke execute on function public.next_doc_number(uuid) from public, anon;
grant execute on function public.next_doc_number(uuid) to authenticated, service_role;
