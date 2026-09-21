create table if not exists public.push_devices (
  id uuid primary key,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.push_reminders (
  id text not null,
  device_id uuid not null references public.push_devices(id) on delete cascade,
  due_at timestamptz not null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 240),
  url text not null check (url like '/%'),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  locked_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (id, device_id)
);

create index if not exists push_reminders_due_pending_idx
  on public.push_reminders (due_at)
  where status in ('pending', 'processing');

alter table public.push_devices enable row level security;
alter table public.push_reminders enable row level security;

revoke all on table public.push_devices from anon, authenticated;
revoke all on table public.push_reminders from anon, authenticated;

create or replace function public.replace_push_reminders(p_device_id uuid, p_reminders jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.push_devices where id = p_device_id and enabled) then
    raise exception 'unknown push device';
  end if;

  if jsonb_typeof(p_reminders) <> 'array' or jsonb_array_length(p_reminders) > 400 then
    raise exception 'invalid reminders payload';
  end if;

  delete from public.push_reminders where device_id = p_device_id and status <> 'sent';

  insert into public.push_reminders (id, device_id, due_at, title, body, url)
  select item.id, p_device_id, item.due_at, item.title, item.body, item.url
  from jsonb_to_recordset(p_reminders) as item(
    id text,
    due_at timestamptz,
    title text,
    body text,
    url text
  )
  where item.due_at >= now() - interval '10 minutes'
    and item.due_at <= now() + interval '370 days'
  on conflict (id, device_id) do update
    set due_at = excluded.due_at,
        title = excluded.title,
        body = excluded.body,
        url = excluded.url,
        status = case when public.push_reminders.status = 'sent' then 'sent' else 'pending' end,
        attempt_count = case when public.push_reminders.status = 'sent' then public.push_reminders.attempt_count else 0 end;

  update public.push_devices
  set last_seen_at = now(), updated_at = now()
  where id = p_device_id;
end;
$$;

revoke all on function public.replace_push_reminders(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_push_reminders(uuid, jsonb) to service_role;

create or replace function public.claim_due_push_reminders(p_limit integer default 100)
returns table (
  id text,
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
security definer
set search_path = public
as $$
begin
  delete from public.push_reminders
  where due_at < now() - interval '10 minutes';

  return query
  with candidates as (
    select reminder.id, reminder.device_id
    from public.push_reminders as reminder
    join public.push_devices as device on device.id = reminder.device_id
    where device.enabled
      and reminder.due_at <= now()
      and reminder.due_at >= now() - interval '10 minutes'
      and (
        reminder.status = 'pending'
        or (reminder.status = 'processing' and reminder.locked_at < now() - interval '5 minutes')
      )
      and reminder.attempt_count < 5
    order by reminder.due_at
    for update of reminder skip locked
    limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update public.push_reminders as reminder
    set status = 'processing',
        locked_at = now(),
        attempt_count = reminder.attempt_count + 1
    from candidates
    where reminder.id = candidates.id
      and reminder.device_id = candidates.device_id
    returning reminder.id, reminder.device_id, reminder.title, reminder.body,
      reminder.url, reminder.attempt_count
  )
  select claimed.id, claimed.device_id, claimed.title, claimed.body, claimed.url,
    claimed.attempt_count, device.endpoint, device.p256dh, device.auth
  from claimed
  join public.push_devices as device on device.id = claimed.device_id;
end;
$$;

revoke all on function public.claim_due_push_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_push_reminders(integer) to service_role;
