-- Copy for NAV now sends the vendor item number, description and unit of measure as well as the item number and quantity, so a
-- pasted purchase line matches one typed by hand. An order line keeps what it needs for that (like its description and cost).
alter table public.order_lines add column if not exists vendor_item_no text;
alter table public.order_lines add column if not exists uom text;

drop function if exists public.save_line(uuid, text, integer, integer, numeric, text, text);

create or replace function public.save_line(
  p_order uuid, p_item text, p_qty integer, p_base integer,
  p_unit_cost numeric, p_division text, p_description text, p_vendor_item text, p_uom text
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
    insert into public.order_lines (order_id, store_id, item_code, qty, unit_cost, vendor_no, division, description, vendor_item_no, uom, updated_by)
      values (o.id, o.store_id, p_item, p_qty, coalesce(p_unit_cost, 0), o.vendor_no, nullif(trim(p_division), ''),
              coalesce(p_description, ''), nullif(trim(p_vendor_item), ''), nullif(trim(p_uom), ''), who);
  else
    update public.order_lines
       set qty = p_qty, unit_cost = coalesce(p_unit_cost, unit_cost), division = nullif(trim(p_division), ''),
           description = coalesce(p_description, description), vendor_item_no = nullif(trim(p_vendor_item), ''), uom = nullif(trim(p_uom), ''),
           revision = revision + 1, updated_by = who, updated_at = now()
     where id = l.id;
  end if;
  insert into public.audit_events (store_id, order_id, actor, action, detail)
    values (o.store_id, o.id, who, 'line_saved', jsonb_build_object('item', p_item, 'qty', p_qty, 'was', l.qty));
  return jsonb_build_object('status', 'ok');
end $$;

revoke execute on function public.save_line(uuid, text, integer, integer, numeric, text, text, text, text) from public, anon;
grant execute on function public.save_line(uuid, text, integer, integer, numeric, text, text, text, text) to authenticated, service_role;
