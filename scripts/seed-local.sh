#!/usr/bin/env bash
#
# Rebuild the portal schema's data from the legacy archive.
#
# Idempotent on purpose: it wipes the portal data tables and rebuilds. The
# schema will churn for weeks and this will run dozens of times, so it is a
# script you re-run, not a migration you apply once.
#
# It never touches `public`. The archive CSV is a raw dump of public.students,
# taken with every column — notably qr_token, which the app's own CSV export
# omits and which 187 printed QR codes depend on.
#
#   ./scripts/seed-local.sh [path-to-archive.csv]
#
set -euo pipefail

CSV="${1:-$HOME/Documents/wpcc-archive/students-raw-20260921.csv}"
DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

[ -f "$CSV" ] || { echo "Archive not found: $CSV" >&2; exit 1; }

# The archive must carry qr_token. Without it the printed codes are orphaned,
# and the failure is silent months later rather than now.
# No pipe here on purpose: `head | grep -q` makes grep exit on the first match,
# head takes a SIGPIPE, and `set -o pipefail` reports the whole check as failed.
grep -q -m1 'qr_token' "$CSV" || {
  echo "ERROR: $CSV has no qr_token column." >&2
  echo "It looks like the app's Export CSV, which omits it. Use a raw table dump." >&2
  exit 1
}

echo "Seeding from $CSV"

# --- 1. Staging table -------------------------------------------------------
# Loaded as all-text and cast on the way in: a typed staging table would make
# COPY fail on the archive's own quirks instead of letting us see them.
#
# It is a real table, not a temp one, because \copy has to run in its own psql
# call: \copy does not interpolate psql variables (its argument parser predates
# them), and the database runs in Docker, so a server-side COPY cannot see a
# file on this machine. The path is therefore passed as a single shell-quoted
# argument, which is also the safest way to handle it.
psql "$DB" -v ON_ERROR_STOP=1 -q -c "
  drop table if exists portal._legacy_import;
  create table portal._legacy_import (
    id text, event_id text, name text, email text, phone text, college text,
    qr_token text, attended text, attended_at text, marked_via text,
    created_at text, attributes text, wp_username text
  );"

psql "$DB" -v ON_ERROR_STOP=1 -q \
  -c "\copy portal._legacy_import from '$CSV' with (format csv, header true)"

# --- 2. Rebuild -------------------------------------------------------------
# The heredoc is QUOTED. Nothing inside it is interpolated by the shell, so a
# backtick in a SQL comment stays a backtick instead of becoming a command.
# The one value the SQL needs is passed as a psql variable, not by expansion.
psql "$DB" -v ON_ERROR_STOP=1 -q <<'EOF'
begin;

truncate
  -- Keep this list in step with the schema. A table added later and forgotten
  -- here survives every reseed, which is how owner@wpcc.test silently stayed a
  -- platform admin after being removed from the seed.
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

-- ---------------------------------------------------------------------------
-- Tenant 1: the real Surat data
-- ---------------------------------------------------------------------------

insert into portal.organizations (id, slug, name)
values ('11111111-1111-1111-1111-111111111111', 'wpcc-surat', 'WordPress Campus Connect Surat');

insert into portal.events (id, org_id, name, slug, timezone, settings)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'WPCC Surat 2026', 'surat-2026', 'Asia/Kolkata',
  '{"collect_wp_username": true, "institution_label": "College"}'::jsonb
);

-- The default 'Main' session is created by a trigger on portal.events, so it
-- already exists by now. The seed looks it up rather than creating one, which
-- is also what proves the trigger fired.


-- Institutions, resolved case-insensitively. This dataset happens to hold a
-- single college, but the legacy column is free text and the next import will
-- not be so tidy.
insert into portal.institutions (org_id, name, short_name)
select distinct on (lower(trim(college)))
  '11111111-1111-1111-1111-111111111111',
  trim(college),
  -- These sheets put the university in brackets -- "J.P. Dawer Institute of
  -- Information Science and Technology (VNSGU)" -- and the bracketed part is
  -- what people actually say out loud. Fall back to the full name.
  coalesce(nullif((regexp_match(college, '\(([^)]+)\)'))[1], ''), trim(college))
from portal._legacy_import
where coalesce(trim(college), '') <> ''
order by lower(trim(college));

insert into portal.attendees (
  id, event_id, org_id, institution_id,
  name, email, phone, qr_token, attributes, wp_username, created_at
)
select
  l.id::uuid,
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  i.id,
  trim(l.name),
  nullif(lower(trim(l.email)), ''),
  nullif(trim(l.phone), ''),
  l.qr_token,
  coalesce(nullif(l.attributes, '')::jsonb, '{}'::jsonb),
  nullif(trim(l.wp_username), ''),
  coalesce(l.created_at::timestamptz, now())
from portal._legacy_import l
left join portal.institutions i
  on i.org_id = '11111111-1111-1111-1111-111111111111'
 and lower(i.name) = lower(trim(l.college));

