-- A store marks an ordered order as received, with the quantity that actually arrived for each line and an optional note
-- (short, damaged, wrong item). The order stays 'ordered' (the one-current-order index depends on that); received_at says it has arrived.

alter table public.orders add column if not exists received_at timestamptz;
alter table public.orders add column if not exists received_by text;
alter table public.orders add column if not exists receive_note text;
alter table public.order_lines add column if not exists qty_received integer check (qty_received is null or qty_received >= 0);

-- The view lists o.*, so it has to be rebuilt to include the new columns.
drop view if exists public.order_summaries;
create view public.order_summaries with (security_invoker = true) as
select o.*, st.name as store_name,
       coalesce(t.lines, 0)::int as lines, coalesce(t.units, 0)::int as units, coalesce(t.cost, 0) as cost
  from public.orders o
  join public.stores st on st.id = o.store_id
  left join lateral (
    select count(*) as lines, sum(qty) as units, sum(qty * round(unit_cost, 2)) as cost
      from public.order_lines where order_id = o.id) t on true;
grant select on public.order_summaries to authenticated;

-- p_lines: [{ "id": <order line id>, "qty_received": n }]. A line left out counts as fully received.
create or replace function public.receive_order(p_order uuid, p_lines jsonb default '[]'::jsonb, p_note text default '')
returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders; who text := public.jwt_email(); short integer; note text := left(trim(coalesce(p_note, '')), 500);
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not (public.is_admin() or public.can_use_store(o.store_id)) then raise exception 'No access to this order' using errcode = '42501'; end if;
  if o.status <> 'ordered' then raise exception 'Only an order that has been ordered in NAV can be received'; end if;
  if o.received_at is not null then raise exception 'This order is already marked received'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'The lines must be a list'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as j(id uuid, qty_received numeric)
              where j.qty_received is null or j.qty_received < 0 or j.qty_received > 99999 or j.qty_received <> trunc(j.qty_received)
                 or not exists (select 1 from public.order_lines l where l.id = j.id and l.order_id = p_order)) then
    raise exception 'Each received quantity must be a whole number on this order';
  end if;
  update public.order_lines l set qty_received = coalesce((select j.qty_received::integer from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as j(id uuid, qty_received numeric) where j.id = l.id), l.qty)
   where l.order_id = p_order;
  select count(*) into short from public.order_lines where order_id = p_order and qty_received < qty;
  update public.orders set received_at = now(), received_by = who, receive_note = nullif(note, '') where id = p_order returning * into o;
  insert into public.audit_events (store_id, order_id, actor, action, detail)
    values (o.store_id, o.id, who, 'order_received', jsonb_build_object('short_lines', short, 'note', nullif(note, '')));
  return o;
end $$;

revoke execute on function public.receive_order(uuid, jsonb, text) from public, anon;
grant execute on function public.receive_order(uuid, jsonb, text) to authenticated, service_role;
