-- OG Prints schema
-- Run with:  supabase db query --linked -f supabase/schema.sql
-- (or paste the whole file into the Supabase SQL editor). Safe to run again.
--
-- Everything lives in a dedicated `og_prints` schema so it cannot collide with
-- the other apps sharing this Supabase project (Bookworm, Giftly).
--
-- After running this, go to Settings -> API -> Exposed schemas and add
-- `og_prints`, otherwise PostgREST will refuse to serve these tables.

create schema if not exists og_prints;

-- ---------------------------------------------------------------------------
-- Space scoping
-- ---------------------------------------------------------------------------
-- There is no login. Every row belongs to a "space" (the family) whose id is an
-- unguessable UUID that lives in the family link. The app sends that id as an
-- `x-space-id` header on every request, and the policies below only ever return
-- or accept rows matching it. Someone who does not have the link cannot list,
-- read or write anything.

create or replace function og_prints.current_space_id()
returns uuid
language plpgsql
stable
as $$
declare
  raw text;
begin
  raw := nullif(current_setting('request.headers', true)::json ->> 'x-space-id', '');
  if raw is null then
    return null;
  end if;
  return raw::uuid;
exception
  when others then
    -- A malformed header must deny access, not raise an error.
    return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Unlike Bookworm and Giftly, the app cannot create a space: every drawing
-- spends money on the family's Gemini key, so a space is made by hand
-- (see README.md) and its link handed out privately.
create table if not exists og_prints.spaces (
  id           uuid primary key default gen_random_uuid(),
  name         text not null default 'OG Prints',
  -- Drawings a day, shared by everyone on the link. Resets at UK midnight.
  daily_limit  integer not null default 15 check (daily_limit between 1 and 50),
  -- The grown-ups' line added to every prompt; null means the built-in one.
  base_prompt  text check (base_prompt is null or char_length(base_prompt) <= 600),
  created_at   timestamptz not null default now()
);

