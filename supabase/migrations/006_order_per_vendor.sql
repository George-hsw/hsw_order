-- One order per vendor. A NAV purchase order is made for one vendor, so a store now has one current order (open or copied,
-- not yet ordered in NAV) for each vendor, instead of one for the whole store. A line takes its vendor from its order.

alter table public.orders add column if not exists vendor_no text;
update public.orders set vendor_no = 'UNKNOWN' where vendor_no is null; -- only orders made before this change
alter table public.orders alter column vendor_no set not null;
alter table public.orders drop constraint if exists orders_vendor_not_blank;
alter table public.orders add constraint orders_vendor_not_blank check (length(trim(vendor_no)) > 0);

drop index if exists public.orders_one_current;
create unique index orders_one_current on public.orders (store_id, vendor_no) where status <> 'ordered';

-- The view lists o.*, so it has to be rebuilt to include the new column.
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

drop function if exists public.open_order(uuid);
drop function if exists public.save_line(uuid, text, integer, integer, numeric, text, text, text);

-- Open the store's current order for one vendor, starting one if there is none.
create or replace function public.open_order(p_store uuid, p_vendor text) returns public.orders
language plpgsql security definer set search_path = public as $$
declare o public.orders; v text := nullif(trim(p_vendor), '');
begin
  if v is null then raise exception 'Choose a vendor'; end if;
  if not public.can_use_store(p_store) then raise exception 'No access to this store' using errcode = '42501'; end if;
  select * into o from public.orders where store_id = p_store and vendor_no = v and status <> 'ordered';
  if found then return o; end if;
  insert into public.orders (store_id, vendor_no, created_by) values (p_store, v, public.jwt_email())
    on conflict (store_id, vendor_no) where status <> 'ordered' do nothing
    returning * into o;
  if o.id is null then -- someone else started it a moment ago
    select * into o from public.orders where store_id = p_store and vendor_no = v and status <> 'ordered';
  else
    insert into public.audit_events (store_id, order_id, actor, action, detail)
      values (p_store, o.id, public.jwt_email(), 'order_started', jsonb_build_object('vendor', v));
  end if;
  return o;
end $$;

-- Done on the phone: set an item's line to an absolute quantity (0 removes it). The line's vendor is the order's vendor.
-- p_base is the revision the caller last saw (0 = no line yet). If someone else has changed the line since, nothing is
-- written and the current line comes back.
create or replace function public.save_line(
  p_order uuid, p_item text, p_qty integer, p_base integer,
  p_unit_cost numeric, p_division text, p_description text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; l public.order_lines; who text := public.jwt_email();
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not public.can_use_store(o.store_id) then raise exception 'No access to this order' using errcode = '42501'; end if;
  if o.status = 'ordered' then raise exception 'This order has already been ordered in NAV'; end if;
  if p_qty is null or p_qty < 0 or p_qty > 99999 then raise exception 'Quantity must be a whole number from 0 to 99,999'; end if;

  select * into l from public.order_lines where order_id = p_order and item_code = p_item for update;
  if coalesce(l.revision, 0) <> coalesce(p_base, 0) then
    return jsonb_build_object('status', 'conflict', 'current', case when l.id is null then null else to_jsonb(l) end);
  end if;

  if p_qty = 0 then
    if l.id is not null then
      delete from public.order_lines where id = l.id;
      insert into public.audit_events (store_id, order_id, actor, action, detail)
        values (o.store_id, o.id, who, 'line_removed', jsonb_build_object('item', p_item, 'was', l.qty));
    end if;
    return jsonb_build_object('status', 'ok');
  end if;

  if l.id is null then
    insert into public.order_lines (order_id, store_id, item_code, qty, unit_cost, vendor_no, division, description, updated_by)
      values (o.id, o.store_id, p_item, p_qty, coalesce(p_unit_cost, 0), o.vendor_no, nullif(trim(p_division), ''),
              coalesce(p_description, ''), who);
  else
    update public.order_lines
       set qty = p_qty, unit_cost = coalesce(p_unit_cost, unit_cost), division = nullif(trim(p_division), ''),
           description = coalesce(p_description, description), revision = revision + 1, updated_by = who, updated_at = now()
     where id = l.id;
  end if;
  insert into public.audit_events (store_id, order_id, actor, action, detail)
    values (o.store_id, o.id, who, 'line_saved', jsonb_build_object('item', p_item, 'qty', p_qty, 'was', l.qty));
  return jsonb_build_object('status', 'ok');
end $$;

-- New functions are executable by everyone by default: close that, then open only what signed-in people need.
revoke execute on function public.open_order(uuid, text) from public, anon;
revoke execute on function public.save_line(uuid, text, integer, integer, numeric, text, text) from public, anon;
grant execute on function public.open_order(uuid, text), public.save_line(uuid, text, integer, integer, numeric, text, text) to authenticated;
grant execute on function public.open_order(uuid, text), public.save_line(uuid, text, integer, integer, numeric, text, text) to service_role;
