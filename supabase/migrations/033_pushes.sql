-- Pushes: operations can also send chosen items to stores without a store closing. A push is a closure with kind 'push' and, optionally, no sending
-- store. Everything after the list (the planner, the requests, the store's answer, NAV copy, the bell) is the same as for a closure. A request with
-- no sending store has an empty from_store_name, which is how a store knows it is being asked to order the items, not take stock from a store.
--
-- Also: one line of a draft can be added, changed or removed by hand (set_closure_line), for closures and pushes alike. Closures made before this
-- keep kind 'closure' and work exactly as they did.

alter table public.closures add column if not exists kind text not null default 'closure' check (kind in ('closure', 'push'));
alter table public.closures alter column closing_store_id drop not null;
alter table public.closures drop constraint if exists closures_source_ck;
alter table public.closures add constraint closures_source_ck check (kind = 'push' or closing_store_id is not null);
alter table public.transfer_requests alter column from_store_id drop not null;

-- A new closure or push. A closure needs its closing store; a push may have none.
drop function if exists public.create_closure(uuid, text, text);
create or replace function public.create_closure(p_store uuid, p_name text, p_file text, p_kind text default 'closure')
returns public.closures
language plpgsql security definer set search_path = public as $$
declare c public.closures;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  if p_kind not in ('closure', 'push') then raise exception 'Choose a closure or a push'; end if;
  if p_kind = 'closure' and p_store is null then raise exception 'Choose the closing store'; end if;
  if p_store is not null and not exists (select 1 from public.stores where id = p_store) then raise exception 'Choose the sending store'; end if;
  insert into public.closures (closing_store_id, name, source_file, kind) values (p_store, left(trim(coalesce(p_name, '')), 100), left(trim(coalesce(p_file, '')), 200), p_kind) returning * into c;
  return c;
end $$;

-- Add, change or remove one line of a draft. Quantity 0 removes it. It cannot go below what is already shared out to stores.
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
  if p_qty < given then raise exception '% units of % are already shared out to stores. Lower their quantities first.', given, v_code; end if;
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

-- Sending: the sending store may be none, in which case the request carries an empty name.
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
  if bad is not null then raise exception 'These items are given out above what the sheet holds: %', bad; end if;
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

-- Offering what is left again: the same, with the sending store possibly none.
create or replace function public.reoffer_lines(p_closure uuid, p_rows jsonb)
returns setof uuid
language plpgsql security definer set search_path = public as $$
declare c public.closures; s record; rid uuid; who text := public.jwt_email(); bad text; rnd integer;
begin
  if not public.ops_ok() then raise exception 'Operations only' using errcode = '42501'; end if;
  select * into c from public.closures where id = p_closure for update;
  if not found then raise exception 'That closure does not exist'; end if;
  if c.status <> 'sent' then raise exception 'Only a closure that has been sent can be offered again'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'The rows must be a list'; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric)
              where j.qty is null or j.qty <= 0 or j.qty <> trunc(j.qty)) then raise exception 'Quantities must be whole numbers above zero'; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric)
              where not exists (select 1 from public.stores st where st.id = j.store_id and st.active) or j.store_id is not distinct from c.closing_store_id) then
    raise exception 'Only open stores other than the sending store can take stock';
  end if;
  select string_agg(x.item_code, ', ') into bad from (
    select j.item_code
      from (select r2.item_code, sum(r2.qty) as qty from jsonb_to_recordset(p_rows) as r2(store_id uuid, item_code text, qty numeric) group by r2.item_code) j
      join public.closure_lines l on l.closure_id = p_closure and l.item_code = j.item_code
     where j.qty > l.qty - coalesce((
       select sum(case when r.status = 'sent' then t.qty_requested else coalesce(t.qty_accepted, 0) end)
         from public.transfer_requests r join public.transfer_request_lines t on t.request_id = r.id
        where r.closure_id = p_closure and r.status in ('sent', 'accepted', 'received') and t.item_code = j.item_code), 0)
     limit 5) x;
  if bad is not null then raise exception 'These items have less left than you are offering: %', bad; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric) where not exists (select 1 from public.closure_lines l where l.closure_id = p_closure and l.item_code = j.item_code)) then
    raise exception 'An item is not on this closure';
  end if;
  for s in select j.store_id, count(*) as lines, sum(j.qty) as units from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric) group by j.store_id loop
    select coalesce(max(round), 0) + 1 into rnd from public.transfer_requests where closure_id = p_closure and to_store_id = s.store_id;
    insert into public.transfer_requests (closure_id, from_store_id, from_store_name, to_store_id, round, sent_by)
      values (p_closure, c.closing_store_id, coalesce((select name from public.stores where id = c.closing_store_id), ''), s.store_id, rnd, who) returning id into rid;
    insert into public.transfer_request_lines (request_id, item_code, description, qty_requested, unit_cost)
      select rid, j.item_code, l.description, j.qty::integer, l.unit_cost
        from jsonb_to_recordset(p_rows) as j(store_id uuid, item_code text, qty numeric)
        join public.closure_lines l on l.closure_id = p_closure and l.item_code = j.item_code
       where j.store_id = s.store_id;
    insert into public.audit_events (store_id, actor, action, detail)
      values (s.store_id, who, 'transfer_sent', jsonb_build_object('request', rid, 'closure', p_closure, 'from', c.closing_store_id, 'lines', s.lines, 'units', s.units, 'round', rnd, 'kind', c.kind));
    return next rid;
  end loop;
end $$;

revoke execute on function public.create_closure(uuid, text, text, text), public.set_closure_line(uuid, text, numeric, text) from public, anon;
grant execute on function public.create_closure(uuid, text, text, text), public.set_closure_line(uuid, text, numeric, text) to authenticated, service_role;
