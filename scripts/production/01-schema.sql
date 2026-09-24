-- ============================================================================
-- Production schema: every migration, in order, as one file.
--
-- Generated from supabase/migrations/ on 2026-09-24.
-- Safe to run once. Running it twice fails on the first CREATE TABLE, which
-- is the correct behaviour: it means the schema is already there.
--
-- It creates ONLY the portal and app schemas. It does not read, alter or
-- touch public.students or public.events in any way.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- 20260921082851_portal_schema.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- portal schema: the multi-tenant rewrite.
--
-- Everything new lives here. Nothing in `public` is ever altered — the legacy
-- single-event app keeps its tables exactly as they are, which is what makes a
-- rollback of the cutover deploy a complete rollback rather than a cosmetic
-- one.
--
-- `public.events` already exists (unused, zero rows), so the new `events`
-- table would collide on name. A separate schema makes the boundary
-- mechanical rather than a naming convention.
-- ============================================================================

create schema if not exists portal;

-- Supabase's bootstrap grants apply to `public` only; a new schema starts with
-- nothing, and the resulting 401s read like an auth bug rather than a missing
-- grant.
grant usage on schema portal to anon, authenticated, service_role;

alter default privileges in schema portal
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema portal
  grant usage, select on sequences to authenticated, service_role;

-- `anon` deliberately gets no table privileges. The one anonymous surface
-- (public check-in) goes through a SECURITY DEFINER function, not table access.


-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table portal.organizations (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text not null unique,
  name                     text not null,
  plan                     text not null default 'beta',
  max_attendees_per_event  integer,          -- recorded, not enforced, in v1
  created_by               uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now()
);

-- Org-level staff only. Volunteers are scoped to a single event and live in
-- event_members, rather than being a nullable event_id on this table: two
-- tables with clear meanings beat one table with a discriminator that every
-- policy has to reason about.
create table portal.memberships (
  org_id     uuid not null references portal.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table portal.institutions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references portal.organizations(id) on delete cascade,
  name        text not null,
  short_name  text,
  -- Import creates "VNSGU", "V.N.S.G.U." and "vnsgu" from free text. Merging
  -- points the loser here and repoints its attendees; the row stays for audit
  -- and is filtered out of every picker.
  merged_into uuid references portal.institutions(id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index institutions_org_name_uniq
  on portal.institutions (org_id, lower(name));
create index institutions_org_idx on portal.institutions (org_id);


-- ---------------------------------------------------------------------------
-- Events and sessions
-- ---------------------------------------------------------------------------

create table portal.events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references portal.organizations(id) on delete cascade,
  name        text not null,
  slug        text not null,
  -- v1 reads two keys: collect_wp_username (bool), institution_label (text).
  -- The column is the cheap hook for generalising later.
  settings    jsonb not null default '{}'::jsonb,
  -- Session windows are meaningless without this. An admin typing "10:00"
  -- means 10:00 at the venue, not wherever their laptop thinks it is.
  timezone    text not null default 'Asia/Kolkata',
  archived_at timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (org_id, slug),
  -- Target for the composite FK below, so a child row can never point at an
  -- event belonging to a different org.
  unique (id, org_id)
);

create index events_org_idx on portal.events (org_id);

create table portal.sessions (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references portal.events(id) on delete cascade,
  org_id             uuid not null references portal.organizations(id) on delete cascade,
  name               text not null,
  position           integer not null default 0,
  starts_at          timestamptz,
  ends_at            timestamptz,
  checkin_opens_at   timestamptz,
  checkin_closes_at  timestamptz,
  -- Every event gets exactly one of these, created with it. The UI hides all
  -- session concepts until a second session exists.
  is_default         boolean not null default false,
  created_at         timestamptz not null default now(),
  foreign key (event_id, org_id) references portal.events (id, org_id)
);

create unique index sessions_event_name_uniq
  on portal.sessions (event_id, lower(name));
create unique index sessions_one_default_per_event
  on portal.sessions (event_id) where is_default;
create index sessions_event_idx on portal.sessions (event_id);


-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- A volunteer sees ONE event, not the whole org.
create table portal.event_members (
  event_id   uuid not null references portal.events(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null references portal.organizations(id) on delete cascade,
  role       text not null check (role in ('volunteer')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id),
  foreign key (event_id, org_id) references portal.events (id, org_id)
);

create index event_members_user_idx on portal.event_members (user_id);

create table portal.attendees (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references portal.events(id) on delete cascade,
  org_id         uuid not null references portal.organizations(id) on delete cascade,
  institution_id uuid references portal.institutions(id) on delete set null,
  name           text not null,
  email          text,
  phone          text,
  -- Globally unique and never scoped per event, because /checkin/<token>
  -- carries no event segment and those codes are printed. Do not "tidy" this
  -- into a composite key.
  qr_token       text not null unique default encode(gen_random_bytes(12), 'hex'),
  attributes     jsonb not null default '{}'::jsonb,
  wp_username    text,

  -- DPDP Act 2025: recorded from the start even though nothing reads them yet.
  -- Free to add while the table is being created; a migration plus a backfill
  -- decision afterwards.
  consent_source  text,
  consent_at      timestamptz,
  retention_until date,

  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  foreign key (event_id, org_id) references portal.events (id, org_id)
);

create unique index attendees_event_email_uniq
  on portal.attendees (event_id, lower(email)) where email is not null;
create index attendees_event_idx on portal.attendees (event_id);
create index attendees_institution_idx on portal.attendees (institution_id);
create index attendees_name_trgm_idx
  on portal.attendees using gin (to_tsvector('simple', name));


-- ---------------------------------------------------------------------------
-- Attendance: a row per session, never a boolean
-- ---------------------------------------------------------------------------
-- Multi-day events work without a second data model; offline replay is
-- naturally idempotent against the partial unique index below; and un-marking
-- is a soft revoke, so a disputed mark has a trail.

create table portal.attendance_records (
  id          uuid primary key default gen_random_uuid(),
  attendee_id uuid not null references portal.attendees(id) on delete cascade,
  session_id  uuid not null references portal.sessions(id) on delete cascade,
  event_id    uuid not null references portal.events(id) on delete cascade,
  org_id      uuid not null references portal.organizations(id) on delete cascade,
  marked_at   timestamptz not null default now(),
  marked_via  text not null check (marked_via in ('manual', 'qr', 'station', 'import')),
  marked_by   uuid references auth.users(id) on delete set null,
  station_id  uuid,
  -- Idempotency key for offline replay: the client generates it once and
  -- reuses it on every retry.
  client_id   uuid,
  revoked_at  timestamptz,
  revoked_by  uuid references auth.users(id) on delete set null,
  foreign key (event_id, org_id) references portal.events (id, org_id)
);

-- One live mark per person per session. A replayed queue entry is a no-op,
-- not a duplicate.
create unique index attendance_live_uniq
  on portal.attendance_records (attendee_id, session_id) where revoked_at is null;
create unique index attendance_client_id_uniq
  on portal.attendance_records (client_id) where client_id is not null;
create index attendance_session_idx on portal.attendance_records (session_id);
create index attendance_event_idx on portal.attendance_records (event_id);


-- ---------------------------------------------------------------------------
-- Joining and shared devices
-- ---------------------------------------------------------------------------

create table portal.invitations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references portal.organizations(id) on delete cascade,
  -- Null for an org-level invite (owner/admin); set for a volunteer invite.
  event_id   uuid references portal.events(id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'volunteer')),
  token      text not null unique default encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz,
  max_uses   integer not null default 1,
  used_count integer not null default 0,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- A volunteer invite must name an event; an org invite must not.
  check ((role = 'volunteer') = (event_id is not null))
);

