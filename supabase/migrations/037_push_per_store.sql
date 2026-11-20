-- A push ("send these items to stores") has no stock pool to share out: each store is asked for its own quantity, so the same item can go to
-- every store. Only a store closing is held to what the closing store has. The list quantity on a push is the default per store.

create or replace function public.save_closure_alloc(p_closure uuid, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare c public.closures; bad text;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  select * into c from public.closures where id = p_closure for update;
  if not found then raise exception 'That closure does not exist'; end if;
  if c.status <> 'draft' then raise exception 'This closure has been sent, so its quantities can no longer change'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'The rows must be a list'; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric, suggested_qty numeric)
              where j.qty is null or j.qty < 0 or j.qty <> trunc(j.qty) or coalesce(j.suggested_qty, 0) < 0) then
    raise exception 'Quantities must be whole numbers, zero or more';
  end if;
  delete from public.closure_alloc a using jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric, suggested_qty numeric)
   where a.closure_id = p_closure and a.store_id = j.store_id and a.item_code = j.item_code and j.qty = 0;
  insert into public.closure_alloc (closure_id, store_id, item_code, qty, suggested_qty)
    select p_closure, j.store_id, j.item_code, j.qty::integer, coalesce(j.suggested_qty, 0)::integer
      from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric, suggested_qty numeric) where j.qty > 0
    on conflict (closure_id, store_id, item_code) do update set qty = excluded.qty, suggested_qty = excluded.suggested_qty;
  select string_agg(x.item_code, ', ') into bad from (
    select a.item_code from public.closure_alloc a join public.closure_lines l on l.closure_id = a.closure_id and l.item_code = a.item_code
     where a.closure_id = p_closure group by a.item_code, l.qty having sum(a.qty) > l.qty limit 5) x;
  if bad is not null and c.kind = 'closure' then raise exception 'These items are given out above what the sheet holds: %', bad; end if;
end $$;

create or replace function public.send_closure(p_closure uuid)
returns setof uuid
language plpgsql security definer set search_path = public as $$
declare c public.closures; s record; rid uuid; who text := public.jwt_email(); bad text;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  select * into c from public.closures where id = p_closure for update;
  if not found then raise exception 'That closure does not exist'; end if;
  if c.status <> 'draft' then raise exception 'This closure has already been sent'; end if;
  select string_agg(x.item_code, ', ') into bad from (
    select a.item_code from public.closure_alloc a join public.closure_lines l on l.closure_id = a.closure_id and l.item_code = a.item_code
     where a.closure_id = p_closure group by a.item_code, l.qty having sum(a.qty) > l.qty limit 5) x;
  if bad is not null and c.kind = 'closure' then raise exception 'These items are given out above what the sheet holds: %', bad; end if;
  if not exists (select 1 from public.closure_alloc where closure_id = p_closure and qty > 0) then raise exception 'Nothing has been given to any store yet'; end if;
  for s in select a.store_id, count(*) as lines, sum(a.qty) as units from public.closure_alloc a where a.closure_id = p_closure and a.qty > 0 group by a.store_id loop
    insert into public.transfer_requests (closure_id, from_store_id, from_store_name, to_store_id, sent_by)
      values (p_closure, c.closing_store_id, coalesce((select name from public.stores where id = c.closing_store_id), ''), s.store_id, who) returning id into rid;
    insert into public.transfer_request_lines (request_id, item_code, description, qty_requested, unit_cost)
      select rid, a.item_code, l.description, a.qty, l.unit_cost
        from public.closure_alloc a join public.closure_lines l on l.closure_id = a.closure_id and l.item_code = a.item_code
       where a.closure_id = p_closure and a.store_id = s.store_id and a.qty > 0;
    insert into public.audit_events (store_id, actor, action, detail)
      values (s.store_id, who, 'transfer_sent', jsonb_build_object('request', rid, 'closure', p_closure, 'from', c.closing_store_id, 'lines', s.lines, 'units', s.units, 'kind', c.kind));
    return next rid;
  end loop;
  update public.closures set status = 'sent', sent_at = now() where id = p_closure;
end $$;

create or replace function public.set_closure_line(p_closure uuid, p_code text, p_qty numeric, p_description text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare c public.closures; v_code text := trim(coalesce(p_code, '')); given integer; total integer;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  select * into c from public.closures where id = p_closure for update;
  if not found then raise exception 'That closure does not exist'; end if;
  if c.status <> 'draft' then raise exception 'This list has been sent, so it can no longer change'; end if;
  if v_code = '' then raise exception 'Enter an item number'; end if;
  if p_qty is null or p_qty < 0 or p_qty <> trunc(p_qty) or p_qty > 999999 then raise exception 'The quantity must be a whole number, zero or more'; end if;
  select coalesce(sum(qty), 0) into given from public.closure_alloc where closure_id = p_closure and item_code = v_code;
  if p_qty < given and c.kind = 'closure' then raise exception '% units of % are already shared out to stores. Lower their quantities first.', given, v_code; end if;
  if p_qty = 0 then
    delete from public.closure_lines where closure_id = p_closure and item_code = v_code;
    return;
  end if;
  if not exists (select 1 from public.items i where i.code = v_code and not i.removed) then raise exception 'That item number is not in the item list: %', v_code; end if;
  insert into public.closure_lines (closure_id, item_code, qty, description, system_qty, unit_cost)
    select p_closure, v_code, p_qty::integer, left(coalesce(nullif(trim(p_description), ''), i.description, ''), 200), ss.inventory, coalesce(ss.store_cost, 0)
      from public.items i
      left join public.store_stock ss on ss.store_id = c.closing_store_id and ss.item_code = v_code
     where i.code = v_code
    on conflict (closure_id, item_code) do update set qty = excluded.qty;
  select count(*) into total from public.closure_lines where closure_id = p_closure;
  if total > 20000 then raise exception 'A list can have at most 20,000 lines'; end if;
end $$;
