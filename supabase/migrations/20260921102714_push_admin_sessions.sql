create table if not exists public.push_admin_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  created_from_device_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists push_admin_sessions_expires_idx
  on public.push_admin_sessions (expires_at);

alter table public.push_admin_sessions enable row level security;

revoke all on table public.push_admin_sessions from anon, authenticated;
grant select, insert, update, delete on table public.push_admin_sessions to service_role;

drop policy if exists "deny_client_push_admin_sessions" on public.push_admin_sessions;
create policy "deny_client_push_admin_sessions"
on public.push_admin_sessions
for all to anon, authenticated
using (false)
with check (false);