-- A gate tablet holds a low-privilege, time-boxed, revocable capability rather
-- than an account — the same model as the attendee QR token.
create table portal.event_stations (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references portal.events(id) on delete cascade,
  org_id       uuid not null references portal.organizations(id) on delete cascade,
  token        text not null unique default encode(gen_random_bytes(24), 'hex'),
  label        text not null,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (event_id, org_id) references portal.events (id, org_id)
);

alter table portal.attendance_records
  add constraint attendance_station_fk
  foreign key (station_id) references portal.event_stations(id) on delete set null;


-- ---------------------------------------------------------------------------
-- RLS on from the first migration.
--
-- With RLS enabled and no policies yet, these tables are reachable only by
-- service_role. That is the correct state until Supabase Auth exists: the
-- default is deny, and each policy is then an explicit, reviewable decision
-- rather than a gap someone has to remember to close.
-- ---------------------------------------------------------------------------

alter table portal.organizations      enable row level security;
alter table portal.memberships        enable row level security;
alter table portal.event_members      enable row level security;
alter table portal.institutions       enable row level security;
alter table portal.events             enable row level security;
alter table portal.sessions           enable row level security;
alter table portal.attendees          enable row level security;
alter table portal.attendance_records enable row level security;
alter table portal.invitations        enable row level security;
alter table portal.event_stations     enable row level security;


-- ─────────────────────────────────────────────────────────────────────────
-- 20260921090000_rls_helpers.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- RLS helper functions.
--
-- These live in `app`, which is deliberately NOT added to the Data API's
-- exposed schemas: they are called from inside policies, never over the wire.
-- `portal` holds the tables and the API-callable RPCs; `app` holds only this.
--
-- They exist to break policy recursion. A policy on `organizations` that
-- checks `memberships` would trigger the policy on `memberships`, which checks
-- `organizations`, and so on. A SECURITY DEFINER function runs as its owner,
-- who bypasses RLS, so the inner read is not itself policed.
--
-- Corollary that must never be undone: DO NOT enable `force row level
-- security` on portal.memberships. Forcing RLS on the owner is exactly what
-- would reintroduce the recursion these functions exist to prevent.
-- ============================================================================

create schema if not exists app;

-- Callable from policies, invisible to the API.
grant usage on schema app to authenticated;
revoke all on schema app from anon;

-- `search_path = ''` plus fully qualified names: a SECURITY DEFINER function
-- that resolves names through a caller-controlled search_path is a privilege
-- escalation waiting to happen.

-- Set-returning, so the planner hoists it and runs it once per statement
-- rather than once per row. Use this form in SELECT policies.
create or replace function app.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from portal.memberships m where m.user_id = (select auth.uid())
$$;

-- Org staff reach every event in their org; a volunteer reaches exactly one.
create or replace function app.user_event_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
    from portal.events e
   where e.org_id in (
     select m.org_id from portal.memberships m where m.user_id = (select auth.uid())
   )
  union
  select em.event_id
    from portal.event_members em
   where em.user_id = (select auth.uid())
$$;

-- Boolean, evaluated per row. Fine for write policies, which touch few rows.
create or replace function app.has_org_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from portal.memberships m
     where m.org_id = p_org
       and m.user_id = (select auth.uid())
       and m.role = any(p_roles)
  )
$$;

