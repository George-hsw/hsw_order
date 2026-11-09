-- Sign-in code requests, so the request-code function can limit how many codes one address receives.
-- Written and read only by that function (service role).

create table if not exists public.auth_code_requests (
  id           bigint generated always as identity primary key,
  email        text not null,
  requested_at timestamptz not null default now()
);
create index if not exists auth_code_requests_idx on public.auth_code_requests (email, requested_at desc);

alter table public.auth_code_requests enable row level security;
-- No policies: clients cannot touch it.