-- Attendance comes from `attended` and ONLY from `attended`.
--
-- The archive holds one row where attended = 'f' but marked_via = 'manual' —
-- someone was marked and then un-marked, and marked_via was never cleared.
-- Keying off "has a marked_via" would produce 133 records instead of 132, and
-- a one-row discrepancy is exactly the kind nobody ever notices.
insert into portal.attendance_records (
  attendee_id, session_id, event_id, org_id, marked_at, marked_via
)
select
  l.id::uuid,
  (select s.id from portal.sessions s
    where s.event_id = '22222222-2222-2222-2222-222222222222' and s.is_default),
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  coalesce(l.attended_at::timestamptz, l.created_at::timestamptz, now()),
  'import'
from portal._legacy_import l
where l.attended in ('t', 'true', 'TRUE');

-- The second tenant used to live here permanently, which meant a fake
-- organisation sat next to the real one on every platform screen. It is now
-- built and discarded inside scripts/rls-check.sql instead, so it never
-- exists outside the length of that check.

-- ---------------------------------------------------------------------------
-- Local test users.
--
-- Created directly in auth.users so a database reset plus this seed gives working
-- logins with no manual clicking. Local only: the password is a constant and
-- these addresses are .test, which can never resolve.
--
-- The identities row is what makes password sign-in work; without it GoTrue
-- accepts the user as existing but refuses the password.
-- ---------------------------------------------------------------------------

create or replace function pg_temp.make_user(p_id uuid, p_email text) returns void
language plpgsql as $fn$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token
  ) values (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, extensions.crypt('wpcc-local-dev', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    -- GoTrue scans these as plain strings, not nullable ones. Leaving them at
    -- their NULL default makes every sign-in fail with
    --   "Scan error ... converting NULL to string is unsupported"
    -- which surfaces as a 500 "Database error querying schema" and looks
    -- nothing like the empty columns that actually caused it.
    '', '', '', '', '', '', ''
  ) on conflict (id) do update set
       email              = excluded.email,
       encrypted_password = excluded.encrypted_password,
       -- Re-set on conflict too. The seed truncates the portal tables but not
       -- auth.users, so a user created by an earlier run keeps whatever these
       -- were then, and updating only the email leaves the NULLs in place.
       confirmation_token         = '',
       recovery_token             = '',
       email_change               = '',
       email_change_token_new     = '',
       email_change_token_current = '',
       phone_change               = '',
       phone_change_token         = '';

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), p_id, p_id::text,
    jsonb_build_object('sub', p_id::text, 'email', p_email),
    'email', now(), now(), now()
  ) on conflict (provider, provider_id) do nothing;
end;
$fn$;

select pg_temp.make_user('aaaaaaaa-0000-0000-0000-00000000000a', 'owner@wpcc.test');
select pg_temp.make_user('bbbbbbbb-0000-0000-0000-00000000000b', 'volunteer@wpcc.test');
-- Owns the second tenant, but only inside scripts/rls-check.sql, which
-- creates that organisation and rolls it back.
select pg_temp.make_user('cccccccc-0000-0000-0000-00000000000c', 'outsider@tripwire.test');
-- A platform admin with NO org membership. Exists so the boundary can actually
-- be tested: owner@wpcc.test is both, so checking against them proves nothing.
select pg_temp.make_user('dddddddd-0000-0000-0000-00000000000d', 'platform@wpcc.test');

-- The platform operator. Deliberately a separate grant from any org role:
-- being able to create organisations is not the same as being able to read
-- what is inside them.
-- Only platform@wpcc.test. owner@wpcc.test is deliberately NOT one: mixing the
-- two roles into one account makes every check ambiguous — it would pass the
-- org tests through the platform grant and the platform tests through the org
-- membership, proving neither.
insert into portal.platform_admins (user_id, note)
values ('dddddddd-0000-0000-0000-00000000000d', 'local development platform operator');

-- owner of the Surat org; reaches every event in it
insert into portal.memberships (org_id, user_id, role)
values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-00000000000a', 'owner');

-- volunteer on ONE event; must not see the rest of the org
insert into portal.event_members (event_id, user_id, org_id, role)
values ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-00000000000b',
        '11111111-1111-1111-1111-111111111111', 'volunteer');

drop table portal._legacy_import;

commit;
EOF

echo
echo "=== gates ==="
psql "$DB" -q -v ON_ERROR_STOP=1 <<'EOF'
\pset border 2
select
  (select count(*) from portal.attendees where org_id = '11111111-1111-1111-1111-111111111111')       as attendees,
  (select count(*) from portal.attendance_records where org_id = '11111111-1111-1111-1111-111111111111') as attended,
  (select count(distinct qr_token) from portal.attendees)                                              as distinct_tokens,
  (select count(*) from portal.attendees where event_id is null or org_id is null)                     as null_scope,
  (select count(*) from portal.institutions)                                                           as institutions;
EOF
