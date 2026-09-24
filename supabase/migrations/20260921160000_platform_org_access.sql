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