grant execute on function app.user_org_ids()          to authenticated;
grant execute on function app.user_event_ids()        to authenticated;
grant execute on function app.has_org_role(uuid, text[]) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 20260921091000_rls_policies.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- RLS policies.
--
-- Shape, applied consistently:
--   SELECT  — scoped by app.user_org_ids() / app.user_event_ids()
--   WRITE   — org staff only, via app.has_org_role(...)
--
-- attendance_records deliberately has NO write policy. Volunteers must be able
-- to mark attendance without being able to edit attendees, and column-level
-- restriction in Postgres is `GRANT UPDATE (col)`, which is per database role
-- — every signed-in user is the same role `authenticated`, so a volunteer's
-- permissions cannot be expressed as a policy at all. All attendance writes
-- therefore go through the SECURITY DEFINER RPC, which checks the caller's
-- role itself. See 20260921092000_rpc_mark_attendance.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create policy org_select on portal.organizations
  for select to authenticated
  using (id in (select app.user_org_ids()));

create policy org_update on portal.organizations
  for update to authenticated
  using (app.has_org_role(id, array['owner', 'admin']))
  with check (app.has_org_role(id, array['owner', 'admin']));

-- No insert/delete policy: orgs are created by hand during the beta, and
-- deleting one is not something a web request should be able to do.

