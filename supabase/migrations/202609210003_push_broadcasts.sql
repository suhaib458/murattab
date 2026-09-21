create table if not exists public.push_admin_devices (
  device_id uuid primary key references public.push_devices(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.push_broadcasts (
  id uuid primary key default extensions.gen_random_uuid(),
  created_by_device_id uuid references public.push_devices(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 240),
  url text not null default '/' check (url like '/%' and char_length(url) <= 300),
  created_at timestamptz not null default now()
);

create table if not exists public.push_broadcast_deliveries (
  broadcast_id uuid not null references public.push_broadcasts(id) on delete cascade,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  locked_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (broadcast_id, device_id)
);

create index if not exists push_broadcasts_created_by_device_idx
  on public.push_broadcasts (created_by_device_id);

create index if not exists push_broadcast_deliveries_pending_idx
  on public.push_broadcast_deliveries (created_at)
  where status in ('pending', 'processing');

create index if not exists push_broadcast_deliveries_device_idx
  on public.push_broadcast_deliveries (device_id);

alter table public.push_admin_devices enable row level security;
alter table public.push_broadcasts enable row level security;
alter table public.push_broadcast_deliveries enable row level security;

revoke all on table public.push_admin_devices from anon, authenticated;
revoke all on table public.push_broadcasts from anon, authenticated;
revoke all on table public.push_broadcast_deliveries from anon, authenticated;

grant select, insert, update, delete on table public.push_admin_devices to service_role;
grant select, insert, update, delete on table public.push_broadcasts to service_role;
grant select, insert, update, delete on table public.push_broadcast_deliveries to service_role;

create policy "deny_client_push_admin_devices"
on public.push_admin_devices
for all to anon, authenticated
using (false)
with check (false);

create policy "deny_client_push_broadcasts"
on public.push_broadcasts
for all to anon, authenticated
using (false)
with check (false);

create policy "deny_client_push_broadcast_deliveries"
on public.push_broadcast_deliveries
for all to anon, authenticated
using (false)
with check (false);

create or replace function public.create_push_broadcast(
  p_admin_device_id uuid,
  p_title text,
  p_body text,
  p_url text default '/'
)
returns table (broadcast_id uuid, queued integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_broadcast_id uuid;
  v_queued integer;
begin
  if not exists (
    select 1
    from public.push_admin_devices admin_device
    join public.push_devices device on device.id = admin_device.device_id
    where admin_device.device_id = p_admin_device_id
      and device.enabled
  ) then
    raise exception 'push admin device required';
  end if;

  if char_length(trim(p_title)) not between 1 and 120
     or char_length(trim(p_body)) not between 1 and 240
     or p_url is null
     or p_url not like '/%'
     or char_length(p_url) > 300 then
    raise exception 'invalid broadcast payload';
  end if;

  insert into public.push_broadcasts (created_by_device_id, title, body, url)
  values (p_admin_device_id, trim(p_title), trim(p_body), p_url)
  returning id into v_broadcast_id;

  insert into public.push_broadcast_deliveries (broadcast_id, device_id)
  select v_broadcast_id, device.id
  from public.push_devices device
  where device.enabled
  on conflict do nothing;

  get diagnostics v_queued = row_count;

  return query select v_broadcast_id, v_queued;
end;
$$;

revoke all on function public.create_push_broadcast(uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.create_push_broadcast(uuid, text, text, text)
to service_role;

create or replace function public.claim_push_broadcast_deliveries(p_limit integer default 100)
returns table (
  broadcast_id uuid,
  device_id uuid,
  title text,
  body text,
  url text,
  attempt_count integer,
  endpoint text,
  p256dh text,
  auth text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with candidates as (
    select delivery.broadcast_id, delivery.device_id
    from public.push_broadcast_deliveries delivery
    join public.push_devices device on device.id = delivery.device_id
    where device.enabled
      and (
        delivery.status = 'pending'
        or (delivery.status = 'processing' and delivery.locked_at < now() - interval '5 minutes')
      )
      and delivery.attempt_count < 5
    order by delivery.created_at
    for update of delivery skip locked
    limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update public.push_broadcast_deliveries delivery
    set status = 'processing',
        locked_at = now(),
        attempt_count = delivery.attempt_count + 1
    from candidates
    where delivery.broadcast_id = candidates.broadcast_id
      and delivery.device_id = candidates.device_id
    returning delivery.broadcast_id, delivery.device_id, delivery.attempt_count
  )
  select claimed.broadcast_id,
         claimed.device_id,
         broadcast.title,
         broadcast.body,
         broadcast.url,
         claimed.attempt_count,
         device.endpoint,
         device.p256dh,
         device.auth
  from claimed
  join public.push_broadcasts broadcast on broadcast.id = claimed.broadcast_id
  join public.push_devices device on device.id = claimed.device_id;
end;
$$;

revoke all on function public.claim_push_broadcast_deliveries(integer)
from public, anon, authenticated;
grant execute on function public.claim_push_broadcast_deliveries(integer)
to service_role;
