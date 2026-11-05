-- Explicit table and function permissions for the API roles. Newer Supabase projects do not grant these automatically.
-- Row Level Security (001 to 003) still decides which rows each person can touch: these grants only open the door.

-- The edge functions and the GitHub sync use the service_role key: full access.
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- Signed-in people and the admin. The anon (signed-out) role gets nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.stores to authenticated; -- the policy limits writes to the admin
grant select on public.app_users, public.store_members, public.items, public.store_stock, public.sync_runs,
                public.orders, public.order_lines, public.audit_events, public.order_summaries to authenticated;

-- Functions are executable by everyone by default: close that, then open only what signed-in people need.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.jwt_email(), public.is_admin(), public.role_in(uuid), public.can_use_store(uuid), public.in_any_store(),
  public.open_order(uuid),
  public.save_line(uuid, text, integer, integer, numeric, text, text, text),
  public.set_order_status(uuid, text, text) to authenticated;
