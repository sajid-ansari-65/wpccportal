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
