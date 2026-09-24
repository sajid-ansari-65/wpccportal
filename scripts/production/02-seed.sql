-- ============================================================================
-- Production seed: copy the live event into the new schema.
--
-- Reads public.students. Never writes to it. That read-only discipline is what
-- makes a Vercel rollback a COMPLETE rollback — the old app comes back to find
-- its data exactly as it left it.
--
-- Re-runnable: it clears the portal tables and rebuilds. It does not touch
-- auth.users, so your login survives.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- BEFORE RUNNING: the owner's email is on the set_config line below. The
-- account must already exist (Supabase → Authentication → Add user).
--
-- Runs as-is in the Supabase SQL Editor or in psql. An earlier version used
-- a psql-only variable here, which the SQL Editor rejects as a syntax error.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- Handed to the DO block through a transaction-local setting, because a DO
-- block cannot take parameters.
select set_config('seed.owner_email', 'admin@iamsajidansari.com', true);

do $$
declare
  v_owner uuid;
  v_org   uuid := '11111111-1111-1111-1111-111111111111';
  v_event uuid := '22222222-2222-2222-2222-222222222222';
  v_sess  uuid;
  n_people integer;
  n_present integer;
begin
  select id into v_owner from auth.users
   where lower(email) = lower(current_setting('seed.owner_email'));
  if v_owner is null then
    raise exception
      'No account for %. Create it in Supabase -> Authentication -> Add user, then re-run.',
      current_setting('seed.owner_email');
  end if;

  -- Rebuild from scratch. platform_admins is included because a table left out
  -- of a truncate list survives every re-run, which is how a removed admin
  -- quietly stays an admin.
  truncate
    portal.platform_admins,
    portal.attendance_records,
    portal.attendees,
    portal.sessions,
    portal.event_members,
    portal.event_stations,
    portal.invitations,
    portal.institutions,
    portal.events,
    portal.memberships,
    portal.organizations
    restart identity cascade;

  insert into portal.organizations (id, slug, name, created_by)
  values (v_org, 'wpcc-surat', 'WordPress Campus Connect Surat', v_owner);

  insert into portal.memberships (org_id, user_id, role) values (v_org, v_owner, 'owner');
  insert into portal.platform_admins (user_id, note) values (v_owner, 'operator');

  -- A trigger on portal.events creates the default 'Main' session, so the
  -- event is never left in a state where nobody can be marked present.
  insert into portal.events (id, org_id, name, slug, timezone, settings, created_by)
  values (
    v_event, v_org, 'WPCC Surat 2026', 'surat-2026', 'Asia/Kolkata',
    '{"collect_wp_username": true, "institution_label": "College"}'::jsonb,
    v_owner
  );

  select s.id into v_sess
    from portal.sessions s where s.event_id = v_event and s.is_default;

  -- Colleges, resolved case-insensitively. The bracketed part of these names
  -- is what people actually say out loud, so it becomes the short name.
  insert into portal.institutions (org_id, name, short_name)
  select distinct on (lower(trim(college)))
    v_org,
    trim(college),
    coalesce(nullif((regexp_match(college, '\(([^)]+)\)'))[1], ''), trim(college))
  from public.students
  where coalesce(trim(college), '') <> ''
  order by lower(trim(college));

  -- qr_token is copied VERBATIM. Every printed and emailed QR code resolves
  -- through it, and the path /checkin/<token> does not change, so those codes
  -- keep working after the cutover. Regenerating them would orphan the lot.
  insert into portal.attendees (
    id, event_id, org_id, institution_id,
    name, email, phone, qr_token, attributes, wp_username,
    consent_source, created_at
  )
  select
    s.id, v_event, v_org, i.id,
    trim(s.name),
    nullif(lower(trim(s.email)), ''),
    nullif(trim(s.phone), ''),
    s.qr_token,
    coalesce(s.attributes, '{}'::jsonb),
    nullif(trim(s.wp_username), ''),
    'legacy-import',
    coalesce(s.created_at, now())
  from public.students s
  left join portal.institutions i
    on i.org_id = v_org and lower(i.name) = lower(trim(s.college));

  -- Attendance comes from `attended` and ONLY from `attended`. The legacy data
  -- holds rows where attended = false but marked_via is still set, because
  -- un-marking never cleared it. Keying off marked_via inflates the count.
  insert into portal.attendance_records (
    attendee_id, session_id, event_id, org_id, marked_at, marked_via
  )
  select s.id, v_sess, v_event, v_org,
         coalesce(s.attended_at, s.created_at, now()), 'import'
  from public.students s
  where s.attended;

  select count(*) into n_people  from portal.attendees where event_id = v_event;
  select count(*) into n_present from portal.attendance_records where event_id = v_event;
  raise notice 'Copied % attendees, % marked present.', n_people, n_present;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────────
-- Gates. Every number on the left must match the one on the right.
-- ─────────────────────────────────────────────────────────────────────────────
select
  (select count(*) from portal.attendees)                             as copied,
  (select count(*) from public.students)                              as legacy_total,
  (select count(*) from portal.attendance_records where revoked_at is null) as present,
  (select count(*) from public.students where attended)               as legacy_present,
  (select count(distinct qr_token) from portal.attendees)             as distinct_tokens,
  (select count(*) from portal.attendees where qr_token is null or qr_token = '') as blank_tokens,
  (select count(*) from portal.attendees a
     where not exists (select 1 from public.students s where s.qr_token = a.qr_token)) as tokens_not_matching_legacy;
