create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create table if not exists public.push_dispatch_config (
  id text primary key check (id = 'current'),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

alter table public.push_dispatch_config enable row level security;
revoke all on table public.push_dispatch_config from anon, authenticated;
grant select on table public.push_dispatch_config to service_role;

create policy "deny_client_push_dispatch_config"
on public.push_dispatch_config
for all
to anon, authenticated
using (false)
with check (false);
