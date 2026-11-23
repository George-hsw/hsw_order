-- One stock rule everywhere: actual stock = inventory - qty sold not posted, for every store. NAV holds Qty. Sold not Posted as a negative
-- (sold 3 shows -3), so the SQL adds it: 14 + (-3) = 11. This also corrects 039 (Needs ordering and the bell), which subtracted it.
-- This brings the Sales item list, the Sales scan/item view and the closure planner onto the same figure. Before this they showed the raw NAV
-- inventory, so an item with inventory 14 and Qty. Sold not Posted -3 read 14 instead of 11.
--
-- Each function is changed in its own current definition, so nothing else in it can drift. If the part to change is not found exactly,
-- the migration stops and nothing is changed.
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.store_item_sales(uuid,int,int)'::regprocedure);
  n := replace(d, 'coalesce(ss.inventory, 0)', 'coalesce(ss.inventory + ss.qty_sold_not_posted, 0)');
  if n = d then raise exception 'store_item_sales: the stock figure to change was not found'; end if;
  execute n;

  d := pg_get_functiondef('public.sales_item_stock(uuid,text)'::regprocedure);
  n := replace(d, 'select ss.inventory, ss.moq, ss.vendor_no', 'select ss.inventory + ss.qty_sold_not_posted, ss.moq, ss.vendor_no');
  if n = d then raise exception 'sales_item_stock: the stock figure to change was not found'; end if;
  execute n;

  d := pg_get_functiondef('public.closure_need(uuid[],text[],uuid)'::regprocedure);
  n := replace(d, 'greatest(0, k.inventory)::float8', 'greatest(0, k.inventory + k.qty_sold_not_posted)::float8');
  if n = d then raise exception 'closure_need: the stock figure to change was not found'; end if;
  execute n;

  d := pg_get_functiondef('public.order_needs(uuid[])'::regprocedure);
  n := replace(d, 'greatest(0, k.inventory - k.qty_sold_not_posted)', 'greatest(0, k.inventory + k.qty_sold_not_posted)');
  if n = d then raise exception 'order_needs: the stock figure to change was not found'; end if;
  execute n;

  d := pg_get_functiondef('public.low_stock_by_vendor(uuid[])'::regprocedure);
  n := replace(d, 'greatest(st.inventory - st.qty_sold_not_posted, 0)', 'greatest(st.inventory + st.qty_sold_not_posted, 0)');
  if n = d then raise exception 'low_stock_by_vendor: the stock figure to change was not found'; end if;
  execute n;
end $$;
