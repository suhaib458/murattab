alter table public.push_reminders
  drop constraint if exists push_reminders_url_local_path_check;

alter table public.push_reminders
  add constraint push_reminders_url_local_path_check
  check (url not like '//%' and position(E'\\' in url) = 0);

alter table public.push_broadcasts
  drop constraint if exists push_broadcasts_url_local_path_check;

alter table public.push_broadcasts
  add constraint push_broadcasts_url_local_path_check
  check (url not like '//%' and position(E'\\' in url) = 0);
