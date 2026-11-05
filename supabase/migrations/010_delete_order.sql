-- Delete an order that has not been ordered in NAV (open or copied). Anyone in the store may. An order marked as ordered in NAV is
-- kept as the record of what was ordered, so it cannot be deleted here. The audit trail keeps a note of the deletion.
create or replace function public.delete_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; n integer;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not public.can_use_store(o.store_id) then raise exception 'No access to this order' using errcode = '42501'; end if;
  if o.status = 'ordered' then raise exception 'An order ordered in NAV is kept as a record and cannot be deleted'; end if;
  select count(*) into n from public.order_lines where order_id = o.id;
  insert into public.audit_events (store_id, order_id, actor, action, detail)
    values (o.store_id, null, public.jwt_email(), 'order_deleted', jsonb_build_object('vendor', o.vendor_no, 'status', o.status, 'lines', n));
  delete from public.orders where id = o.id; -- its lines go with it
end $$;

revoke execute on function public.delete_order(uuid) from public, anon;
grant execute on function public.delete_order(uuid) to authenticated, service_role;