-- Every picture ever made, so it can be found in the gallery and printed again.
-- `original_path` is what the AI drew; `print_path` is the 384-dot black and
-- white version the app made for the printer. Both are paths in the
-- og-prints-media bucket.
create table if not exists og_prints.pictures (
  id               uuid primary key default gen_random_uuid(),
  space_id         uuid not null references og_prints.spaces(id) on delete cascade,
  idea             text not null,
  style            text not null,
  shape            text not null,
  source           text not null default 'ai' check (source in ('ai', 'search')),
  source_url       text,
  model            text,
  original_path    text not null,
  print_path       text,
  width            integer,
  height           integer,
  print_count      integer not null default 0,
  last_printed_at  timestamptz,
  favourite        boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists pictures_space_idx on og_prints.pictures (space_id, created_at desc);

-- The daily limit, counted on the server. One row per space per UK day.
create table if not exists og_prints.days (
  space_id  uuid not null references og_prints.spaces(id) on delete cascade,
  day       date not null,
  used      integer not null default 0,
  bonus     integer not null default 0,
  primary key (space_id, day)
);

-- Each AI call with its estimated cost, so the function can stop at the
-- monthly budget.
create table if not exists og_prints.ai_usage (
  id             bigint generated always as identity primary key,
  space_id       uuid references og_prints.spaces(id) on delete set null,
  task           text not null,
  model          text not null,
  input_tokens   integer,
  output_tokens  integer,
  est_cost_gbp   numeric(10, 5) not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists ai_usage_created_idx on og_prints.ai_usage (created_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table og_prints.spaces   enable row level security;
alter table og_prints.pictures enable row level security;
alter table og_prints.days     enable row level security;
alter table og_prints.ai_usage enable row level security;

-- The app may read its own space and change the two grown-up settings.
drop policy if exists spaces_read on og_prints.spaces;
create policy spaces_read on og_prints.spaces
  for select to anon, authenticated
  using (id = og_prints.current_space_id());

drop policy if exists spaces_settings on og_prints.spaces;
create policy spaces_settings on og_prints.spaces
  for update to anon, authenticated
  using (id = og_prints.current_space_id())
  with check (id = og_prints.current_space_id());

-- Pictures are created by the og-prints function only. The app reads them and
-- fills in the print version, the print count and the favourite star.
drop policy if exists pictures_read on og_prints.pictures;
create policy pictures_read on og_prints.pictures
  for select to anon, authenticated
  using (space_id = og_prints.current_space_id());

drop policy if exists pictures_update on og_prints.pictures;
create policy pictures_update on og_prints.pictures
  for update to anon, authenticated
  using (space_id = og_prints.current_space_id())
  with check (space_id = og_prints.current_space_id());

-- days and ai_usage have no policies: only the function (service role) reads
-- or writes them, and RLS shuts everyone else out.

revoke all on all tables in schema og_prints from anon, authenticated;
grant usage on schema og_prints to anon, authenticated, service_role;
grant execute on function og_prints.current_space_id() to anon, authenticated;
grant select on og_prints.spaces, og_prints.pictures to anon, authenticated;
grant update (daily_limit, base_prompt) on og_prints.spaces to anon, authenticated;
grant update (print_path, width, height, print_count, last_printed_at, favourite)
  on og_prints.pictures to anon, authenticated;

grant select on og_prints.spaces to service_role;
grant select, insert on og_prints.pictures, og_prints.ai_usage to service_role;
grant select, insert, update on og_prints.days to service_role;

-- "Printed!" Counts a print of one picture. Runs as the caller, so the
-- policies above still decide which pictures it can touch.
create or replace function og_prints.mark_printed(picture_id uuid)
returns void
language sql
as $$
  update og_prints.pictures
     set print_count = print_count + 1, last_printed_at = now()
   where id = picture_id;
$$;

grant execute on function og_prints.mark_printed(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The daily limit (called by the og-prints function only)
-- ---------------------------------------------------------------------------

create or replace function og_prints.quota(p_space uuid, p_day date)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'limit', s.daily_limit,
    'used', coalesce(d.used, 0),
    'bonus', coalesce(d.bonus, 0),
    'left', greatest(0, s.daily_limit + coalesce(d.bonus, 0) - coalesce(d.used, 0)))
  from og_prints.spaces s
  left join og_prints.days d on d.space_id = s.id and d.day = p_day
  where s.id = p_space;
$$;

-- Takes one drawing from today's allowance, or none if it is used up. One
-- statement does the check and the count, so two phones drawing at once cannot
-- both take the last one. Returns the quota plus `ok`.
create or replace function og_prints.reserve_draw(p_space uuid, p_day date)
returns jsonb
language plpgsql
as $$
declare
  took boolean;
begin
  insert into og_prints.days (space_id, day) values (p_space, p_day)
    on conflict do nothing;
  update og_prints.days d
     set used = d.used + 1
    from og_prints.spaces s
   where d.space_id = p_space and d.day = p_day and s.id = p_space
     and d.used < s.daily_limit + d.bonus;
  took := found;
  return og_prints.quota(p_space, p_day) || jsonb_build_object('ok', took);
end;
$$;

-- Gives a drawing back when the AI call failed.
create or replace function og_prints.refund_draw(p_space uuid, p_day date)
returns jsonb
language plpgsql
as $$
begin
  update og_prints.days set used = greatest(0, used - 1)
   where space_id = p_space and day = p_day;
  return og_prints.quota(p_space, p_day);
end;
$$;

-- "Give 5 more today". Capped so the button cannot be leant on.
create or replace function og_prints.add_bonus(p_space uuid, p_day date, p_extra integer)
returns jsonb
language plpgsql
as $$
begin
  insert into og_prints.days (space_id, day, bonus) values (p_space, p_day, least(30, greatest(0, p_extra)))
    on conflict (space_id, day) do update set bonus = least(30, og_prints.days.bonus + greatest(0, p_extra));
  return og_prints.quota(p_space, p_day);
end;
$$;

revoke all on function og_prints.quota(uuid, date) from public, anon, authenticated;
revoke all on function og_prints.reserve_draw(uuid, date) from public, anon, authenticated;
revoke all on function og_prints.refund_draw(uuid, date) from public, anon, authenticated;
revoke all on function og_prints.add_bonus(uuid, date, integer) from public, anon, authenticated;
grant execute on function og_prints.quota(uuid, date) to service_role;
grant execute on function og_prints.reserve_draw(uuid, date) to service_role;
grant execute on function og_prints.refund_draw(uuid, date) to service_role;
grant execute on function og_prints.add_bonus(uuid, date, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Storage for the pictures
-- ---------------------------------------------------------------------------
-- Public bucket, unguessable paths: `<space id>/<picture id>.jpg` for what the
-- AI drew and `<space id>/<picture id>-print.png` for the printer version.
-- Reading needs the full path, which only the space's own picture rows hold
-- ("the link is the key", as in Bookworm). Uploads are limited to the folder
-- named by the x-space-id header. Nothing can be deleted or overwritten.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('og-prints-media', 'og-prints-media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "og prints media: space folder read" on storage.objects;
create policy "og prints media: space folder read" on storage.objects
  for select to anon
  using (
    bucket_id = 'og-prints-media'
    and (storage.foldername(name))[1] = og_prints.current_space_id()::text
  );

drop policy if exists "og prints media: space folder insert" on storage.objects;
create policy "og prints media: space folder insert" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'og-prints-media'
    and (storage.foldername(name))[1] = og_prints.current_space_id()::text
  );
