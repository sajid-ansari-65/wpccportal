-- ============================================================================
-- Tenant isolation checks.
--
-- Impersonates real users inside a transaction and rolls back, so it is safe
-- to run against any environment, including production.
--
-- Every assertion raises on failure, so with ON_ERROR_STOP=1 the script exits
-- non-zero the moment something leaks. Run it at the end of every phase that
-- touches policies, and before every deploy.
--
--   psql "$DB" -v ON_ERROR_STOP=1 -f scripts/rls-check.sql
-- ============================================================================

\set QUIET on
\set ON_ERROR_STOP on

create or replace function pg_temp.expect(p_label text, p_actual bigint, p_expected bigint)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL  % — got %, expected %', p_label, p_actual, p_expected;
  end if;
  raise notice 'pass  % (%)', p_label, p_actual;
end;
$$;

-- For "this must be refused". A silent success is the dangerous outcome, so
-- the absence of an error is itself a failure.
--
-- It also fails when the statement touched NOTHING. A refusal test that passes
-- because its WHERE clause matched no rows proves nothing, and it passes
-- forever after the data drifts out from under it -- which is exactly what
-- happened here the day attendee names started being normalised on import.
create or replace function pg_temp.expect_denied(p_label text, p_sql text)
returns void language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'FAIL  % — nothing was attempted, so this proves nothing', p_label;
  end if;
  raise exception 'FAIL  % — the statement succeeded but should have been refused', p_label;
exception
  when insufficient_privilege or check_violation then
    raise notice 'pass  % (refused)', p_label;
end;
$$;

-- UPDATE and DELETE are the dangerous pair: an RLS `using` clause FILTERS them
-- rather than refusing them, so a forbidden update reports success and changes
-- nothing. Asserting "it raised" would pass for the wrong reason; assert the
-- row count instead. (INSERT differs: `with check` really does raise 42501.)
create or replace function pg_temp.expect_rows_affected(p_label text, p_sql text, p_expected bigint)
returns void language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n is distinct from p_expected then
    raise exception 'FAIL  % — affected % row(s), expected %', p_label, n, p_expected;
  end if;
  raise notice 'pass  % (% rows)', p_label, n;
exception
  when insufficient_privilege then
    if p_expected = 0 then
      raise notice 'pass  % (refused outright)', p_label;
    else
      raise;
    end if;
end;
$$;

\set QUIET off

-- ============================================================================
-- The second tenant, created here and rolled back at the end.
--
-- Proving that one organisation cannot see another's data needs two of them.
-- Keeping a permanent "Tripwire Org" in the database made every platform
-- screen show a fake tenant next to the real one, so it is built inside this
-- run instead and never survives it. Nothing below is committed.
-- ============================================================================
begin;

insert into portal.organizations (id, slug, name)
values ('99999999-9999-9999-9999-999999999999', 'tripwire-check', 'Tripwire (check only)');

-- The trigger on portal.events creates each default session.
insert into portal.events (id, org_id, name, slug, timezone)
values
  ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999',
   'Tripwire Event A', 'tripwire-a', 'Asia/Kolkata'),
  ('87878787-8787-8787-8787-878787878787', '99999999-9999-9999-9999-999999999999',
   'Tripwire Event B', 'tripwire-b', 'Asia/Kolkata');

insert into portal.attendees (id, event_id, org_id, name, email, qr_token)
values
  ('77777777-7777-7777-7777-777777777777', '88888888-8888-8888-8888-888888888888',
   '99999999-9999-9999-9999-999999999999', 'Tripwire One', 'one@tripwire.test',
   'tripwire-check-token-one'),
  ('76767676-7676-7676-7676-767676767676', '87878787-8787-8787-8787-878787878787',
   '99999999-9999-9999-9999-999999999999', 'Tripwire Two', 'two@tripwire.test',
   'tripwire-check-token-two');

insert into portal.memberships (org_id, user_id, role)
values ('99999999-9999-9999-9999-999999999999',
        'cccccccc-0000-0000-0000-00000000000c', 'owner');


-- Expected counts are captured here rather than written into the assertions.
-- Hardcoding "187" broke the script the moment a second college was imported,
-- and it would be wrong on every environment except a freshly seeded one --
-- including production, which is the environment this matters most in. What
-- is asserted is the SHAPE of what each role can see, not the size of the data.
select
  (select count(*) from portal.attendees where org_id = '11111111-1111-1111-1111-111111111111') as n_surat,
  (select count(*) from portal.attendees where org_id = '99999999-9999-9999-9999-999999999999') as n_tripwire,
  (select count(*) from portal.attendees) as n_all,
  (select count(*) from portal.events) as n_events,
  (select count(*) from portal.institutions where org_id = '11111111-1111-1111-1111-111111111111') as n_inst
