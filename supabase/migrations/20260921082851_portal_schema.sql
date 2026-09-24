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