-- ---------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------
create policy membership_select on portal.memberships
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy membership_write on portal.memberships
  for all to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']))
  with check (app.has_org_role(org_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- event_members
-- ---------------------------------------------------------------------------
create policy event_member_select on portal.event_members
  for select to authenticated
  using (event_id in (select app.user_event_ids()));

create policy event_member_write on portal.event_members
  for all to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']))
  with check (app.has_org_role(org_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- institutions
-- ---------------------------------------------------------------------------
create policy institution_select on portal.institutions
  for select to authenticated
  using (org_id in (select app.user_org_ids()));

create policy institution_write on portal.institutions
  for all to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']))
  with check (app.has_org_role(org_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
-- Note user_event_ids(), not user_org_ids(): a volunteer must see the one
-- event they were invited to, and must not see the rest of the org's.
create policy event_select on portal.events
  for select to authenticated
  using (id in (select app.user_event_ids()));

create policy event_write on portal.events
  for all to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']))
  with check (app.has_org_role(org_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
create policy session_select on portal.sessions
  for select to authenticated
  using (event_id in (select app.user_event_ids()));

create policy session_write on portal.sessions
  for all to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']))
  with check (app.has_org_role(org_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- attendees
-- ---------------------------------------------------------------------------
create policy attendee_select on portal.attendees
  for select to authenticated
  using (event_id in (select app.user_event_ids()));

-- Org staff only. A volunteer registering a walk-in goes through
-- portal.register_walkin(), so that creating an attendee does not require
-- holding a general insert policy.
create policy attendee_write on portal.attendees
  for all to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']))
  with check (app.has_org_role(org_id, array['owner', 'admin']));

-- ---------------------------------------------------------------------------
-- attendance_records — SELECT only. See the header.
-- ---------------------------------------------------------------------------
create policy attendance_select on portal.attendance_records
  for select to authenticated
  using (event_id in (select app.user_event_ids()));

-- ---------------------------------------------------------------------------
-- invitations and event_stations — org staff only, both ways.
-- A volunteer never lists invitations; they arrive holding one.
-- ---------------------------------------------------------------------------
create policy invitation_select on portal.invitations
  for select to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']));

create policy invitation_write on portal.invitations
  for all to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']))
  with check (app.has_org_role(org_id, array['owner', 'admin']));

create policy station_select on portal.event_stations
  for select to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']));

create policy station_write on portal.event_stations
  for all to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']))
  with check (app.has_org_role(org_id, array['owner', 'admin']));


-- ============================================================================
-- Rules no policy can express.
--
-- A policy answers "may this row be written". It cannot see the row's previous
-- state, cannot count the other rows, and cannot tell that the writer is
-- editing themselves. Those three gaps are exactly the dangerous ones here.
-- ============================================================================

create or replace function portal.guard_membership_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role text;
  owners_left integer;
begin
  -- The seed and any service-role maintenance run without a JWT. Nothing to
  -- guard against there, and blocking it would make the seed unrunnable.
  if actor is null then
    return coalesce(new, old);
  end if;

  select m.role into actor_role
    from portal.memberships m
   where m.org_id = coalesce(new.org_id, old.org_id)
     and m.user_id = actor;

  -- Nobody edits their own membership. Without this, an admin can quietly
  -- promote themselves to owner, which defeats the role split entirely.
  if coalesce(new.user_id, old.user_id) = actor then
    raise exception 'You cannot change your own membership.'
      using errcode = '42501';
  end if;

  -- Only an owner may create or grant ownership.
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner' and actor_role <> 'owner' then
    raise exception 'Only an owner can grant ownership.'
      using errcode = '42501';
  end if;

  -- An org must keep at least one owner, or it becomes unadministrable and
  -- only a database hand-edit can recover it.
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner') then
    select count(*) into owners_left
      from portal.memberships m
     where m.org_id = old.org_id and m.role = 'owner' and m.user_id <> old.user_id;
    if owners_left = 0 then
      raise exception 'An organisation must keep at least one owner.'
        using errcode = '23514';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger guard_membership_changes
  before insert or update or delete on portal.memberships
  for each row execute function portal.guard_membership_changes();


-- ─────────────────────────────────────────────────────────────────────────
-- 20260921092000_rpc_mark_attendance.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- mark_attendance — the only way attendance is ever written.
--
-- A SECURITY DEFINER function bypasses RLS entirely, so the role check inside
-- it is the ONLY protection. Keep this surface tiny and review changes to it
-- the way you would review crypto.
--
-- It exists because a volunteer needs to mark attendance without being able to
-- edit attendees, and Postgres expresses column-level permission as
-- `GRANT UPDATE (col)` — which is per database role, while every signed-in
-- user shares the role `authenticated`. A policy cannot say "this person may
-- write attendance but not names".
-- ============================================================================

create or replace function portal.mark_attendance(
  p_attendee    uuid,
  p_session     uuid,
  p_present     boolean,
  p_marked_via  text default 'manual',
  p_wp_username text default null,
  p_station     uuid default null,
  p_client_id   uuid default null
)
returns portal.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor        uuid := (select auth.uid());
  v_event      uuid;
  v_org        uuid;
  v_is_staff   boolean := false;
  v_is_member  boolean := false;
  v_opens      timestamptz;
  v_closes     timestamptz;
  v_record     portal.attendance_records;
begin
  if p_marked_via not in ('manual', 'qr', 'station', 'import') then
    raise exception 'Unknown marked_via: %', p_marked_via using errcode = '22023';
  end if;

  select a.event_id, a.org_id into v_event, v_org
    from portal.attendees a where a.id = p_attendee;
  if v_event is null then
    raise exception 'No such attendee.' using errcode = 'P0002';
  end if;

  -- The session must belong to the attendee's event. Without this check a
  -- caller could mark someone into another tenant's session, which the FKs
  -- alone would happily allow.
  select s.checkin_opens_at, s.checkin_closes_at into v_opens, v_closes
    from portal.sessions s
   where s.id = p_session and s.event_id = v_event;
  if not found then
    raise exception 'Session does not belong to this attendee''s event.'
      using errcode = '42501';
  end if;

  v_is_staff := app.has_org_role(v_org, array['owner', 'admin']);
  v_is_member := exists (
    select 1 from portal.event_members em
     where em.event_id = v_event and em.user_id = actor
  );

  if not (v_is_staff or v_is_member) then
    raise exception 'You do not have access to this event.' using errcode = '42501';
  end if;

  -- Check-in windows bind volunteers, not org staff. A closed window is the
  -- normal state at 6pm, and an admin recording a late entry is a legitimate
  -- act; a volunteer marking people hours after the gate closed is not.
  -- A session with no window set is always open, which is what makes the
  -- simple single-session event behave exactly as it always has.
  if not v_is_staff then
    if v_opens is not null and now() < v_opens then
      raise exception 'Check-in has not opened for this session yet.'
        using errcode = '42501';
    end if;
    if v_closes is not null and now() > v_closes then
      raise exception 'Check-in has closed for this session.'
        using errcode = '42501';
    end if;
  end if;

  if p_present then
    -- Idempotent twice over: on the client's own id, so a replayed offline
    -- queue entry is a no-op; and on (attendee, session), so two volunteers
    -- marking the same person at a busy gate is a success, not an error.
    if p_client_id is not null then
      select * into v_record from portal.attendance_records r
       where r.client_id = p_client_id;
      if found then
        return v_record;
      end if;
    end if;

    insert into portal.attendance_records (
      attendee_id, session_id, event_id, org_id, marked_via, marked_by, station_id, client_id
    )
    values (p_attendee, p_session, v_event, v_org, p_marked_via, actor, p_station, p_client_id)
    on conflict do nothing
    returning * into v_record;

    if v_record.id is null then
      select * into v_record from portal.attendance_records r
       where r.attendee_id = p_attendee and r.session_id = p_session
         and r.revoked_at is null;
    end if;
  else
    update portal.attendance_records r
       set revoked_at = now(), revoked_by = actor
     where r.attendee_id = p_attendee
       and r.session_id = p_session
       and r.revoked_at is null
    returning * into v_record;
  end if;

  -- Only ever set a handle, never clear one. Un-marking someone must not
  -- destroy the WordPress.org username they typed in at check-in.
  if p_wp_username is not null and length(trim(p_wp_username)) > 0 then
    update portal.attendees a
       set wp_username = lower(trim(p_wp_username))
     where a.id = p_attendee;
  end if;

  return v_record;
end;
$$;

revoke all on function portal.mark_attendance(uuid, uuid, boolean, text, text, uuid, uuid) from public, anon;
grant execute on function portal.mark_attendance(uuid, uuid, boolean, text, text, uuid, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 20260921120000_volunteer_visibility.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- Volunteers could not see their own event.
--
-- The SELECT policies on organizations and institutions were scoped to
-- app.user_org_ids(), which reads `memberships` — and a volunteer has no
-- membership row, because they are scoped to one event through event_members.
-- So the org lookup in requireEventAccess returned nothing and the page 404'd
-- before it ever got as far as checking event membership.
--
-- A volunteer legitimately needs both: the organisation's name to show in the
-- header, and the institutions to label attendees with. They still must not
-- see any OTHER event in that organisation, which the events policy already
-- enforces through app.user_event_ids().
-- ============================================================================

create or replace function app.user_visible_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from portal.memberships m where m.user_id = (select auth.uid())
  union
  select em.org_id from portal.event_members em where em.user_id = (select auth.uid())
$$;

grant execute on function app.user_visible_org_ids() to authenticated;

-- Read widens; writing stays staff-only via app.has_org_role(), untouched.
drop policy org_select on portal.organizations;
create policy org_select on portal.organizations
  for select to authenticated
  using (id in (select app.user_visible_org_ids()));

drop policy institution_select on portal.institutions;
create policy institution_select on portal.institutions
  for select to authenticated
  using (org_id in (select app.user_visible_org_ids()));


-- ─────────────────────────────────────────────────────────────────────────
-- 20260921130000_rpc_checkin_by_token.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- checkin_by_token — the public, anonymous self check-in path.
--
-- The plan had this route holding the service-role key in v1, confined to one
-- module, with the RPC as a later improvement. Doing it as an RPC now is less
-- code, not more: the public route never touches a key that bypasses RLS, and
-- the narrow return type makes over-fetching impossible rather than merely
-- discouraged. The legacy route returned `select("*")` — phone, email and
-- every attributes key — to anyone holding a token.
--
-- The token IS the credential: 96 bits of randomness, printed on a card. That
-- is the same trust model the printed QR codes already rely on. It still wants
-- a rate limit at the edge, because this is the one route that cannot be
-- scoped to a tenant.
-- ============================================================================

create or replace function portal.checkin_by_token(
  p_token       text,
  p_wp_username text default null
)
returns table (
  attendee_name    text,
  event_name       text,
  session_name     text,
  collect_username boolean,
  already_present  boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attendee  portal.attendees;
  v_event     portal.events;
  v_session   portal.sessions;
  v_count     integer;
  v_existing  portal.attendance_records;
begin
  select * into v_attendee from portal.attendees a where a.qr_token = p_token;
  if not found then
    raise exception 'Unknown code.' using errcode = 'P0002';
  end if;

  select * into v_event from portal.events e where e.id = v_attendee.event_id;

  -- Session resolution, matching lib/eventData.ts. Unlike the volunteer path
  -- there is no organiser override here: a student cannot decide that check-in
  -- is open.
  select count(*) into v_count from portal.sessions s where s.event_id = v_event.id;

  if v_count = 1 then
    select * into v_session from portal.sessions s where s.event_id = v_event.id;
  else
    select * into v_session
      from portal.sessions s
     where s.event_id = v_event.id
       and (s.checkin_opens_at is null or now() >= s.checkin_opens_at)
       and (s.checkin_closes_at is null or now() <= s.checkin_closes_at)
     order by s.checkin_closes_at nulls last
     limit 1;
  end if;

  if v_session.id is null then
    -- This is what closes the old gap where a student could open their QR link
    -- from home the night before and be marked present. It falls out of the
    -- session model rather than needing a special case.
    raise exception 'Check-in is not open right now.' using errcode = '42501';
  end if;

  select * into v_existing
    from portal.attendance_records r
   where r.attendee_id = v_attendee.id
     and r.session_id = v_session.id
     and r.revoked_at is null;

  if not found then
    insert into portal.attendance_records (
      attendee_id, session_id, event_id, org_id, marked_via
    ) values (
      v_attendee.id, v_session.id, v_event.id, v_event.org_id, 'qr'
    )
    on conflict do nothing;
  end if;

  -- Only ever set a handle, never clear one.
  if p_wp_username is not null and length(trim(p_wp_username)) > 0 then
    update portal.attendees a
       set wp_username = lower(trim(p_wp_username))
     where a.id = v_attendee.id;
  end if;

  -- Deliberately narrow: a name to confirm the right person, and nothing else.
  return query select
    v_attendee.name,
    v_event.name,
    v_session.name,
    coalesce((v_event.settings ->> 'collect_wp_username')::boolean, false),
    (v_existing.id is not null);
end;
$$;

revoke all on function portal.checkin_by_token(text, text) from public;
grant execute on function portal.checkin_by_token(text, text) to anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 20260921140000_default_session_trigger.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- Every event gets exactly one session, always.
--
-- The whole session model rests on this: resolveCurrentSession() treats a lone
-- session as always current, which is what keeps a plain single-day event
-- behaving as though sessions did not exist. An event created without one
-- would show "check-in isn't open" and nobody would be able to mark anyone.
--
-- That makes it an invariant, not a step in a procedure — so it lives here
-- rather than in whichever code path happens to create an event.
-- ============================================================================

create or replace function portal.create_default_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into portal.sessions (event_id, org_id, name, is_default, position)
  values (new.id, new.org_id, 'Main', true, 0);
  return new;
end;
$$;

create trigger create_default_session
  after insert on portal.events
  for each row execute function portal.create_default_session();


-- ─────────────────────────────────────────────────────────────────────────
-- 20260921150000_platform_admin.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- Platform administration: the level above a tenant.
--
-- Someone has to create organisations and hand each one its first owner. That
-- was a SQL job until now.
--
-- The deliberate limit: a platform admin can create and list organisations and
-- see COUNTS, but cannot read any tenant's attendees. A super-admin who can
-- read everyone's data would undo the isolation the rest of this schema exists
-- to provide — twenty-two policy checks and then one god-mode door.
--
-- Counts come from an aggregate-only function, so the privilege returns
-- numbers and never rows.
-- ============================================================================

create table portal.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table portal.platform_admins enable row level security;
-- No policy at all: membership of this table is granted in SQL, on purpose.
-- Nothing in the application can add to it, so privilege cannot be escalated
-- through a bug in a form.

create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from portal.platform_admins p where p.user_id = (select auth.uid())
  )
$$;

grant execute on function app.is_platform_admin() to authenticated;

-- Organisations become visible and creatable, and memberships writable so the
-- first owner can be attached. Attendees, attendance and institutions are
-- untouched: a platform admin gets no policy on any of them.
drop policy org_select on portal.organizations;
create policy org_select on portal.organizations
  for select to authenticated
  using (id in (select app.user_visible_org_ids()) or app.is_platform_admin());

create policy org_insert on portal.organizations
  for insert to authenticated
  with check (app.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Aggregates only. This is the whole point: numbers, never people.
-- ---------------------------------------------------------------------------
create or replace function portal.platform_org_stats()
returns table (
  org_id     uuid,
  slug       text,
  name       text,
  events     bigint,
  attendees  bigint,
  present    bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id, o.slug, o.name,
    (select count(*) from portal.events e where e.org_id = o.id),
    (select count(*) from portal.attendees a where a.org_id = o.id),
    (select count(*) from portal.attendance_records r
      where r.org_id = o.id and r.revoked_at is null),
    o.created_at
  from portal.organizations o
  where app.is_platform_admin()
  order by o.created_at desc
$$;

grant execute on function portal.platform_org_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- Create an organisation and give it its first owner, in one transaction.
--
-- An organisation with no owner is unadministrable, and the membership trigger
-- forbids granting ownership to anyone but an existing owner — so these two
-- steps cannot safely be left to two separate requests.
-- ---------------------------------------------------------------------------
create or replace function portal.create_organization(
  p_slug        text,
  p_name        text,
  p_owner_email text
)
returns portal.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_org   portal.organizations;
begin
  if not app.is_platform_admin() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select u.id into v_owner from auth.users u
   where lower(u.email) = lower(trim(p_owner_email));
  if v_owner is null then
    raise exception 'No account for %. They need to sign in once first.', p_owner_email
      using errcode = 'P0002';
  end if;

  insert into portal.organizations (slug, name, created_by)
  values (lower(trim(p_slug)), trim(p_name), (select auth.uid()))
  returning * into v_org;

  insert into portal.memberships (org_id, user_id, role)
  values (v_org.id, v_owner, 'owner');

  return v_org;
end;
$$;

grant execute on function portal.create_organization(text, text, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 20260921151000_membership_guard_platform.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- Make the membership guard explicit about platform admins.
--
-- Before this, a platform admin creating an organisation for someone else got
-- past the "only an owner may grant ownership" rule by accident: their
-- actor_role is NULL, and `NULL <> 'owner'` is NULL, so the branch never
-- fired. Relying on three-valued logic for a privilege check is the kind of
-- thing that breaks the day someone rewrites the condition to look tidier.
--
-- Creating an organisation for THEMSELVES was blocked outright by the
-- "nobody edits their own membership" rule, which is the common case for a
-- one-person platform.
--
-- So: platform admins are named, and the rules they are exempt from are
-- visible. The rules still bind everyone else, including org owners.
-- ============================================================================

create or replace function portal.guard_membership_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role text;
  owners_left integer;
begin
  -- The seed and service-role maintenance run without a JWT.
  if actor is null then
    return coalesce(new, old);
  end if;

  -- Bootstrapping an organisation means writing its first owner row, which
  -- every rule below is designed to prevent. Exempt, explicitly, and only for
  -- the handful of people in portal.platform_admins — a table no application
  -- code can write to.
  if app.is_platform_admin() then
    return coalesce(new, old);
  end if;

  select m.role into actor_role
    from portal.memberships m
   where m.org_id = coalesce(new.org_id, old.org_id)
     and m.user_id = actor;

  if coalesce(new.user_id, old.user_id) = actor then
    raise exception 'You cannot change your own membership.'
      using errcode = '42501';
  end if;

  -- coalesce, so a NULL actor_role reads as "not an owner" rather than as
  -- "unknown, therefore allowed".
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner'
     and coalesce(actor_role, '') <> 'owner' then
    raise exception 'Only an owner can grant ownership.'
      using errcode = '42501';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner') then
    select count(*) into owners_left
      from portal.memberships m
     where m.org_id = old.org_id and m.role = 'owner' and m.user_id <> old.user_id;
    if owners_left = 0 then
      raise exception 'An organisation must keep at least one owner.'
        using errcode = '23514';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────
-- 20260921152000_platform_admin_self_read.sql
-- ─────────────────────────────────────────────────────────────────────────
-- portal.platform_admins was locked down with RLS on and no policies, so that
-- nothing in the application could grant the privilege. That also meant nobody
-- could READ it — including a platform admin checking whether they are one, so
-- the page 404'd for exactly the person it was built for.
--
-- Read your own row only. You can learn that you are an admin; you cannot
-- enumerate who else is. There is still no write policy, which was the point.
create policy platform_admin_self_read on portal.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));


-- ─────────────────────────────────────────────────────────────────────────
-- 20260921160000_platform_org_access.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- Platform admins can administer an organisation's SETUP, not its people.
--
-- Creating an organisation and then being locked out of it made the platform
-- page nearly useless: during a beta the operator is the one helping a new
-- organiser get going. So events and institutions open up.
--
-- Attendees and attendance do NOT. That is the line, and it is drawn where it
-- matters: event names and college names are a tenant's metadata, while an
-- attendee row is a named student's email and phone number. DPDP applies to
-- the second and not the first.
-- ============================================================================

-- Org staff, or the platform operator.
create or replace function app.can_admin_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_org_role(p_org, array['owner', 'admin']) or app.is_platform_admin()
$$;

grant execute on function app.can_admin_org(uuid) to authenticated;

drop policy event_select on portal.events;
create policy event_select on portal.events
  for select to authenticated
  using (id in (select app.user_event_ids()) or app.is_platform_admin());

drop policy event_write on portal.events;
create policy event_write on portal.events
  for all to authenticated
  using (app.can_admin_org(org_id))
  with check (app.can_admin_org(org_id));

drop policy institution_select on portal.institutions;
create policy institution_select on portal.institutions
  for select to authenticated
  using (org_id in (select app.user_visible_org_ids()) or app.is_platform_admin());

drop policy institution_write on portal.institutions;
create policy institution_write on portal.institutions
  for all to authenticated
  using (app.can_admin_org(org_id))
  with check (app.can_admin_org(org_id));

-- Sessions follow events: an event created here needs its default session, and
-- the trigger that makes one runs as definer, but editing them is setup work.
drop policy session_write on portal.sessions;
create policy session_write on portal.sessions
  for all to authenticated
  using (app.can_admin_org(org_id))
  with check (app.can_admin_org(org_id));

-- portal.attendees and portal.attendance_records are deliberately untouched.


-- ---------------------------------------------------------------------------
-- Counts for the organisation screens.
--
-- These exist because the screens show "132 / 187" per event, and a platform
-- admin reading portal.attendees directly gets zero rows — so the page would
-- confidently display 0/0. An aggregate function returns the number without
-- handing over the people it counted.
-- ---------------------------------------------------------------------------
create or replace function portal.org_event_stats(p_org uuid)
returns table (event_id uuid, attendees bigint, present bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    (select count(*) from portal.attendees a where a.event_id = e.id),
    (select count(*) from portal.attendance_records r
      where r.event_id = e.id and r.revoked_at is null)
  from portal.events e
  where e.org_id = p_org and app.can_admin_org(p_org)
$$;

create or replace function portal.org_institution_stats(p_org uuid)
returns table (institution_id uuid, attendees bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, (select count(*) from portal.attendees a where a.institution_id = i.id)
  from portal.institutions i
  where i.org_id = p_org and app.can_admin_org(p_org)
$$;

grant execute on function portal.org_event_stats(uuid) to authenticated;
grant execute on function portal.org_institution_stats(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 20260923100000_invitations.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- Joining an organisation or an event.
--
-- Until now the only way to give anyone access was to write SQL, which makes
-- this a product for one person. Two ways in, because they fail differently:
--
--   Link invite   — anyone holding the link can join with that role. Fast on
--                   event morning, and the link is the credential, so it is
--                   short-lived, use-capped and revocable.
--   Email invite  — the same link, but it only works for one address. A
--                   forwarded link is useless. Slower to set up, so it earns
--                   its keep for admin and owner roles rather than volunteers.
-- ============================================================================

alter table portal.invitations
  add column email text,
  add column accepted_at timestamptz,
  add column label text;

comment on column portal.invitations.email is
  'When set, only this address may accept. Null means anyone with the link.';

create index invitations_org_idx on portal.invitations (org_id);

-- ---------------------------------------------------------------------------
-- The membership guard has to let an invite through.
--
-- Accepting an invite means writing your OWN membership row, which is exactly
-- what "nobody edits their own membership" forbids. Rather than weaken that
-- rule, accept_invite raises a transaction-local flag that only it can set —
-- it is SECURITY DEFINER and validates the token before doing so.
-- ---------------------------------------------------------------------------
create or replace function portal.guard_membership_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role text;
  owners_left integer;
begin
  if actor is null then
    return coalesce(new, old);
  end if;

  -- Set only inside portal.accept_invite, after the token has been checked.
  if coalesce(current_setting('portal.accepting_invite', true), '') = 'yes' then
    return coalesce(new, old);
  end if;

  if app.is_platform_admin() then
    return coalesce(new, old);
  end if;

  select m.role into actor_role
    from portal.memberships m
   where m.org_id = coalesce(new.org_id, old.org_id)
     and m.user_id = actor;

  if coalesce(new.user_id, old.user_id) = actor then
    raise exception 'You cannot change your own membership.'
      using errcode = '42501';
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner'
     and coalesce(actor_role, '') <> 'owner' then
    raise exception 'Only an owner can grant ownership.'
      using errcode = '42501';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner') then
    select count(*) into owners_left
      from portal.memberships m
     where m.org_id = old.org_id and m.role = 'owner' and m.user_id <> old.user_id;
    if owners_left = 0 then
      raise exception 'An organisation must keep at least one owner.'
        using errcode = '23514';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- What a link shows before anyone commits to it.
--
-- Callable by anyone signed in, because the token IS the credential. It leaks
-- only what the person needs to decide whether to accept: which organisation,
-- which event, which role.
-- ---------------------------------------------------------------------------
create or replace function portal.describe_invite(p_token text)
returns table (
  org_name    text,
  event_name  text,
  role        text,
  email       text,
  problem     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.name,
    e.name,
    i.role,
    i.email,
    case
      when i.revoked_at is not null                  then 'revoked'
      when i.expires_at is not null
           and now() > i.expires_at                  then 'expired'
      when i.used_count >= i.max_uses                then 'used up'
      when i.email is not null
           and lower(i.email) <> lower(coalesce((select auth.email()), '')) then 'wrong account'
      else null
    end
  from portal.invitations i
  join portal.organizations o on o.id = i.org_id
  left join portal.events e on e.id = i.event_id
  where i.token = p_token
$$;

grant execute on function portal.describe_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Accepting.
-- ---------------------------------------------------------------------------
create or replace function portal.accept_invite(p_token text)
returns table (org_slug text, event_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_mail text := (select auth.email());
  i portal.invitations;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select * into i from portal.invitations where token = p_token;
  if not found then
    raise exception 'That invite link is not valid.' using errcode = 'P0002';
  end if;

  if i.revoked_at is not null then
    raise exception 'That invite has been revoked.' using errcode = '42501';
  end if;
  if i.expires_at is not null and now() > i.expires_at then
    raise exception 'That invite has expired.' using errcode = '42501';
  end if;
  if i.used_count >= i.max_uses then
    raise exception 'That invite has already been used.' using errcode = '42501';
  end if;
  -- An email-bound invite is worthless if forwarded, which is the whole point
  -- of offering it alongside the open link.
  if i.email is not null and lower(i.email) <> lower(coalesce(v_mail, '')) then
    raise exception 'That invite was issued to a different email address.'
      using errcode = '42501';
  end if;

  perform set_config('portal.accepting_invite', 'yes', true);

  if i.role = 'volunteer' then
    insert into portal.event_members (event_id, user_id, org_id, role)
    values (i.event_id, v_user, i.org_id, 'volunteer')
    on conflict (event_id, user_id) do nothing;
  else
    insert into portal.memberships (org_id, user_id, role)
    values (i.org_id, v_user, i.role)
    on conflict (org_id, user_id) do update set role = excluded.role;
  end if;

  update portal.invitations
     set used_count = used_count + 1,
         accepted_at = coalesce(accepted_at, now())
   where id = i.id;

  return query
    select o.slug, e.slug
      from portal.organizations o
      left join portal.events e on e.id = i.event_id
     where o.id = i.org_id;
end;
$$;

grant execute on function portal.accept_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Who is on the team. auth.users is not readable over the API, so the screen
-- would otherwise show a list of UUIDs.
-- ---------------------------------------------------------------------------
create or replace function portal.org_members(p_org uuid)
returns table (
  user_id    uuid,
  email      text,
  role       text,
  event_id   uuid,
  event_name text,
  joined_at  timestamptz,
  is_you     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, u.email::text, m.role, null::uuid, null::text, m.created_at,
         m.user_id = (select auth.uid())
    from portal.memberships m
    join auth.users u on u.id = m.user_id
   where m.org_id = p_org and app.can_admin_org(p_org)
  union all
  select em.user_id, u.email::text, em.role, em.event_id, e.name, em.created_at,
         em.user_id = (select auth.uid())
    from portal.event_members em
    join auth.users u on u.id = em.user_id
    join portal.events e on e.id = em.event_id
   where em.org_id = p_org and app.can_admin_org(p_org)
$$;

grant execute on function portal.org_members(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 20260923110000_describe_invite_anon.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Someone opening an invite link is usually signed out. Showing them what they
-- are about to join BEFORE asking them to sign in is the difference between
-- "join WPCC Surat as a volunteer" and an unexplained login wall.
--
-- Safe to expose: the token is the credential, and this returns only the
-- organisation, the event and the role — the three things needed to decide.
create or replace function portal.describe_invite(p_token text)
returns table (
  org_name    text,
  event_name  text,
  role        text,
  email       text,
  problem     text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.name,
    e.name,
    i.role,
    i.email,
    case
      when i.revoked_at is not null                  then 'revoked'
      when i.expires_at is not null
           and now() > i.expires_at                  then 'expired'
      when i.used_count >= i.max_uses                then 'used up'
      -- Only a mismatch once somebody is actually signed in. Reporting "wrong
      -- account" to a signed-out visitor would be nonsense.
      when i.email is not null
           and (select auth.uid()) is not null
           and lower(i.email) <> lower(coalesce((select auth.email()), '')) then 'wrong account'
      else null
    end
  from portal.invitations i
  join portal.organizations o on o.id = i.org_id
  left join portal.events e on e.id = i.event_id
  where i.token = p_token
$$;

grant execute on function portal.describe_invite(text) to anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 20260923120000_open_invites.sql
-- ─────────────────────────────────────────────────────────────────────────
-- "Still usable" is a question about now(), and the database is the only place
-- that knows the answer without the application inventing its own clock. It
-- was also being decided in two places — here and in describe_invite — which
-- is how the two drift apart.
create or replace function portal.org_open_invites(p_org uuid)
returns table (
  id         uuid,
  token      text,
  role       text,
  email      text,
  event_name text,
  expires_at timestamptz,
  max_uses   integer,
  used_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.token, i.role, i.email, e.name, i.expires_at, i.max_uses, i.used_count
    from portal.invitations i
    left join portal.events e on e.id = i.event_id
   where i.org_id = p_org
     and app.can_admin_org(p_org)
     and i.revoked_at is null
     and (i.expires_at is null or now() < i.expires_at)
     and i.used_count < i.max_uses
   order by i.created_at desc
$$;

grant execute on function portal.org_open_invites(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- 20260923130000_org_edit_delete.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- Renaming and removing an organisation.
--
-- Two gaps this closes:
--   - org_update was scoped to org staff, so the platform operator who created
--     an organisation could not fix a typo in its name.
--   - There was no delete policy at all, so a mistyped organisation was
--     permanent.
--
-- Deleting an organisation cascades to attendees, attendance_records, events,
-- sessions, institutions, memberships, invitations and stations — everything.
-- The application only ever offers it for an empty one, and this policy keeps
-- it to the platform operator, who is the only one who can create them.
-- ============================================================================

drop policy org_update on portal.organizations;
create policy org_update on portal.organizations
  for update to authenticated
  using (app.can_admin_org(id))
  with check (app.can_admin_org(id));

create policy org_delete on portal.organizations
  for delete to authenticated
  using (app.is_platform_admin());

-- Whether an organisation is safe to remove, answered where the counting
-- happens rather than in three round trips from the application.
create or replace function portal.org_is_empty(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_platform_admin()
     and not exists (select 1 from portal.events e where e.org_id = p_org)
     and not exists (select 1 from portal.attendees a where a.org_id = p_org)
$$;

grant execute on function portal.org_is_empty(uuid) to authenticated;