\gset

-- Captured as superuser, before impersonating anyone. A platform admin cannot
-- SELECT an attendee, so looking one up inside their transaction would pass
-- NULL to the function and it would fail for the wrong reason — "no such
-- attendee" instead of "not permitted".
select a.id as att_id from portal.attendees a
 where a.org_id = '11111111-1111-1111-1111-111111111111' limit 1
\gset
select s.id as sess_id from portal.sessions s
 where s.event_id = '22222222-2222-2222-2222-222222222222' limit 1
\gset


-- ---------------------------------------------------------------------------
-- A volunteer on Surat's only event.
-- ---------------------------------------------------------------------------
savepoint role_block_1;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}';

  select pg_temp.expect('volunteer sees their own event''s attendees',
    (select count(*) from portal.attendees), :n_surat);

  -- Positive assertions matter as much as the negative ones. Every "cannot
  -- see" check below passes for a policy that denies everything, and that is
  -- exactly the bug that shipped once: volunteers could not see their own
  -- organisation, so their event 404'd before membership was ever checked.
  select pg_temp.expect('volunteer CAN see their organisation',
    (select count(*) from portal.organizations), 1);

  select pg_temp.expect('volunteer CAN see their event',
    (select count(*) from portal.events), 1);

  select pg_temp.expect('volunteer CAN see institutions, to label attendees',
    (select count(*) from portal.institutions), :n_inst);

  select pg_temp.expect('volunteer sees no tripwire attendees',
    (select count(*) from portal.attendees
      where org_id = '99999999-9999-9999-9999-999999999999'), 0);

  select pg_temp.expect('volunteer sees no tripwire events',
    (select count(*) from portal.events
      where org_id = '99999999-9999-9999-9999-999999999999'), 0);

  -- A volunteer must mark attendance without being able to edit anyone.
  -- Ids, not names. Import normalises names, so a literal here silently stops
  -- matching and the refusal test starts passing for the wrong reason.
  select pg_temp.expect_denied('volunteer cannot write attendance_records directly', format($q$
    insert into portal.attendance_records (attendee_id, session_id, event_id, org_id, marked_via)
    values (%L, %L, '22222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111', 'manual')
  $q$, :'att_id', :'sess_id'));

  select pg_temp.expect_rows_affected('volunteer cannot rename an attendee', format($q$
    update portal.attendees set name = 'Hacked' where id = %L
  $q$, :'att_id'), 0);

  select pg_temp.expect('...and the name really is untouched',
    (select count(*) from portal.attendees where id = :'att_id' and name <> 'Hacked'), 1);

  select pg_temp.expect_denied('volunteer cannot create an attendee', $q$
    insert into portal.attendees (event_id, org_id, name)
    values ('22222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111', 'Sneaky')
  $q$);

  -- But the RPC must work for their own event...
  select pg_temp.expect('volunteer CAN mark via the RPC',
    (select count(*) from portal.mark_attendance(
       :'att_id', :'sess_id', true, 'manual')), 1);

  -- ...and must not reach across the tenant boundary through it.
  select pg_temp.expect_denied('volunteer cannot mark a tripwire attendee', $q$
    select portal.mark_attendance('77777777-7777-7777-7777-777777777777',
      (select id from portal.sessions where event_id = '88888888-8888-8888-8888-888888888888'),
      true, 'manual')
  $q$);
rollback to savepoint role_block_1;

-- ---------------------------------------------------------------------------
-- The tripwire org's owner. Must see their own two attendees and nothing else.
-- ---------------------------------------------------------------------------
savepoint role_block_2;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}';

  select pg_temp.expect('tripwire owner sees only their own attendees',
    (select count(*) from portal.attendees), :n_tripwire);

  select pg_temp.expect('tripwire owner sees none of Surat''s attendees',
    (select count(*) from portal.attendees
      where org_id = '11111111-1111-1111-1111-111111111111'), 0);

  select pg_temp.expect('tripwire owner sees only their own events',
    (select count(*) from portal.events), 2);

  select pg_temp.expect('tripwire owner sees only their own organisation',
    (select count(*) from portal.organizations), 1);

  select pg_temp.expect_rows_affected('tripwire owner cannot touch Surat attendees', $q$
    update portal.attendees set name = 'Hacked'
     where org_id = '11111111-1111-1111-1111-111111111111'
  $q$, 0);
