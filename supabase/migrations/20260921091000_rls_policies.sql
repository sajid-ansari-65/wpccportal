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
