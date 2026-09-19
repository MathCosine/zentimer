-- pip — Supabase schema
-- Paste this into your project's SQL editor and run it once.
--
-- The whole plan (lists, tags, tasks, blocks, logs) is kept as one JSON
-- document per user. That keeps the schema still while the app's shape is
-- still moving, and it is plenty for a single person's planner. Sync is
-- last-write-wins on `updated`: if two devices edit at the same moment, the
-- later save wins outright.

create table if not exists public.pip_state (
  id       text  not null,
  user_id  uuid  not null default auth.uid() references auth.users (id) on delete cascade,
  data     jsonb not null,
  updated  bigint not null default 0,
  saved_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.pip_state enable row level security;

-- each account can only ever see and touch its own row
drop policy if exists "pip owns its rows" on public.pip_state;
create policy "pip owns its rows"
  on public.pip_state
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- keep saved_at honest
create or replace function public.pip_touch()
returns trigger language plpgsql as $$
begin
  new.saved_at = now();
  return new;
end $$;

drop trigger if exists pip_touch on public.pip_state;
create trigger pip_touch before insert or update on public.pip_state
  for each row execute function public.pip_touch();
