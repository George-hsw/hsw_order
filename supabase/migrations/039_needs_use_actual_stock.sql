-- Needs ordering and the low-stock bell count what is really on the shelf: inventory minus Qty. Sold not Posted, the same figure the
-- replenishment table shows. Before this the bell used the raw inventory, so it could say "enough" for an item the table showed as short.
--
-- Like 029, each function is changed in its own current definition, so nothing else in it can drift. If the part to change is not found
-- exactly, the migration stops and nothing is changed.
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.order_needs(uuid[])'::regprocedure);
  n := replace(d, 'greatest(0, k.inventory)', 'greatest(0, k.inventory - k.qty_sold_not_posted)');
  if n = d then raise exception 'order_needs: the stock figure to change was not found'; end if;
  execute n;

  d := pg_get_functiondef('public.low_stock_by_vendor(uuid[])'::regprocedure);
  n := replace(d, 'greatest(st.inventory, 0)', 'greatest(st.inventory - st.qty_sold_not_posted, 0)');
  if n = d then raise exception 'low_stock_by_vendor: the stock figure to change was not found'; end if;
  execute n;
end $$;
