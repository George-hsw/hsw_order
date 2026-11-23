-- Actual stock = inventory - the size of Qty. Sold not Posted, for every store. The NAV feed's sign is not reliable (-3 at one store, +2 at
-- another, both sales), so the size is used: 14 and -3 gives 11, 24 and +2 gives 22. This replaces the "add the signed value" of 043.
--
-- Each function is changed in its own current definition. If the part to change is not found exactly, the migration stops and nothing is changed.
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.store_item_sales(uuid,int,int)'::regprocedure);
  n := replace(d, 'ss.inventory + ss.qty_sold_not_posted', 'ss.inventory - abs(ss.qty_sold_not_posted)');
  if n = d then raise exception 'store_item_sales: the stock figure to change was not found'; end if;
  execute n;

  d := pg_get_functiondef('public.sales_item_stock(uuid,text)'::regprocedure);
  n := replace(d, 'ss.inventory + ss.qty_sold_not_posted', 'ss.inventory - abs(ss.qty_sold_not_posted)');
  if n = d then raise exception 'sales_item_stock: the stock figure to change was not found'; end if;
  execute n;

  d := pg_get_functiondef('public.closure_need(uuid[],text[],uuid)'::regprocedure);
  n := replace(d, 'k.inventory + k.qty_sold_not_posted', 'k.inventory - abs(k.qty_sold_not_posted)');
  if n = d then raise exception 'closure_need: the stock figure to change was not found'; end if;
  execute n;

  d := pg_get_functiondef('public.order_needs(uuid[])'::regprocedure);
  n := replace(d, 'k.inventory + k.qty_sold_not_posted', 'k.inventory - abs(k.qty_sold_not_posted)');
  if n = d then raise exception 'order_needs: the stock figure to change was not found'; end if;
  execute n;

  d := pg_get_functiondef('public.low_stock_by_vendor(uuid[])'::regprocedure);
  n := replace(d, 'st.inventory + st.qty_sold_not_posted', 'st.inventory - abs(st.qty_sold_not_posted)');
  if n = d then raise exception 'low_stock_by_vendor: the stock figure to change was not found'; end if;
  execute n;
end $$;
