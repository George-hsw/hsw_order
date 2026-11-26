-- The labels waiting to be printed, one queue per store, shared by every device: an item added from Price check on a phone shows in
-- Labels on the store computer straight away. Anyone in the store (and the admin) can read and change their store's queue.

create table if not exists public.label_queue (
  store_id    uuid not null references public.stores(id) on delete cascade,
  item_code   text not null check (char_length(item_code) between 1 and 60),
  description text not null default '' check (char_length(description) <= 250),
  price       numeric(12,2),                                                  -- RRP including GST when it was added
  barcode     text check (char_length(barcode) <= 60),
  qty         integer not null default 1 check (qty between 0 and 99),
  discount    text not null default '' check (char_length(discount) <= 8),    -- clearance labels only, as typed
  added_by    text not null default coalesce(public.jwt_email(), ''),
  added_at    timestamptz not null default now(),
  primary key (store_id, item_code)                                           -- a repeat scan counts up the same line
);
alter table public.label_queue enable row level security;

drop policy if exists label_queue_all on public.label_queue;
create policy label_queue_all on public.label_queue for all
  using (store_id in (select public.my_store_ids()) or (select public.is_admin()))
  with check (store_id in (select public.my_store_ids()) or (select public.is_admin()));

-- Adding counts up in the database, so two devices adding the same item at once both count. Runs as the caller (Row Level Security applies).
-- Returns how many labels are then waiting at the store.
create or replace function public.queue_label(p_store uuid, p_item text, p_description text, p_price numeric, p_barcode text, p_qty integer)
returns integer
language plpgsql security invoker set search_path = public as $$
begin
  if p_qty is null or p_qty < 1 then raise exception 'Add at least one label'; end if;
  insert into public.label_queue as q (store_id, item_code, description, price, barcode, qty)
    values (p_store, p_item, left(coalesce(p_description, ''), 250), p_price, nullif(trim(p_barcode), ''), least(p_qty, 99))
    on conflict (store_id, item_code) do update
      set qty = least(q.qty + excluded.qty, 99), description = excluded.description, price = excluded.price, barcode = excluded.barcode;
  return (select coalesce(sum(qty), 0)::int from public.label_queue where store_id = p_store);
end $$;

-- Takes printed or cleared quantities off the queue. Only what was taken goes, so labels added meanwhile on another device stay.
create or replace function public.take_labels(p_store uuid, p_taken jsonb)
returns void
language plpgsql security invoker set search_path = public as $$
declare r record;
begin
  for r in select t.code, sum(greatest(t.qty, 0))::int as qty from jsonb_to_recordset(p_taken) as t(code text, qty integer) group by t.code order by t.code loop
    delete from public.label_queue where store_id = p_store and item_code = r.code and qty <= r.qty;
    if not found then update public.label_queue set qty = qty - r.qty where store_id = p_store and item_code = r.code; end if;
  end loop;
end $$;

-- Live updates to every device with Labels open.
alter table public.label_queue replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.label_queue; exception when duplicate_object then null; end;
  end if;
end $$;

grant select, insert, update, delete on public.label_queue to authenticated;
grant all on public.label_queue to service_role;
revoke execute on function public.queue_label(uuid, text, text, numeric, text, integer), public.take_labels(uuid, jsonb) from public, anon;
grant execute on function public.queue_label(uuid, text, text, numeric, text, integer), public.take_labels(uuid, jsonb) to authenticated, service_role;
