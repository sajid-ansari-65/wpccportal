-- ============================================================================
-- Production upgrade: the migrations added after 01-schema.sql was first run.
--
-- For a database that already has the first 11 migrations (everything up to
-- 20260921160000_platform_org_access). Run 00-check.sql first: if it says the
-- base is there and "invitations" is false, this is the file to run.
--
-- One transaction: it either all applies or none of it does. Paste into the
-- Supabase SQL Editor and run. No psql commands in here, so the editor works.
--
-- Touches ONLY the portal and app schemas. public.* is never read or written.
-- ============================================================================

begin;


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


-- ─────────────────────────────────────────────────────────────────────────
-- 20260924100000_invite_hardening.sql
-- ─────────────────────────────────────────────────────────────────────────
-- ============================================================================
-- Invite hardening: three holes in accept_invite and the invitations policy.
--
-- 1. Admin → owner. The app refused to let an admin create an owner invite,
--    but the RLS policy did not, so an admin calling the API directly could
--    insert one, accept it themselves, and walk past "only an owner can grant
--    ownership" — accept_invite raises the flag that skips that guard.
--    Closed twice: the policy refuses the insert, and acceptance re-checks
--    that whoever issued an owner invite is still an owner.
--
-- 2. Use-count race. The cap was checked on a plain SELECT and bumped later,
--    so two people accepting a single-use link at once could both get in.
--    The row is now locked for the length of the acceptance.
--
-- 3. Silent demotion. Accepting an admin invite as an existing owner ran
--    `on conflict do update set role = 'admin'` — and if they were the only
--    owner, the organisation was left with none. Accepting an invite now only
--    ever raises a role, never lowers it.
-- ============================================================================

-- Nothing ever filled in created_by, and the owner re-check below depends on
-- it. The default fills it; the policy stops a caller from writing someone
-- else's id there to borrow their ownership.
alter table portal.invitations
  alter column created_by set default auth.uid();

drop policy invitation_write on portal.invitations;

-- Admins still manage invites, but only an owner may mint or edit an owner
-- invite. Split by operation because `for all` applies the insert-time
-- created_by rule to updates too, which would stop an admin revoking an
-- invite someone else created.
create policy invitation_insert on portal.invitations
  for insert to authenticated
  with check (
    app.has_org_role(org_id, array['owner', 'admin'])
    and (role <> 'owner' or app.has_org_role(org_id, array['owner']))
    and created_by = (select auth.uid())
  );

-- An update can neither turn an invite into an owner invite nor touch one,
-- unless the caller is an owner, so created_by cannot be used to launder one.
create policy invitation_update on portal.invitations
  for update to authenticated
  using (
    app.has_org_role(org_id, array['owner', 'admin'])
    and (role <> 'owner' or app.has_org_role(org_id, array['owner']))
  )
  with check (
    app.has_org_role(org_id, array['owner', 'admin'])
    and (role <> 'owner' or app.has_org_role(org_id, array['owner']))
  );

create policy invitation_delete on portal.invitations
  for delete to authenticated
  using (app.has_org_role(org_id, array['owner', 'admin']));

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

  -- FOR UPDATE: a second acceptance of the same token waits here until this
  -- one commits, then sees the new used_count.
  select * into i from portal.invitations where token = p_token for update;
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
  if i.email is not null and lower(i.email) <> lower(coalesce(v_mail, '')) then
    raise exception 'That invite was issued to a different email address.'
      using errcode = '42501';
  end if;

  -- The policy stops new owner invites from non-owners; this also catches one
  -- that predates the policy, or whose issuer has since been demoted.
  if i.role = 'owner' and not exists (
    select 1 from portal.memberships m
     where m.org_id = i.org_id and m.user_id = i.created_by and m.role = 'owner'
  ) then
    raise exception 'That invite is no longer valid. Ask an owner for a new one.'
      using errcode = '42501';
  end if;

  perform set_config('portal.accepting_invite', 'yes', true);

  if i.role = 'volunteer' then
    insert into portal.event_members (event_id, user_id, org_id, role)
    values (i.event_id, v_user, i.org_id, 'volunteer')
    on conflict (event_id, user_id) do nothing;
  else
    -- Only ever upward: admin → owner. An owner opening an admin link stays
    -- an owner.
    insert into portal.memberships (org_id, user_id, role)
    values (i.org_id, v_user, i.role)
    on conflict (org_id, user_id) do update set role = excluded.role
      where portal.memberships.role = 'admin' and excluded.role = 'owner';
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


commit;
