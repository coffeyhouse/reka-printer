-- Checks that a phone can only reach its own space, and that the daily limit
-- counts properly. Everything happens inside one transaction that is rolled
-- back, so it leaves nothing behind and is safe to run on the real project:
--
--   supabase db query --linked -f supabase/tests/rls.sql
--
-- It stops at the first failed check. Reaching "all checks passed" means it is fine.

begin;

insert into og_prints.spaces (id, daily_limit) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 2),
  ('bbbbbbbb-0000-4000-8000-000000000002', 15);
insert into og_prints.pictures (id, space_id, idea, style, shape, original_path) values
  ('aaaaaaaa-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'a dragon', 'colour', 'tall', 'a/a1.jpg'),
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000002', 'a cat', 'colour', 'tall', 'b/b1.jpg');

-- Runs a statement that must be refused, as the current role.
create function pg_temp.refused(statement text) returns boolean language plpgsql as $$
begin
  execute statement;
  return false;
exception
  when insufficient_privilege or check_violation then
    return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- A phone without the link
-- ---------------------------------------------------------------------------
set local role anon;

select set_config('request.headers', '{}', true);
do $$ begin
  assert (select count(*) from og_prints.spaces) = 0, 'no header: can see spaces';
  assert (select count(*) from og_prints.pictures) = 0, 'no header: can see pictures';
end $$;

select set_config('request.headers', '{"x-space-id":"not-a-uuid"}', true);
do $$ begin
  assert (select count(*) from og_prints.spaces) = 0, 'bad header: can see spaces';
  assert (select count(*) from og_prints.pictures) = 0, 'bad header: can see pictures';
end $$;

-- ---------------------------------------------------------------------------
-- A phone with space A's link
-- ---------------------------------------------------------------------------
select set_config('request.headers', '{"x-space-id":"aaaaaaaa-0000-4000-8000-000000000001"}', true);
do $$
declare
  n integer;
begin
  assert (select array_agg(id::text) from og_prints.spaces) = array['aaaaaaaa-0000-4000-8000-000000000001'], 'A sees other spaces';
  assert (select array_agg(idea) from og_prints.pictures) = array['a dragon'], 'A sees other pictures';

  -- It may fill in the print details of its own pictures, and nothing else.
  update og_prints.pictures set favourite = true, print_path = 'a/a1-print.png', width = 384, height = 683;
  get diagnostics n = row_count;
  assert n = 1, 'A updated ' || n || ' pictures';
  assert pg_temp.refused($q$update og_prints.pictures set idea = 'changed'$q$), 'A can rewrite an idea';
  assert pg_temp.refused($q$update og_prints.pictures set original_path = 'b/b1.jpg'$q$), 'A can repoint a picture';
  assert pg_temp.refused($q$update og_prints.pictures set space_id = 'bbbbbbbb-0000-4000-8000-000000000002'$q$), 'A can move a picture';
  assert pg_temp.refused($q$insert into og_prints.pictures (space_id, idea, style, shape, original_path) values ('aaaaaaaa-0000-4000-8000-000000000001', 'x', 'colour', 'tall', 'x')$q$), 'A can insert pictures';
  assert pg_temp.refused($q$delete from og_prints.pictures$q$), 'A can delete pictures';

  -- Printing counts on its own pictures only.
  perform og_prints.mark_printed('aaaaaaaa-0000-4000-8000-0000000000a1');
  perform og_prints.mark_printed('bbbbbbbb-0000-4000-8000-0000000000b1');
  assert (select print_count from og_prints.pictures) = 1, 'mark_printed did not count';

  -- The two grown-up settings, within bounds, on its own space.
  update og_prints.spaces set daily_limit = 3, base_prompt = 'Friendly.';
  get diagnostics n = row_count;
  assert n = 1, 'A updated ' || n || ' spaces';
  assert pg_temp.refused($q$update og_prints.spaces set daily_limit = 500$q$), 'A can set a huge limit';
  assert pg_temp.refused($q$update og_prints.spaces set name = 'changed'$q$), 'A can rename the space';
  assert pg_temp.refused($q$insert into og_prints.spaces default values$q$), 'A can make a space';
  assert pg_temp.refused($q$delete from og_prints.spaces$q$), 'A can delete a space';

  -- The limit and the spending log are out of reach.
  assert pg_temp.refused($q$select * from og_prints.days$q$), 'A can read days';
  assert pg_temp.refused($q$update og_prints.days set used = 0$q$), 'A can reset days';
  assert pg_temp.refused($q$select * from og_prints.ai_usage$q$), 'A can read ai_usage';
  assert pg_temp.refused($q$select og_prints.reserve_draw('aaaaaaaa-0000-4000-8000-000000000001', current_date)$q$), 'A can call reserve_draw';
  assert pg_temp.refused($q$select og_prints.refund_draw('aaaaaaaa-0000-4000-8000-000000000001', current_date)$q$), 'A can call refund_draw';
  assert pg_temp.refused($q$select og_prints.add_bonus('aaaaaaaa-0000-4000-8000-000000000001', current_date, 5)$q$), 'A can call add_bonus';
  assert pg_temp.refused($q$select og_prints.quota('aaaaaaaa-0000-4000-8000-000000000001', current_date)$q$), 'A can call quota';

  -- Uploads go in its own folder only.
  insert into storage.objects (bucket_id, name) values ('og-prints-media', 'aaaaaaaa-0000-4000-8000-000000000001/a1-print.png');
  assert pg_temp.refused($q$insert into storage.objects (bucket_id, name) values ('og-prints-media', 'bbbbbbbb-0000-4000-8000-000000000002/sneaky.png')$q$), 'A can upload into B';
  assert (select count(*) from storage.objects where bucket_id = 'og-prints-media') = 1, 'A can list other folders';
end $$;

-- B's rows were never touched.
reset role;
do $$ begin
  assert (select print_count = 0 and not favourite from og_prints.pictures where id = 'bbbbbbbb-0000-4000-8000-0000000000b1'), 'B picture was changed';
  assert (select daily_limit from og_prints.spaces where id = 'bbbbbbbb-0000-4000-8000-000000000002') = 15, 'B space was changed';
end $$;

-- ---------------------------------------------------------------------------
-- The daily limit, as the og-prints function uses it
-- ---------------------------------------------------------------------------
update og_prints.spaces set daily_limit = 2 where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set local role service_role;
do $$
declare
  a constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  d constant date := '2026-01-01';
  q jsonb;
begin
  assert og_prints.quota(a, d) = '{"limit":2,"used":0,"bonus":0,"left":2}', 'fresh day';
  q := og_prints.reserve_draw(a, d);
  assert (q ->> 'ok')::boolean and (q ->> 'left')::int = 1, 'first drawing';
  q := og_prints.reserve_draw(a, d);
  assert (q ->> 'ok')::boolean and (q ->> 'left')::int = 0, 'second drawing';
  q := og_prints.reserve_draw(a, d);
  assert not (q ->> 'ok')::boolean and (q ->> 'used')::int = 2, 'third drawing was allowed';
  q := og_prints.refund_draw(a, d);
  assert (q ->> 'used')::int = 1 and (q ->> 'left')::int = 1, 'refund';
  q := og_prints.add_bonus(a, d, 5);
  assert (q ->> 'bonus')::int = 5 and (q ->> 'left')::int = 6, 'bonus';
  q := og_prints.add_bonus(a, d, 500);
  assert (q ->> 'bonus')::int = 30, 'bonus is not capped';
  -- A new day starts from nothing.
  assert og_prints.quota(a, d + 1) = '{"limit":2,"used":0,"bonus":0,"left":2}', 'next day';
end $$;
reset role;

select 'all checks passed' as result;

rollback;
