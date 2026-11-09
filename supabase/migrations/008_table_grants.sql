-- Explicit table permissions for the API roles.
-- Older Supabase projects grant these automatically; newer ones do not, which shows up as
-- "permission denied for table items". Row Level Security (migrations 001, 002, 004, 006) still decides
-- which rows each user can touch: these grants only open the door to the tables.

-- The edge functions and the GitHub schedulers use the service_role key: full access.
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- Signed-in store users and the admin. The anon (signed-out) role gets nothing.
grant usage on schema public to authenticated;
grant select, insert, update         on public.stores          to authenticated;  -- policies limit writes to the admin
grant select, insert, update, delete on public.documents       to authenticated;
grant select                         on public.payments        to authenticated;  -- written only by record-payment
grant select                         on public.document_emails to authenticated;  -- written only by send-document
grant execute on function public.is_admin(), public.my_store_id() to authenticated;

-- items, sync_log and auth_code_requests stay service_role only.
