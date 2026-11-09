-- Incremental sync: a fingerprint per item so the nightly job writes only what changed,
-- and a note of which kind of pass each sync was.

alter table public.items    add column if not exists hash text;
alter table public.sync_log add column if not exists mode text;     -- 'full' or 'delta'
alter table public.sync_log add column if not exists unchanged integer;
