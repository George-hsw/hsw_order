-- Merge step 2: explicit permissions for the ordering, sales and analytics tables and functions.
-- Row Level Security (018 to 026) still decides which rows each person can touch; these grants only open the door.
-- Narrower than the old Orders grants file on purpose: it does NOT revoke execute on every function, because that would
-- also close Quote's own functions.

-- The edge functions and the GitHub sync use the service_role key: full access (new tables and functions included).
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Signed-in people and the admin. The anon (signed-out) role gets nothing.
grant delete on public.stores to authenticated; -- the policy limits it to the admin
grant select on public.items, public.store_stock, public.sync_runs,
                public.orders, public.order_lines, public.audit_events, public.order_summaries to authenticated;

grant execute on function public.in_any_store(), public.set_order_status(uuid, text, text) to authenticated;
revoke execute on function public.in_any_store() from anon;
revoke execute on function public.set_order_status(uuid, text, text) from public, anon;
