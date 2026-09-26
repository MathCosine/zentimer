-- pip — Supabase schema
-- Paste this into your project's SQL editor and run it. It is safe to run more
-- than once, and safe to run over the older single-document schema: the old
-- pip_state table is left exactly where it is, because the app migrates out of
-- it on first run and it is the way back if anything goes wrong.
--
-- One row per thing, rather than one document per person. Two devices editing
-- different tasks now both win; under the old shape whichever saved last
-- replaced the other outright.

-- ---------------------------------------------------------------------------
-- the stamp every row is ordered by
-- ---------------------------------------------------------------------------

-- Written by the server, never by the client. Devices disagree about the time,
-- sometimes by minutes, so a client-written stamp makes "last write wins" mean
-- "the device with the fastest clock wins". One clock decides.
create or replace function public.pip_stamp()
returns trigger language plpgsql as $$
begin
  new.updated = (extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- the tables
-- ---------------------------------------------------------------------------

create table if not exists public.lists (
  id         text  not null,
  user_id    uuid  not null default auth.uid() references auth.users (id) on delete cascade,
  name       text  not null default '',
  ord        int   not null default 0,
  updated    bigint not null default 0,
  deleted_at bigint,
  primary key (user_id, id)
);

create table if not exists public.tags (
  id         text  not null,
  user_id    uuid  not null default auth.uid() references auth.users (id) on delete cascade,
  name       text  not null default '',
  colour     text  not null default 'blue',
  updated    bigint not null default 0,
  deleted_at bigint,
  primary key (user_id, id)
);

create table if not exists public.tasks (
  id          text  not null,
  user_id     uuid  not null default auth.uid() references auth.users (id) on delete cascade,
  list_id     text,
  title       text  not null default '',
  tags        text[] not null default '{}',
  due         text,
  repeat      text  not null default 'none',
  weekday     int,
  at          int,                      -- minutes past midnight, or null
  mins        int   not null default 30,
  done        boolean not null default false,
  done_at     bigint,
  completions jsonb not null default '{}'::jsonb,
  skips       jsonb not null default '{}'::jsonb,
  ord         int   not null default 0,
  created     bigint,
  updated     bigint not null default 0,
  deleted_at  bigint,
  primary key (user_id, id)
);

-- start and end are reserved words, hence start_min / end_min
create table if not exists public.blocks (
  id         text  not null,
  user_id    uuid  not null default auth.uid() references auth.users (id) on delete cascade,
  date       text  not null default '',
  start_min  int   not null default 0,
  end_min    int   not null default 30,
  task_id    text,
  title      text  not null default '',
  done       boolean not null default false,
  ran_over   int   not null default 0,
  updated    bigint not null default 0,
  deleted_at bigint,
  primary key (user_id, id)
);

-- append only: a finished session is a fact, it is never edited
create table if not exists public.logs (
  id         text  not null,
  user_id    uuid  not null default auth.uid() references auth.users (id) on delete cascade,
  task_id    text,
  block_id   text,
  date       text  not null default '',
  ms         bigint not null default 0,
  at         bigint not null default 0,
  updated    bigint not null default 0,
  deleted_at bigint,
  primary key (user_id, id)
);

-- everything that is a preference rather than data: session lengths, the
-- break, when your day starts, the theme. One row, because these are only ever
-- edited in one place at a time and there is nothing to merge.
create table if not exists public.prefs (
  user_id  uuid   not null primary key default auth.uid() references auth.users (id) on delete cascade,
  data     jsonb  not null default '{}'::jsonb,
  migrated boolean not null default false,
  updated  bigint not null default 0
);

-- Columns added after the first release. Separate so that re-running this file
-- over an existing project adds them without touching anything else.
alter table public.tasks add column if not exists progress int not null default 0;

-- What a tag is for. 'work' is a subject with real deadlines; 'practice' is
-- something you do most days, where doing most of it is the point and no one
-- day is a deadline. `daily` is how many of its tasks count as a day's worth.
alter table public.tags add column if not exists kind text not null default 'work';
alter table public.tags add column if not exists daily int;

-- Which practice comes first when there is not time for all of it: 1 is first,
-- 2 next, null means mix it in with the rest.
alter table public.tags add column if not exists rank int;

-- ---------------------------------------------------------------------------
-- stamps, indexes and row security, applied to every table the same way
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['lists', 'tags', 'tasks', 'blocks', 'logs', 'prefs'] loop

    -- the server stamps every write
    execute format('drop trigger if exists pip_stamp on public.%I', t);
    execute format(
      'create trigger pip_stamp before insert or update on public.%I
         for each row execute function public.pip_stamp()', t);

    -- what a delta pull asks for: this account's rows, changed since last time
    execute format(
      'create index if not exists %I on public.%I (user_id, updated)', t || '_since', t);

    execute format('alter table public.%I enable row level security', t);

    -- an account can only ever see and touch its own rows
    execute format('drop policy if exists "pip owns its rows" on public.%I', t);
    execute format(
      'create policy "pip owns its rows" on public.%I
         for all to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);

  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- tombstones
-- ---------------------------------------------------------------------------

-- A deleted row is kept, marked, and swept up later. Deleting it outright
-- cannot be told apart from a row a device has not pulled yet, which is how
-- deleted things come back from the dead.
create or replace function public.pip_sweep(older_than_days int default 30)
returns void language plpgsql security invoker as $$
declare
  cutoff bigint := (extract(epoch from now()) * 1000)::bigint - (older_than_days::bigint * 86400000);
  t text;
begin
  foreach t in array array['lists', 'tags', 'tasks', 'blocks', 'logs'] loop
    execute format('delete from public.%I where deleted_at is not null and deleted_at < $1', t)
      using cutoff;
  end loop;
end $$;

-- Run it on a schedule if pg_cron is available, otherwise it is harmless to
-- call by hand now and then: select public.pip_sweep();

-- ---------------------------------------------------------------------------
-- realtime
-- ---------------------------------------------------------------------------

-- so a second device sees a change within a second rather than on next load
do $$
declare t text;
begin
  foreach t in array array['lists', 'tags', 'tasks', 'blocks', 'logs'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- deleting your account
-- ---------------------------------------------------------------------------

-- A signed-in person cannot reach auth.users from the browser, and should not
-- be able to. This deletes exactly one row -- their own -- and every table
-- above cascades from it.
create or replace function public.pip_delete_me()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.pip_delete_me() from public, anon;
grant execute on function public.pip_delete_me() to authenticated;
