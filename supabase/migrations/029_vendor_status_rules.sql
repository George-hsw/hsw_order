-- My Home Storage (MYH…) items with status TOS cannot be ordered. The Order screen already refuses them (src/lib/vendorRules.ts); this makes
-- Needs ordering and the bell leave them out too, so the list never suggests what the screen would then refuse.
--
-- Each function is changed by adding one condition to its own current definition, so nothing else in it can drift. If the line to change is not
-- found exactly (someone edited the function since), the migration stops and nothing is changed.

do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.order_needs(uuid[])'::regprocedure);
  n := replace(d, 'and not it.blocked and not it.exclude_from_replen and not k.po_blocked',
                  'and not it.blocked and not it.exclude_from_replen and not k.po_blocked and not (upper(left(k.vendor_no, 3)) = ''MYH'' and upper(trim(it.status)) = ''TOS'')');
  if n = d then raise exception 'order_needs: the condition to change was not found'; end if;
  execute n;

  d := pg_get_functiondef('public.low_stock_by_vendor(uuid[])'::regprocedure);
  n := replace(d, 'and not i.removed and not i.blocked and not i.exclude_from_replen',
                  'and not i.removed and not i.blocked and not i.exclude_from_replen and not (upper(left(st.vendor_no, 3)) = ''MYH'' and upper(trim(i.status)) = ''TOS'')');
  if n = d then raise exception 'low_stock_by_vendor: the condition to change was not found'; end if;
  execute n;
end $$;