rollback to savepoint role_block_2;

-- ---------------------------------------------------------------------------
-- Surat's owner. Sees their org fully, and still nothing of the tripwire's.
-- ---------------------------------------------------------------------------
savepoint role_block_3;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}';

  select pg_temp.expect('org owner sees all their attendees',
    (select count(*) from portal.attendees), :n_surat);

  select pg_temp.expect('org owner sees no tripwire rows',
    (select count(*) from portal.attendees
      where org_id = '99999999-9999-9999-9999-999999999999'), 0);

  -- A form field carrying another tenant's event id must not reach their team.
  -- The application checks this too; this is the layer underneath, so the check
  -- above can never be the only thing standing there.
  select pg_temp.expect_rows_affected('org owner cannot remove another tenant''s volunteer', $q$
    delete from portal.event_members
     where event_id = '88888888-8888-8888-8888-888888888888'
  $q$, 0);

  select pg_temp.expect('org owner sees their own memberships',
    (select count(*) from portal.memberships), 1);

  -- Creating organisations is the platform operator's job, and so is removing
  -- them. An owner deleting their own would take every attendee with it.
  select pg_temp.expect_rows_affected('org owner cannot delete their organisation', $q$
    delete from portal.organizations where slug = 'wpcc-surat'
  $q$, 0);

  -- Rules no policy can express, enforced by the trigger.
  select pg_temp.expect_denied('owner cannot change their own membership', $q$
    update portal.memberships set role = 'admin'
     where user_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
  $q$);
rollback to savepoint role_block_3;

-- ---------------------------------------------------------------------------
-- A platform admin with no org membership.
--
-- The whole point of the privilege is that it stops at the tenant boundary:
-- they can set an organisation up and count what is in it, and cannot read
-- who is in it. owner@wpcc.test is deliberately NOT used here, because they
-- are also an org owner and would pass for the wrong reason.
-- ---------------------------------------------------------------------------
savepoint role_block_4;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-00000000000d","role":"authenticated"}';

  select pg_temp.expect('platform admin sees every organisation',
    (select count(*) from portal.organizations), 2);

  select pg_temp.expect('platform admin CANNOT read attendees',
    (select count(*) from portal.attendees), 0);

  select pg_temp.expect('platform admin CANNOT read attendance',
    (select count(*) from portal.attendance_records), 0);

  -- Setup work is open to them: they help a new organiser get going.
  select pg_temp.expect('platform admin CAN read events, to set them up',
    (select count(*) from portal.events), :n_events);

  select pg_temp.expect('platform admin CAN read institutions',
    (select count(*) from portal.institutions), :n_inst);

  -- The line is drawn at people, not at metadata. An event's name is the
  -- tenant's business; a student's email is the student's.
  select pg_temp.expect('platform admin STILL cannot read attendees',
    (select count(*) from portal.attendees), 0);

  -- By id. With a name literal this passes whether RLS works or not, because
  -- a WHERE that matches nothing affects zero rows either way.
  select pg_temp.expect_rows_affected('platform admin cannot edit an attendee', format($q$
    update portal.attendees set name = 'Hacked' where id = %L
  $q$, :'att_id'), 0);

  select pg_temp.expect_denied('platform admin cannot mark attendance', format($q$
    select portal.mark_attendance(%L, %L, true, 'manual')
  $q$, :'att_id', :'sess_id'));

  select pg_temp.expect('platform admin CAN see counts, via aggregates only',
    (select sum(attendees)::bigint from portal.platform_org_stats()), :n_all);

  select pg_temp.expect('platform admin cannot enumerate other platform admins',
    (select count(*) from portal.platform_admins), 1);
rollback to savepoint role_block_4;

-- ---------------------------------------------------------------------------
-- Signed out. Nothing at all.
-- ---------------------------------------------------------------------------
savepoint role_block_5;
  set local role anon;

  select pg_temp.expect_denied('anon cannot read attendees', $q$
    select count(*) from portal.attendees
  $q$);
rollback to savepoint role_block_5;

\echo ''
\echo 'All tenant isolation checks passed.'

-- Nothing here is kept: the second tenant existed only for the length of this
-- check.
rollback;
