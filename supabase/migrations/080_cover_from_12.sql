-- The Hold choices start at 12 weeks and step by 4 (12, 16, 20, 24). When the next step is not loaded yet, the last week of item
-- sales loaded takes its place. A saved target counts as the first choice at or above it. The same rule as coverFor in src/lib/insights.ts.
create or replace function public.cover_target(saved integer, loaded integer) returns integer
language sql immutable as $$
  select least((ceil(greatest(coalesce(saved, 12), 12) / 4.0) * 4)::int, case when loaded > 0 then least(loaded, 26) else 12 end)
$$;
revoke all on function public.cover_target(integer, integer) from public, anon;
grant execute on function public.cover_target(integer, integer) to authenticated, service_role;

alter table public.store_prefs alter column cover_weeks set default 12;

-- Every function that fell back to 4 weeks now uses the rule above. Each is changed in its own current definition. If one of the
-- three that must change is not found, the migration stops and nothing is changed.
do $$
declare
  f record;
  done text[] := '{}';
begin
  for f in
    select p.proname::text as name, pg_get_functiondef(p.oid) as d
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosrc ~ 'coalesce\([a-z_., ]*cover_weeks, 4\)'
  loop
    execute regexp_replace(f.d, 'coalesce\(([a-z_., ]*cover_weeks), 4\)',
      'public.cover_target(coalesce(\1, 12), (select count(*) from public.sales_weeks)::int)', 'g');
    done := done || f.name;
  end loop;
  if not done @> array['order_needs', 'low_stock_by_vendor', 'closure_need'] then
    raise exception 'cover target: expected to change order_needs, low_stock_by_vendor and closure_need, changed only %', done;
  end if;
end $$;
